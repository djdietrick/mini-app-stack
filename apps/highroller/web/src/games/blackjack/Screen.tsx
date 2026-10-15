import { useMemo, useRef, useState } from "react";
import { BLACKJACK_LIMITS, type BlackjackView } from "../../../../src/games/blackjack/engine.js";
import { checkStake } from "../../../../src/games/engine.js";
import type { HandRow } from "../../api";
import { ActionBar } from "../../components/ActionBar";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { chips } from "../../format";
import { usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { resultText, useHand } from "../useHand";
import { type BlackjackSceneView, createBlackjackScene } from "./Scene";

const ACTIONS = [
  { type: "even_money", label: "Even money" },
  { type: "insurance", label: "Insurance" },
  { type: "no_insurance", label: "No insurance", primary: true },
  { type: "surrender", label: "Surrender" },
  { type: "split", label: "Split" },
  { type: "double", label: "Double" },
  { type: "hit", label: "Hit" },
  { type: "stand", label: "Stand", primary: true },
];

export default function BlackjackScreen() {
  const { player } = usePlayer();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("blackjack");
  const betting = useBetting(balance, { max: BLACKJACK_LIMITS.max, chip: 25 });
  const placeRef = useRef(() => undefined as void);
  const [scene] = useState(() => createBlackjackScene({ onSpotTap: () => placeRef.current() }));

  const hand = table.hand;
  const v = hand?.view as BlackjackView | undefined;
  const betweenHands = !table.live;

  placeRef.current = () => {
    if (!betweenHands || table.busy) return;
    betting.place("main");
    buzz(8);
  };

  // The last hand stays on the felt until chips go down for the next.
  const view = useMemo<BlackjackSceneView>(
    () =>
      betweenHands && (betting.total > 0 || !hand)
        ? { id: "", hand: null, bet: betting.total }
        : { id: hand!.id, hand: hand!.view as BlackjackView, bet: 0 },
    [betweenHands, betting.total, hand],
  );

  async function deal() {
    const reason = checkStake(betting.total, BLACKJACK_LIMITS);
    if (reason) return toast(reason[0].toUpperCase() + reason.slice(1), "loss");
    const started = await table.start({ main: betting.total });
    if (started) {
      betting.commit();
      buzz(12);
    }
  }

  // An extra wager only shows when the balance covers it.
  const active = v && v.active !== null ? v.hands[v.active] : null;
  const legal = (hand?.legal_actions ?? []).filter((a) => {
    if (a === "double" || a === "split") return !!active && balance >= active.bet;
    if (a === "insurance") return !!v && balance >= Math.floor(v.hands[0].bet / 2);
    return true;
  });

  const prompt =
    v?.phase === "insurance"
      ? legal.includes("even_money")
        ? "Blackjack against an ace: take even money?"
        : `Dealer shows an ace. Insurance costs ${chips(Math.floor(v.hands[0].bet / 2))}.`
      : null;

  return (
    <TableFrame
      title="Blackjack"
      info={<Rules />}
      canvas={
        <TableCanvas
          scene={scene}
          view={table.resuming ? null : view}
          onShown={(s) => s.id && s.id === hand?.id && table.shown(hand, blackjackResult)}
          onError={(e) => toast(`Table error: ${String(e)}`, "loss")}
        />
      }
      above={prompt}
      bar={
        betweenHands ? (
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
            busy={table.busy || table.resuming}
          />
        ) : (
          <ActionBar actions={ACTIONS} legal={legal} onAction={(t) => void table.act(t)} busy={table.busy} />
        )
      }
    />
  );
}

function blackjackResult(h: HandRow) {
  const v = h.view as BlackjackView;
  if (v.hands.length === 1 && v.hands[0].result?.outcome === "blackjack") {
    return { text: `Blackjack! +${chips(h.returned - h.wagered)}`, tone: "win" as const };
  }
  if (v.hands[0].result?.outcome === "surrender") return { text: `Surrendered −${chips(h.wagered - h.returned)}`, tone: "loss" as const };
  return resultText(h);
}

function Rules() {
  return (
    <>
      <p>
        Get closer to 21 than the dealer without going over. Court cards count 10, aces 1 or 11. Six decks, shuffled fresh every hand. The dealer
        stands on soft 17 and peeks for blackjack under an ace or a ten.
      </p>
      <Paytable
        caption="Pays"
        rows={[
          ["Blackjack", "3 to 2"],
          ["Win", "1 to 1"],
          ["Insurance", "2 to 1"],
          ["Surrender", "half back"],
        ]}
      />
      <ul className="list-disc space-y-1 pl-5">
        <li>Double on any first two cards, also after a split.</li>
        <li>Split pairs up to four hands. Split aces get one card each.</li>
        <li>Surrender your first two cards for half your bet back.</li>
        <li>Bets 10 to 5,000. Payouts round down to whole chips.</li>
      </ul>
    </>
  );
}
