import { useState, type ReactNode } from "react";
import { useSession } from "./context.js";
import { LoginForm } from "./LoginForm.js";
import { SignupForm } from "./SignupForm.js";

export interface AuthGateProps {
  /** Rendered once the user is signed in. */
  children: ReactNode;
  /** Optional element to render while /me is loading. Defaults to nothing. */
  loading?: ReactNode;
  /** Disable in-app signup if you want signups only via a dedicated UI. */
  allowSignup?: boolean;
}

/**
 * Wraps an app and renders the shared login/signup screens until a session
 * is established. Once signed in, `children` is rendered.
 */
export function AuthGate({ children, loading = null, allowSignup = true }: AuthGateProps) {
  const state = useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");

  if (state.status === "loading") return <>{loading}</>;
  if (state.status === "signed-in") return <>{children}</>;

  if (mode === "signup" && allowSignup) {
    return <SignupForm onSwitchToLogin={() => setMode("login")} />;
  }
  return <LoginForm onSwitchToSignup={allowSignup ? () => setMode("signup") : undefined} />;
}
