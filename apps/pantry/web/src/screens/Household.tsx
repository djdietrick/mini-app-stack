import { useEffect, useState } from "react";
import { useSession } from "@stack/auth-ui";
import {
  api,
  ApiError,
  type CreatedInvite,
  type HouseholdInvite,
  type HouseholdMember,
  type HouseholdSummary,
} from "../api";
import { useHousehold } from "../household";
import { navigate } from "../App";

function inviteUrl(token: string): string {
  return `${window.location.origin}/#/invite/${encodeURIComponent(token)}`;
}

export function Household() {
  const { household, refresh } = useHousehold();
  const session = useSession();
  const myUserId = session.status === "signed-in" ? session.user.userId : null;
  const [all, setAll] = useState<HouseholdSummary[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const [createdToken, setCreatedToken] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwner = household?.role === "owner";

  const load = async () => {
    if (!household) return;
    try {
      const [hs, ms, ivs] = await Promise.all([
        api.households(),
        api.members(household.id),
        isOwner ? api.invites(household.id) : Promise.resolve([] as HouseholdInvite[]),
      ]);
      setAll(hs);
      setMembers(ms);
      setInvites(ivs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household?.id]);

  if (!household) return null;

  const switchTo = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.activateHousehold(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!nameInput.trim() || nameInput.trim() === household.name) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    try {
      await api.renameHousehold(household.id, { name: nameInput.trim() });
      setEditingName(false);
      await refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    const isSelf = userId === myUserId;
    const msg = isSelf
      ? `Leave "${household.name}"? You'll lose access to its pantry data.`
      : "Remove this member from the household?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.removeMember(household.id, userId);
      if (isSelf) {
        await refresh();
      } else {
        await load();
      }
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteHousehold = async () => {
    if (
      !window.confirm(
        `Delete "${household.name}"? All its items, tags, and lists will be erased for everyone. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.deleteHousehold(household.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createInvite(household.id);
      setCreatedToken(created);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (id: string) => {
    if (!window.confirm("Revoke this invite link?")) return;
    setBusy(true);
    try {
      await api.revokeInvite(household.id, id);
      if (createdToken?.id === id) setCreatedToken(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(createdToken.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallthrough — the URL is visible in the UI
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between gap-3">
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="text-2xl font-semibold tracking-tight bg-neutral-900 border border-neutral-700 rounded px-2 py-1 flex-1 min-w-0"
            />
          ) : (
            <h2 className="text-2xl font-semibold tracking-tight truncate">{household.name}</h2>
          )}
          {isOwner && !editingName && (
            <button
              type="button"
              onClick={() => {
                setNameInput(household.name);
                setEditingName(true);
              }}
              className="text-xs text-neutral-400 hover:text-neutral-100"
            >
              Rename
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          You are {household.role === "owner" ? "the owner" : "a member"} · {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
        </p>
      </div>

      {error && (
        <div className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-3 py-2">
          {error}
        </div>
      )}

      <section>
        <h3 className="text-sm uppercase tracking-wide text-neutral-500 mb-2">Members</h3>
        <ul className="border border-neutral-800 rounded-md divide-y divide-neutral-800">
          {members.map((m) => (
            <li key={m.user_id} className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm truncate">
                  {m.display_name || m.email}
                  {m.user_id === myUserId && (
                    <span className="ml-2 text-xs text-neutral-500">(you)</span>
                  )}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {m.role} · joined {new Date(m.joined_at).toLocaleDateString()}
                </div>
              </div>
              {(isOwner || m.user_id === myUserId) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeMember(m.user_id)}
                  className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50"
                >
                  {m.user_id === myUserId ? "Leave" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm uppercase tracking-wide text-neutral-500">Invites</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createInvite()}
              className="text-xs px-2.5 py-1 rounded bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              + New invite
            </button>
          </div>

          {createdToken && (
            <div className="border border-emerald-900 bg-emerald-950/40 rounded-md p-3 mb-3 space-y-2">
              <div className="text-xs text-emerald-300">
                Single-use link · expires{" "}
                {new Date(createdToken.expiresAt).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl(createdToken.token)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-neutral-900 border border-neutral-800 rounded"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={() => void copyInvite()}
                  className="text-xs px-2 py-1.5 rounded bg-neutral-100 text-neutral-900 hover:bg-white"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Share this link with one person. It works exactly once.
              </p>
            </div>
          )}

          {invites.length > 0 && (
            <ul className="border border-neutral-800 rounded-md divide-y divide-neutral-800">
              {invites.map((iv) => (
                <li key={iv.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  <div className="text-neutral-300">
                    Created {new Date(iv.created_at).toLocaleDateString()}
                    <span className="text-neutral-500">
                      {" · expires "}
                      {new Date(iv.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revokeInvite(iv.id)}
                    className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          {invites.length === 0 && !createdToken && (
            <p className="text-xs text-neutral-500">No active invites.</p>
          )}
        </section>
      )}

      {all.length > 1 && (
        <section>
          <h3 className="text-sm uppercase tracking-wide text-neutral-500 mb-2">
            Switch household
          </h3>
          <ul className="border border-neutral-800 rounded-md divide-y divide-neutral-800">
            {all.map((h) => (
              <li key={h.id} className="px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{h.name}</div>
                  <div className="text-xs text-neutral-500">
                    {h.role} · {h.member_count} {h.member_count === 1 ? "member" : "members"}
                  </div>
                </div>
                {h.active ? (
                  <span className="text-xs text-emerald-400">active</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void switchTo(h.id)}
                    className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500"
                  >
                    Switch
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isOwner && (
        <section>
          <h3 className="text-sm uppercase tracking-wide text-neutral-500 mb-2">Danger zone</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => void deleteHousehold()}
            className="text-sm px-3 py-2 rounded border border-rose-900 text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
          >
            Delete household
          </button>
        </section>
      )}

      <div>
        <button
          type="button"
          onClick={() => navigate("#/pantry")}
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          ← Back to pantry
        </button>
      </div>
    </div>
  );
}
