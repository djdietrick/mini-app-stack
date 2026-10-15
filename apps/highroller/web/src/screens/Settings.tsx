import { PageTitle, Segmented, Toggle } from "../components/ui";
import { buzz, updateSettings, useSettings } from "../settings";

export function Settings() {
  const s = useSettings();
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

  return (
    <div>
      <PageTitle sub="Saved on this device.">Settings</PageTitle>
      <div className="card divide-y divide-line">
        <Toggle label="Sound" hint="Off by default." checked={s.sound} onChange={(v) => updateSettings({ sound: v })} />
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
      </div>
    </div>
  );
}
