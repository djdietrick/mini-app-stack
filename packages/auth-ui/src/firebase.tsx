import { type FirebaseOptions, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
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

  const auth = useMemo(() => {
    const app = getApps()[0] ?? initializeApp(config);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const logout = useCallback<AuthContextValue["logout"]>(async () => {
    await signOut(auth).catch(() => undefined);
    await fetch(`${authUrl}/logout`, { method: "POST", credentials: "include" });
    setState({ status: "signed-out", user: null });
  }, [auth, authUrl]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, refresh, login, signup, logout }),
    [state, refresh, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
    default:
      return fallback;
  }
}
