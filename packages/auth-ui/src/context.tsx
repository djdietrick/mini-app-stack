import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
}

export type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out"; user: null };

export interface AuthContextValue {
  state: AuthState;
  /** Re-fetch /me. Useful after a login/signup completes. */
  refresh: () => Promise<void>;
  /** POST credentials to authUrl/login, then refresh. Throws on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** POST credentials to authUrl/signup, then refresh. Throws on failure. */
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  /** POST authUrl/logout and refresh. */
  logout: () => Promise<void>;
  /**
   * Sign in with Google. Absent when the backend has no Google sign-in
   * configured, so the forms only offer the button where it can work. May
   * navigate away (self-hosted redirects to Google), in which case the promise
   * never settles.
   */
  loginWithGoogle?: () => Promise<void>;
  /**
   * An error from a sign-in that finished outside a form submit — the
   * self-hosted Google flow returns from a redirect — for the forms to show.
   */
  authError?: string | null;
}

/**
 * Exported so a second provider can satisfy the same contract. FirebaseAuthProvider
 * in ./firebase.tsx does exactly that, which is why AuthGate, LoginForm and
 * SignupForm need no changes between deployment targets — they only ever
 * consume this context.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  /**
   * Origin of apps/auth (e.g. "https://auth.stack.local" or "" if you
   * proxy /auth/* through the same origin). Empty string means relative.
   */
  authUrl: string;
  children: ReactNode;
}

async function authFetch(authUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${authUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body != null ? { "content-type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

export function AuthProvider({ authUrl, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [authError] = useState(readRedirectError);

  const refresh = useCallback(async () => {
    const res = await authFetch(authUrl, "/me");
    if (res.ok) {
      setState({ status: "signed-in", user: (await res.json()) as SessionUser });
    } else {
      setState({ status: "signed-out", user: null });
    }
  }, [authUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Strip it once read, so a reload does not show it again. In an effect rather
  // than the state initializer, which StrictMode runs twice.
  useEffect(() => {
    if (authError !== null) clearRedirectError();
  }, [authError]);

  // Google sign-in is optional self-hosted; apps/auth says whether it is set up.
  useEffect(() => {
    authFetch(authUrl, "/providers")
      .then((res) => (res.ok ? res.json() : { google: false }))
      .then((body: { google?: boolean }) => setGoogleEnabled(body.google === true))
      .catch(() => setGoogleEnabled(false));
  }, [authUrl]);

  const loginWithGoogle = useCallback(async () => {
    // A full-page redirect through Google and back. apps/auth checks the
    // origin of returnTo against GOOGLE_ALLOWED_ORIGINS before redirecting.
    const returnTo = window.location.href;
    window.location.assign(`${authUrl}/google/start?returnTo=${encodeURIComponent(returnTo)}`);
    await new Promise<never>(() => undefined);
  }, [authUrl]);

  const login = useCallback<AuthContextValue["login"]>(
    async (email, password) => {
      const res = await authFetch(authUrl, "/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "login failed" }));
        throw new Error(typeof body.error === "string" ? body.error : "login failed");
      }
      await refresh();
    },
    [authUrl, refresh],
  );

  const signup = useCallback<AuthContextValue["signup"]>(
    async (email, password, displayName) => {
      const res = await authFetch(authUrl, "/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "signup failed" }));
        throw new Error(typeof body.error === "string" ? body.error : "signup failed");
      }
      await refresh();
    },
    [authUrl, refresh],
  );

  const logout = useCallback<AuthContextValue["logout"]>(async () => {
    await authFetch(authUrl, "/logout", { method: "POST" });
    setState({ status: "signed-out", user: null });
  }, [authUrl]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      login,
      signup,
      logout,
      loginWithGoogle: googleEnabled ? loginWithGoogle : undefined,
      authError,
    }),
    [state, refresh, login, signup, logout, googleEnabled, loginWithGoogle, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** apps/auth reports a failed Google sign-in by redirecting back with `?auth_error=`. */
function readRedirectError(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("auth_error");
}

function clearRedirectError() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_error");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useSession(): AuthState {
  return useAuth().state;
}
