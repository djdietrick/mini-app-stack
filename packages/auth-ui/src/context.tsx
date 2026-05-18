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

interface AuthContextValue {
  state: AuthState;
  /** Re-fetch /me. Useful after a login/signup completes. */
  refresh: () => Promise<void>;
  /** POST credentials to authUrl/login, then refresh. Throws on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** POST credentials to authUrl/signup, then refresh. Throws on failure. */
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  /** POST authUrl/logout and refresh. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    () => ({ state, refresh, login, signup, logout }),
    [state, refresh, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useSession(): AuthState {
  return useAuth().state;
}
