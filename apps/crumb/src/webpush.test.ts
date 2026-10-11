import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { describe, it } from "node:test";
import { createWebPush, encryptPayload, generateVapidKeys, vapidAuthorization } from "./webpush.js";

const b64u = (b: Buffer) => b.toString("base64url");

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, sub: { p256dh: b64u(publicKey), auth: b64u(auth) }, publicKey, auth };
}

/** RFC 8291 decryption, as the browser does it. */
function decrypt(b: ReturnType<typeof browser>, body: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.ok(record.length <= rs);

  const shared = b.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), b.publicKey, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, b.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, "last-record delimiter");
  return plain.subarray(0, -1).toString();
}

describe("web push", () => {
  it("encrypts a payload only the subscribed browser can read", () => {
    const b = browser();
    const body = encryptPayload(b.sub, Buffer.from('{"title":"Fold now"}'));
    assert.equal(decrypt(b, body), '{"title":"Fold now"}');
    assert.throws(() => decrypt(browser(), body), "another browser can't");
  });

  it("matches the RFC 8291 test vector", () => {
    const sender = createECDH("prime256v1");
    sender.setPrivateKey(Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"));
    const body = encryptPayload(
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      Buffer.from("When I grow up, I want to be a watermelon"),
      { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), ecdh: sender },
    );
    assert.equal(
      b64u(body),
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs a VAPID token push services can verify", () => {
    const keys = generateVapidKeys();
    assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65);
    assert.equal(Buffer.from(keys.privateKey, "base64url").length, 32);

    const now = Date.UTC(2026, 9, 11, 12);
    const header = vapidAuthorization(keys, "https://web.push.apple.com", "mailto:baker@example.com", now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    assert.ok(m, header);
    const [, h, c, s, k] = m;
    assert.equal(k, keys.publicKey);
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    assert.equal(claims.aud, "https://web.push.apple.com");
    assert.equal(claims.sub, "mailto:baker@example.com");
    assert.equal(claims.exp, now / 1000 + 12 * 3600);

    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) },
      format: "jwk",
    });
    assert.ok(
      verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")),
    );
  });

  it("posts to the endpoint and reads the push service's answer", async () => {
    const b = browser();
    const keys = generateVapidKeys();
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const push = createWebPush({
      keys: async () => keys,
      subject: "mailto:baker@example.com",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status });
      }) as typeof fetch,
    });
    const sub = { id: "x", endpoint: "https://fcm.googleapis.com/fcm/send/abc", created_at: "", ...b.sub };
    const payload = { title: "Shape", body: "Country loaf", url: "#/bakes/1", tag: "bake:1:shape" };

    assert.equal(await push.publicKey(), keys.publicKey);
    assert.equal(await push.send(sub, payload), "sent");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(calls[0].url, sub.endpoint);
    assert.equal(headers["content-encoding"], "aes128gcm");
    assert.match(headers.authorization, /^vapid t=.+, k=/);
    assert.match(headers.topic, /^[A-Za-z0-9_-]{1,32}$/);
    assert.deepEqual(JSON.parse(decrypt(b, calls[0].init.body as Buffer)), payload);

    status = 410;
    assert.equal(await push.send(sub, payload), "gone");
    status = 500;
    assert.equal(await push.send(sub, payload), "failed");
  });
});
