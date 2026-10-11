import {
  type ECDH,
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { PushPayload, PushResult, PushService } from "./domain/reminders.js";
import type { PushSubscriptionRow, VapidKeys } from "./domain/types.js";

/**
 * Web Push on node:crypto and fetch: VAPID (RFC 8292) to identify the app to
 * the push service, and aes128gcm payload encryption (RFC 8291) so only the
 * subscribed browser can read the message.
 *
 * Written here rather than taken from the `web-push` package because that
 * package is CommonJS that `require()`s Node builtins, which throws once
 * bundled into the functions' ESM output (the same reason nodemailer is
 * `--external` there). This is the whole protocol; webpush.test.ts decrypts
 * what it produces the way a browser does.
 *
 * Both deployments wire it the same way; the keys come from the repo, which
 * makes them once and keeps them (CrumbRepo.vapidKeys).
 */

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x!), unb64u(pub.y!)])),
    privateKey: priv.d!,
  };
}

/** The `Authorization` header value for one push service origin. */
export function vapidAuthorization(keys: VapidKeys, audience: string, subject: string, now = Date.now()): string {
  const pub = unb64u(keys.publicKey);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Push services cap exp at 24 hours.
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** The aes128gcm request body for `plaintext`, readable only by the subscription's browser. */
export function encryptPayload(
  sub: Pick<PushSubscriptionRow, "p256dh" | "auth">,
  plaintext: Buffer,
  /** Fixed salt and sender key, for the RFC test vector only. */
  fixed?: { salt: Buffer; ecdh: ECDH },
): Buffer {
  const salt = fixed?.salt ?? randomBytes(16);
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);

  const ecdh = fixed?.ecdh ?? createECDH("prime256v1");
  const asPublic = fixed ? ecdh.getPublicKey() : ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // One record: the payload, then the 0x02 delimiter that marks the last record.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * The VAPID `sub` claim: who push services can contact about this sender.
 * `explicit` wins; otherwise the address in a `Name <addr>` From line. Apple's
 * push service refuses a token without one.
 */
export function vapidSubject(explicit?: string, mailFrom?: string): string {
  if (explicit) return explicit;
  const address = mailFrom ? (/<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom).trim() : "";
  return `mailto:${address || "crumb@localhost"}`;
}

export interface WebPushOptions {
  keys: () => Promise<VapidKeys>;
  /**
   * A `mailto:` or `https:` URL push services can contact about this sender.
   * A function is read at send time, for the cloud, where env values are not
   * there when the module loads during deploy.
   */
  subject: string | (() => string);
  /** Seconds a push service keeps an undelivered message. */
  ttl?: number;
  fetch?: typeof fetch;
}

export function createWebPush(opts: WebPushOptions): PushService {
  const doFetch = opts.fetch ?? fetch;
  return {
    async publicKey() {
      return (await opts.keys()).publicKey;
    },
    async send(sub: PushSubscriptionRow, payload: PushPayload): Promise<PushResult> {
      const keys = await opts.keys();
      const endpoint = new URL(sub.endpoint);
      try {
        const res = await doFetch(sub.endpoint, {
          method: "POST",
          headers: {
            authorization: vapidAuthorization(
              keys,
              endpoint.origin,
              typeof opts.subject === "function" ? opts.subject() : opts.subject,
            ),
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            ttl: String(opts.ttl ?? 3600),
            urgency: "high",
            topic: topic(payload.tag),
          },
          body: encryptPayload(sub, Buffer.from(JSON.stringify(payload))),
        });
        if (res.status === 404 || res.status === 410) return "gone";
        if (!res.ok) {
          console.warn(`[push] ${endpoint.host} answered ${res.status}: ${await res.text().catch(() => "")}`);
          return "failed";
        }
        return "sent";
      } catch (err) {
        console.warn(`[push] ${endpoint.host} unreachable:`, err);
        return "failed";
      }
    },
  };
}

/** Topic replaces an undelivered message with the same one; at most 32 URL-safe chars. */
function topic(tag: string): string {
  return b64u(Buffer.from(tag)).slice(-32);
}
