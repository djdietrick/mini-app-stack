import { useEffect, useState } from "react";
import { useAuth, useSession } from "@stack/auth-ui";
import { api } from "../api";
import { ErrorNote, PageTitle, Section, Segmented, useAction } from "../components/ui";
import { type PushState, disablePush, enablePush, pushState } from "../push";
import { updatePrefs, usePrefs } from "../settings";

export function Settings() {
  const prefs = usePrefs();
  const session = useSession();
  const { logout } = useAuth();

  return (
    <div>
      <PageTitle>Settings</PageTitle>

      <Notifications />

      <Section title="Temperature">
        <Segmented
          label="Temperature unit"
          value={prefs.tempUnit}
          options={[
            { value: "F", label: "°F" },
            { value: "C", label: "°C" },
          ]}
          onChange={(tempUnit) => updatePrefs({ tempUnit })}
        />
      </Section>

      <Section title="Account">
        <div className="card flex items-center justify-between gap-3 p-4">
          <span className="min-w-0 truncate text-muted">{session.status === "signed-in" ? session.user.email : ""}</span>
          <button type="button" className="btn shrink-0 whitespace-nowrap" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </Section>
    </div>
  );
}

function Notifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [tested, setTested] = useState<number | null>(null);
  const action = useAction();

  useEffect(() => {
    pushState().then(setState, () => setState({ kind: "unsupported", reason: "Couldn't check notification support." }));
  }, []);

  return (
    <Section title="Notifications on this device">
      <div className="card flex flex-col gap-3 p-4">
        {state === null && <p className="text-muted">Checking…</p>}
        {state?.kind === "needs-install" && (
          <p>
            On iPhone and iPad, notifications only work from the Home Screen. Tap <strong>Share</strong>, then{" "}
            <strong>Add to Home Screen</strong>, open Crumb from there and come back here.
          </p>
        )}
        {state?.kind === "unsupported" && <p className="text-muted">{state.reason} Reminders only arrive as notifications, so this device won't get them.</p>}
        {state?.kind === "blocked" && (
          <p>Notifications are blocked for Crumb. Allow them in your browser or phone settings, then reload.</p>
        )}
        {state?.kind === "off" && (
          <>
            <p className="text-muted">Get a nudge on this device when it's time to feed, fold, shape or bake.</p>
            <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void action.run(async () => setState(await enablePush()))}>
              Turn on notifications
            </button>
          </>
        )}
        {state?.kind === "on" && (
          <>
            <p>Notifications are on for this device.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                disabled={action.busy}
                onClick={() => void action.run(async () => setTested((await api.testPush()).sent))}
              >
                Send a test
              </button>
              <button type="button" className="btn" disabled={action.busy} onClick={() => void action.run(async () => setState(await disablePush()))}>
                Turn off
              </button>
            </div>
            {tested !== null && (
              <p className="text-sm text-muted">
                {tested ? `Sent to ${tested} device${tested === 1 ? "" : "s"}.` : "No device took it. Try turning notifications off and on again."}
              </p>
            )}
          </>
        )}
        {action.error && <ErrorNote error={action.error} />}
      </div>
    </Section>
  );
}
