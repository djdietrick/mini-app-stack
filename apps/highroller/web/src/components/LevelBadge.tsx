import { chips } from "../format";
import { usePlayer } from "../player";
import { href } from "../router";

/**
 * The level, a badge only: the number in a ring that fills toward the next
 * level. It links to the stats screen. Levels unlock nothing; they show how
 * much you have played.
 */
export function LevelBadge() {
  const { player } = usePlayer();
  if (!player) return null;
  const { level, level_xp: into, level_xp_needed: needed } = player;
  const frac = needed > 0 ? Math.min(1, into / needed) : 0;
  const r = 15;
  const c = 2 * Math.PI * r;
  const label = `Level ${level}: ${chips(into)} of ${chips(needed)} XP to level ${level + 1}`;

  return (
    <a href={href({ name: "stats" })} title={label} aria-label={label} className="focus-ring relative block h-9 w-9 shrink-0 rounded-full">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="#1a2a22" stroke="#2a3d33" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="#d4af37"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center font-mono text-[12px] font-bold text-gold-light">
        {level}
      </span>
    </a>
  );
}
