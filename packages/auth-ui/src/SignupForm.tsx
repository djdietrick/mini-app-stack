import { useState, type FormEvent } from "react";
import { useAuth } from "./context.js";
import { styles } from "./styles.js";

export interface SignupFormProps {
  title?: string;
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
  className?: string;
}

export function SignupForm({ title = "Create account", onSuccess, onSwitchToLogin, className }: SignupFormProps) {
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, displayName || undefined);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "signup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className} style={className ? undefined : styles.card}>
      <h2 style={styles.title}>{title}</h2>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="signup-name">Display name (optional)</label>
        <input
          id="signup-name"
          type="text"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={styles.input}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="signup-password">Password (min 8 chars)</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />
      </div>
      <button type="submit" disabled={submitting} style={styles.button}>
        {submitting ? "Creating…" : "Create account"}
      </button>
      {error && <p style={styles.error}>{error}</p>}
      {onSwitchToLogin && (
        <p style={styles.hint}>
          Already have an account?{" "}
          <a onClick={onSwitchToLogin} style={styles.link}>Sign in</a>
        </p>
      )}
    </form>
  );
}
