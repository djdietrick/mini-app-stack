import { useState } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import { api, ApiError } from "../api";
import { useHousehold } from "../household";

type Mode = "choose" | "create" | "join";

export function Onboarding() {
  const [mode, setMode] = useState<Mode>("choose");
  const [name, setName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useHousehold();
  const { logout } = useAuth();
  const session = useSession();
  const userLabel =
    session.status === "signed-in" ? session.user.displayName || session.user.email : "";

  const createHousehold = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHousehold({ name: name.trim() });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const extractToken = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Accept either a raw token or a full URL like https://.../invite/<token>
    const m = trimmed.match(/\/invite\/([^/?#]+)/);
    return m ? m[1] : trimmed;
  };

  const joinHousehold = async () => {
    const token = extractToken(inviteInput);
    if (!token) {
      setError("Paste an invite link or token");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite(token);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setError("Invite expired or already used");
      else if (e instanceof ApiError && e.status === 404) setError("Invite not found");
      else setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Welcome to Pantry
          </h1>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-xs text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
        {userLabel && (
          <p className="text-xs text-ink-soft mb-6 truncate" title={userLabel}>
            Signed in as {userLabel}
          </p>
        )}

        {mode === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted mb-4">
              Pantry is organized around households. Create one for yourself, or join one a
              partner/roommate has shared with you.
            </p>
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setError(null);
              }}
              className="w-full px-4 py-3 rounded-md bg-apple-500 text-white hover:bg-apple-600 text-sm font-medium transition"
            >
              Create a household
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("join");
                setError(null);
              }}
              className="w-full px-4 py-3 rounded-md border border-cream-300 bg-white text-ink hover:border-apple-400 text-sm transition"
            >
              I have an invite link
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-wide text-ink-soft font-sans">
              Household name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Smiths"
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
            />
            {error && <div className="text-sm text-apple-700">{error}</div>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("choose")}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md text-ink hover:bg-cream-200 transition"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void createHousehold()}
                disabled={busy}
                className="ml-auto px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 disabled:opacity-50 transition"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {mode === "join" && (
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-wide text-ink-soft font-sans">
              Invite link or token
            </label>
            <input
              autoFocus
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              placeholder="https://.../invite/abc123"
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
            />
            {error && <div className="text-sm text-apple-700">{error}</div>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("choose")}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md text-ink hover:bg-cream-200 transition"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void joinHousehold()}
                disabled={busy}
                className="ml-auto px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 disabled:opacity-50 transition"
              >
                Join
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
