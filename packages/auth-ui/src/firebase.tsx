import { type FirebaseOptions, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthContext, type AuthContextValue, type AuthState, type SessionUser } from "./context.js";

/**
 * Cloud provider. Implements exactly the same AuthContextValue as the
 * self-hosted AuthProvider, so <AuthGate>, <LoginForm> and <SignupForm> are
 * unchanged between deployment targets.
 *
 * Flow: the Firebase JS SDK authenticates and hands back an ID token; we post
 * that to the authApi function, which mints an httpOnly session cookie. From
 * then on every /api call is authenticated by the cookie the browser sends
 * automatically — identical to the self-hosted model, and no token ever sits
 * in localStorage.
 */
export interface FirebaseAuthProviderProps {
  config: FirebaseOptions;
  /** Where authApi is mounted. Same-origin by default via a Hosting rewrite. */
  authUrl?: string;
  /** e.g. "127.0.0.1:9099" when running the emulator suite. */
  emulatorHost?: string;
  children: ReactNode;
}

export function FirebaseAuthProvider({
  config,
  authUrl = "/auth",
  emulatorHost,
  children,
}: FirebaseAuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const [authError, setAuthError] = useState<string | null>(null);

  const auth = useMemo(() => {
    const app =
      getApps()[0] ??
      initializeApp(emulatorHost ? config : { ...config, authDomain: sameOriginAuthDomain(config.authDomain) });
    const instance = getAuth(app);
    if (emulatorHost) {
      connectAuthEmulator(instance, `http://${emulatorHost}`, { disableWarnings: true });
    }
    return instance;
  }, [config, emulatorHost]);

  // The session cookie, not the SDK's own persistence, is the source of truth —
  // it is what the backend actually verifies.
  const refresh = useCallback<AuthContextValue["refresh"]>(async () => {
    const res = await fetch(`${authUrl}/me`, { credentials: "include" });
    setState(
      res.ok
        ? { status: "signed-in", user: (await res.json()) as SessionUser }
        : { status: "signed-out", user: null },
    );
  }, [authUrl]);

  const exchange = useCallback(
    async (idToken: string) => {
      const res = await fetch(`${authUrl}/session`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("could not start session");
      await refresh();
    },
    [authUrl, refresh],
  );

  // Finishes a Google sign-in on the way back from the redirect, then loads the
  // session. Doing both here keeps the login form from flashing up in between.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only after a redirect this tab started, so an ordinary page load
        // never waits on Google's helper scripts.
        const cred = isRedirectPending() ? await getRedirectResult(auth) : null;
        clearRedirectPending();
        if (cred && !cancelled) {
          await exchange(await cred.user.getIdToken());
          return;
        }
      } catch (err) {
        clearRedirectPending();
        if (!cancelled) setAuthError(describe(err, "Google sign-in failed"));
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, exchange, refresh]);

  const login = useCallback<AuthContextValue["login"]>(
    async (email, password) => {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await exchange(await cred.user.getIdToken());
      } catch (err) {
        throw new Error(describe(err, "invalid credentials"));
      }
    },
    [auth, exchange],
  );

  const signup = useCallback<AuthContextValue["signup"]>(
    async (email, password, displayName) => {
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
        // Force a refresh so the freshly set displayName is in the token the
        // backend mirrors into users/{uid}.
        await exchange(await cred.user.getIdToken(true));
      } catch (err) {
        throw new Error(describe(err, "signup failed"));
      }
    },
    [auth, exchange],
  );

  // A full-page redirect, finished by the getRedirectResult effect above when
  // Google sends the browser back. Works in home-screen web apps and on
  // mobile, where popups either open a detached tab or are blocked.
  const loginWithGoogle = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      markRedirectPending();
      await signInWithRedirect(auth, provider);
    } catch (err) {
      throw new Error(describe(err, "Google sign-in failed"));
    }
  }, [auth]);

  const logout = useCallback<AuthContextValue["logout"]>(async () => {
    await signOut(auth).catch(() => undefined);
    await fetch(`${authUrl}/logout`, { method: "POST", credentials: "include" });
    setState({ status: "signed-out", user: null });
  }, [auth, authUrl]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, refresh, login, signup, logout, loginWithGoogle, authError }),
    [state, refresh, login, signup, logout, loginWithGoogle, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The Firebase SDK finishes a Google sign-in on `authDomain`'s
 * /__/auth/handler and reads the result back through storage there. With the
 * project's shared `<project>.firebaseapp.com` that storage is third-party to
 * the app, and Safari, Firefox, Chrome's storage partitioning and home-screen
 * web apps all cut it off: Google succeeds, the result never arrives, and the
 * user is back at the login form with no Firebase account created.
 *
 * Every Firebase Hosting site serves /__/auth/* for its own project, so the
 * page's own host is a valid authDomain and keeps the whole flow first-party.
 * Each host needs https://<host>/__/auth/handler registered as a redirect URI
 * on the OAuth client (docs/firebase-setup.md). Local dev hosts have no
 * handler, so they keep the configured domain.
 */
function sameOriginAuthDomain(configured: string | undefined): string | undefined {
  if (typeof window === "undefined") return configured;
  const { hostname, host } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return configured;
  return host;
}

const REDIRECT_PENDING_KEY = "stack:googleRedirectPending";

function markRedirectPending() {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
  } catch {
    // Storage disabled: the redirect result is then simply not collected.
  }
}

// Cleared only once the result is collected, not on read: StrictMode runs the
// effect twice, and the SDK hands the same result to both calls.
function isRedirectPending(): boolean {
  try {
    return sessionStorage.getItem(REDIRECT_PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

function clearRedirectPending() {
  try {
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Firebase error codes are not user-facing. Map the ones people actually hit
 * onto the same wording apps/auth returns, so the two backends read the same.
 */
function describe(err: unknown, fallback: string): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "email already registered";
    case "auth/invalid-email":
      return "invalid email";
    case "auth/weak-password":
      return "password must be at least 8 characters";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "invalid credentials";
    case "auth/too-many-requests":
      return "too many attempts, try again later";
    case "auth/account-exists-with-different-credential":
      return "this email already has an account; sign in with your password";
    case "auth/unauthorized-domain":
      return "Google sign-in is not enabled for this address";
    default:
      // Keep the code: it is what makes a misconfiguration diagnosable from
      // the login screen instead of a silent generic failure.
      return code ? `${fallback} (${code})` : fallback;
  }
}
