import { useEffect, useRef, useState } from "react";
import { type Card, seededRng, shoe } from "../../../src/games/index.js";
import { ActionBar } from "../components/ActionBar";
import { BetBar } from "../components/BetBar";
import { useToast } from "../components/Toast";
import { chips } from "../format";
import { usePlayer } from "../player";
import { buzz } from "../settings";
import { TableCanvas } from "../table/TableCanvas";
import { useBetting } from "../table/betting";
import { type DemoView, createDemoScene } from "../table/demoScene";

/**
 * Dev-only bench for the table kit, for checking frame rate, sharpness and
 * resizing on real phones (run `pnpm --filter @stack/highroller dev:web
 * --host` and open #/table-demo). The deal is made up here in the browser,
 * which no real game ever does, and no chips move: the balance is only used
 * to size bets and as the payout animation's target.
 */
export default function TableDemo() {
  const { player } = usePlayer();
  const toast = useToast();
  const balance = player?.balance ?? 10_000;
  const betting = useBetting(balance, { max: 5_000 });
  const [scene] = useState(() =>
    createDemoScene({
      onSpotTap: (spot) => placeRef.current(spot),
      onZoneTap: (n) => toast(`Block ${n + 1}: zoomed in`, "info"),
    }),
  );
  const placeRef = useRef<(spot: string) => void>(() => undefined);
  const deck = useRef<Card[]>([]);
  const [view, setView] = useState<DemoView>({ round: 0, bet: 0, dealer: [], player: [], payout: null });

  const phase = view.payout !== null ? "done" : view.player.length ? "playing" : "betting";
  placeRef.current = (spot) => {
    if (phase !== "betting") return;
    betting.place(spot);
    buzz(8);
  };

  // While betting, the stack on the felt follows the bet bar.
  useEffect(() => {
    if (phase === "betting") setView((v) => ({ ...v, bet: betting.total }));
  }, [betting.total, phase]);

  const draw = (): Card => {
    if (deck.current.length < 10) deck.current = shoe(6, seededRng(Date.now() >>> 0));
    return deck.current.pop()!;
  };

  function deal() {
    const bet = betting.total;
    betting.commit();
    setView((v) => ({ ...v, bet, dealer: [draw(), null], player: [draw(), draw()], payout: null }));
    buzz(12);
  }

  function act(type: string) {
    if (type === "hit") setView((v) => ({ ...v, player: [...v.player, draw()] }));
    if (type === "stand") {
      const won = Math.random() < 0.5;
      setView((v) => ({ ...v, dealer: [v.dealer[0], draw(), ...(Math.random() < 0.4 ? [draw()] : [])], payout: won ? v.bet * 2 : 0 }));
      if (won) buzz([10, 40, 10]);
      toast(won ? `Win +${chips(view.bet)}` : `Lose −${chips(view.bet)}`, won ? "win" : "loss");
    }
    if (type === "next") setView((v) => ({ round: v.round + 1, bet: 0, dealer: [], player: [], payout: null }));
  }

  return (
    <div className="table-screen flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[360px] flex-1 bg-felt-dark">
        <div className="absolute inset-0">
          <TableCanvas scene={scene} view={view} onError={(e) => toast(`Table error: ${String(e)}`, "loss")} />
        </div>
      </div>
      <div className="pb-safe sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 lg:bottom-0">
        {phase === "betting" ? (
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
            onDeal={deal}
          />
        ) : (
          <ActionBar
            actions={[
              { type: "hit", label: "Hit" },
              { type: "stand", label: "Stand", primary: true },
              { type: "next", label: "Next hand", primary: true },
            ]}
            legal={phase === "playing" ? ["hit", "stand"] : ["next"]}
            onAction={act}
          />
        )}
      </div>
    </div>
  );
}
