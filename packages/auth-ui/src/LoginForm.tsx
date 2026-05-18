import { useState, type FormEvent } from "react";
import { useAuth } from "./context.js";
import { styles } from "./styles.js";

export interface LoginFormProps {
  title?: string;
  onSuccess?: () => void;
  onSwitchToSignup?: () => void;
  className?: string;
}

export function LoginForm({ title = "Sign in", onSuccess, onSwitchToSignup, className }: LoginFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className} style={className ? undefined : styles.card}>
      <h2 style={styles.title}>{title}</h2>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />
      </div>
      <button type="submit" disabled={submitting} style={styles.button}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {error && <p style={styles.error}>{error}</p>}
      {onSwitchToSignup && (
        <p style={styles.hint}>
          No account?{" "}
          <a onClick={onSwitchToSignup} style={styles.link}>Create one</a>
        </p>
      )}
    </form>
  );
}
