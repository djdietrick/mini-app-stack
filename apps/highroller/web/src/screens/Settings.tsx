import { useState } from "react";
import { api } from "../api";
import { play, unlockAudio } from "../audio/sfx";
import { useToast } from "../components/Toast";
import { PageTitle, Segmented, Toggle } from "../components/ui";
import { usePlayer } from "../player";
import { buzz, updateSettings, useSettings } from "../settings";

export function Settings() {
  const s = useSettings();
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <AccountSettings />
      <h2 className="label-caps mb-2 mt-6">On this device</h2>
      <div className="card divide-y divide-line">
        <Toggle
          label="Sound"
          hint="Cards, chips, the wheel and the reels. Off by default."
          checked={s.sound}
          onChange={(v) => {
            updateSettings({ sound: v });
            // This tap is the gesture browsers want before any sound can play.
            if (v) {
              unlockAudio();
              play("chip", 60);
            }
          }}
        />
        {s.sound && (
          <label className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
            <span className="text-[15px] font-medium">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.volume * 100)}
              aria-valuetext={`${Math.round(s.volume * 100)}%`}
              onChange={(e) => updateSettings({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => play("chip")}
              onKeyUp={() => play("chip")}
              className="focus-ring h-11 w-40 cursor-pointer accent-gold"
            />
          </label>
        )}
        <Toggle
          label="Haptics"
          hint={canVibrate ? "A short buzz on wins and on your turn." : "This device or browser can't vibrate."}
          checked={s.haptics}
          onChange={(v) => {
            updateSettings({ haptics: v });
            if (v) buzz();
          }}
        />
        <Segmented
          label="Deal speed"
          value={s.speed}
          options={[
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Fast" },
          ]}
          onChange={(v) => updateSettings({ speed: v })}
        />
        <Segmented
          label="Reduce motion"
          value={s.reducedMotion}
          options={[
            { value: "system", label: "System" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => updateSettings({ reducedMotion: v })}
        />
        <Toggle
          label="Battery saver"
          hint="Tables draw at a lower resolution and at most 30 frames a second, and the jackpot skips its coins. For older phones and long sessions."
          checked={s.batterySaver}
          onChange={(v) => updateSettings({ batterySaver: v })}
        />
      </div>
    </div>
  );
}

/** Settings kept on the server, so they follow you to every device. */
function AccountSettings() {
  const { player, set } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!player) return null;

  async function setListed(listed: boolean) {
    setBusy(true);
    try {
      const res = await api.setListed(listed);
      set({ ...player!, leaderboard_listed: res.leaderboard_listed });
    } catch {
      toast("Couldn't save that", "loss");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="label-caps mb-2">Your account</h2>
      <div className={"card divide-y divide-line " + (busy ? "opacity-60" : "")}>
        <Toggle
          label="Show me on leaderboards"
          hint="Off hides you from every board and shows your big wins as “A player”. Players can't find you to send gifts either. You still see your own rank."
          checked={player.leaderboard_listed}
          onChange={(v) => !busy && void setListed(v)}
        />
      </div>
    </>
  );
}
