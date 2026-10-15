import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROULETTE_LIMITS,
  type RouletteView,
  type Variant,
  betFromKey,
  pocketColor,
  pocketLabel,
} from "../../../../src/games/roulette/engine.js";
import { type HandRow, api } from "../../api";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { chips } from "../../format";
import { usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { resultText, useHand } from "../useHand";
import { type RouletteSceneView, createRouletteScene } from "./Scene";

const HISTORY = 12;

export default function RouletteScreen({ variant: requested }: { variant: string | null }) {
  const variant: Variant = requested === "american" ? "american" : "european";
  const { player } = usePlayer();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("roulette");
  const betting = useBetting(balance, { max: ROULETTE_LIMITS.max, chip: 25 });
  const [zoomed, setZoomed] = useState(false);
  const [spinning, setSpinning] = useState<HandRow | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const placeRef = useRef((_key: string) => undefined as void);
  const [scene] = useState(() =>
    createRouletteScene({ variant, onBet: (key) => placeRef.current(key), onZoom: setZoomed }),
  );

  placeRef.current = (key) => {
    if (spinning || table.busy) return;
    betting.place(key);
    buzz(8);
  };

  // The last results on this wheel.
  useEffect(() => {
    let live = true;
    api
      .hands({ game: "roulette", limit: 40 })
      .then((page) => {
        if (!live) return;
        const mine = page.hands.filter((h) => h.variant === variant).map((h) => (h.view as RouletteView).pocket);
        setHistory(mine.slice(0, HISTORY));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [variant]);

  const view = useMemo<RouletteSceneView>(() => {
    if (spinning) {
      const v = spinning.view as RouletteView;
      return { variant, bets: {}, spin: { id: spinning.id, pocket: v.pocket, bets: v.bets } };
    }
    return { variant, bets: betting.bets, spin: null };
  }, [variant, spinning, betting.bets]);

  async function spin() {
    if (betting.total > (ROULETTE_LIMITS.total ?? Infinity)) return toast(`The table maximum is ${chips(ROULETTE_LIMITS.total!)}`, "loss");
    const bets = Object.entries(betting.bets).map(([key, amount]) => ({ ...betFromKey(key), amount }));
    const hand = await table.start(bets, variant);
    if (hand) {
      betting.commit();
      setSpinning(hand);
      buzz(12);
    }
  }

  function shown(s: RouletteSceneView) {
    if (!s.spin || s.spin.id !== spinning?.id) return;
    table.shown(spinning, rouletteResult);
    setHistory((h) => [s.spin!.pocket, ...h].slice(0, HISTORY));
    setSpinning(null);
  }

  return (
    <TableFrame
      title={variant === "american" ? "American roulette" : "European roulette"}
      info={<Rules variant={variant} />}
      canvas={<TableCanvas scene={scene} view={view} onShown={shown} onError={(e) => toast(`Table error: ${String(e)}`, "loss")} />}
      overlay={
        zoomed && !spinning ? (
          <button type="button" className="btn absolute right-2 top-14 z-10 min-h-[40px] bg-raised/85 px-3 text-[14px] backdrop-blur" onClick={() => scene.zoomOut()}>
            Zoom out
          </button>
        ) : null
      }
      above={<History pockets={history} />}
      bar={
        <BetBar
          chip={betting.chip}
          onChip={betting.setChip}
          total={betting.total}
          balance={balance}
          canRebet={!!betting.last}
          onUndo={betting.undo}
          onClear={betting.clear}
          onRebet={betting.rebet}
          onDouble={betting.double}
          onDeal={spin}
          dealLabel="Spin"
          busy={table.busy || !!spinning}
        />
      }
    />
  );
}

function rouletteResult(h: HandRow) {
  const v = h.view as RouletteView;
  const r = resultText(h);
  return { ...r, text: `${pocketLabel(v.pocket)} ${pocketColor(v.pocket)}. ${r.text}` };
}

function History({ pockets }: { pockets: number[] }) {
  if (!pockets.length) return <span className="text-muted">Tap the felt to bet. Tap the numbers to zoom in.</span>;
  return (
    <ol aria-label="Last results, newest first" className="flex items-center justify-center gap-1 overflow-hidden">
      {pockets.map((p, i) => {
        const c = pocketColor(p);
        return (
          <li
            key={i}
            className={
              "flex h-7 min-w-[28px] items-center justify-center rounded-md px-1 font-mono text-[12px] font-bold " +
              (c === "red" ? "bg-[#b91c1c] text-white" : c === "green" ? "bg-[#15803d] text-white" : "bg-[#161616] text-white") +
              (i === 0 ? " ring-2 ring-gold" : " opacity-85")
            }
          >
            {pocketLabel(p)}
          </li>
        );
      })}
    </ol>
  );
}

function Rules({ variant }: { variant: Variant }) {
  return (
    <>
      <p>
        {variant === "american"
          ? "Thirty-eight pockets: 1 to 36, 0 and 00. The house edge is 5.26% (7.89% on the top line)."
          : "Thirty-seven pockets: 1 to 36 and a single 0. The house edge is 2.70%."}{" "}
        Bet on as many spots as you like, then spin.
      </p>
      <p>
        Tap a column or an outside bet to place a chip. Tap the numbers to zoom in, then tap a number for a straight bet, a line between two for a
        split, a corner for four, the left edge of a row for a street (or between rows for six).
      </p>
      <Paytable
        caption="Pays"
        rows={[
          ["Straight (one number)", "35 to 1"],
          ["Split (two)", "17 to 1"],
          ["Street (three)", "11 to 1"],
          ["Corner (four)", "8 to 1"],
          ...(variant === "american" ? ([["Top line (0, 00, 1, 2, 3)", "6 to 1"]] as [string, string][]) : []),
          ["Six line", "5 to 1"],
          ["Dozen, column", "2 to 1"],
          ["Red, black, odd, even, 1–18, 19–36", "1 to 1"],
        ]}
      />
      <p className="text-muted">Chips 5 to 1,000 a spot, up to 10,000 a spin.</p>
    </>
  );
}
