import { useEffect, useState } from "react";
import { api, ApiError, type InvitePreview } from "../api";
import { useHousehold } from "../household";
import { navigate } from "../App";

interface Props {
  token: string;
}

export function InviteAccept({ token }: Props) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useHousehold();

  useEffect(() => {
    (async () => {
      try {
        const p = await api.previewInvite(token);
        setPreview(p);
      } catch (e) {
        if (e instanceof ApiError && e.status === 410) setError("This invite has expired or already been used.");
        else if (e instanceof ApiError && e.status === 404) setError("Invite not found.");
        else setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite(token);
      await refresh();
      navigate("#/pantry");
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setError("This invite has expired or already been used.");
      else setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold mb-2">Can't use this invite</h1>
            <p className="text-sm text-neutral-400 mb-6">{error}</p>
            <button
              type="button"
              onClick={() => navigate("#/pantry")}
              className="text-sm px-4 py-2 rounded-md border border-neutral-700 hover:border-neutral-500"
            >
              Go home
            </button>
          </>
        ) : preview ? (
          <>
            <h1 className="text-xl font-semibold mb-2">Join "{preview.householdName}"?</h1>
            <p className="text-sm text-neutral-400 mb-6">
              {preview.inviterName} invited you. You'll share their pantry items, tags, and grocery
              lists.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => navigate("#/pantry")}
                className="px-4 py-2 text-sm rounded-md text-neutral-300 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void accept()}
                className="px-4 py-2 text-sm font-medium rounded-md bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-50"
              >
                Join household
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-500">Loading invite…</p>
        )}
      </div>
    </div>
  );
}
