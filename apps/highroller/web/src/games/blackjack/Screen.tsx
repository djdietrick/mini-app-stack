import { useMemo, useRef, useState } from "react";
import { BLACKJACK_LIMITS, type BlackjackView } from "../../../../src/games/blackjack/engine.js";
import { PAIR_NAMES, type PairHand, THREE_CARD_NAMES, type ThreeCardHand } from "../../../../src/games/blackjack/sidebets.js";
import { checkSideStake, checkStake } from "../../../../src/games/engine.js";
import type { HandRow } from "../../api";
import { ActionBar } from "../../components/ActionBar";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { chips } from "../../format";
import { useEquipped, usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { betsWords, describeBlackjack } from "../describe";
import { resultText, useHand } from "../useHand";
import { type BlackjackSceneView, SIDE_SPOTS, type Spot, createBlackjackScene } from "./Scene";

const ACTIONS = [
  { type: "even_money", label: "Even money", key: "e" },
  { type: "insurance", label: "Insurance", key: "i" },
  { type: "no_insurance", label: "No insurance", primary: true, key: "n" },
  { type: "surrender", label: "Surrender", key: "r" },
  { type: "split", label: "Split", key: "p" },
  { type: "double", label: "Double", key: "d" },
  { type: "hit", label: "Hit", key: "h" },
  { type: "stand", label: "Stand", primary: true, key: "s" },
];

const SPOTS = [
  { id: "main", label: "Main bet", key: "m" },
  { id: "perfectPairs", label: "Perfect Pairs", key: "p" },
  { id: "twentyOnePlusThree", label: "21+3", key: "t" },
];
const SPOT_NAMES = Object.fromEntries(SPOTS.map((s) => [s.id, s.label]));

export default function BlackjackScreen() {
  const { player } = usePlayer();
  const equipped = useEquipped();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("blackjack", { paidSoFar: sidesReturned });
  const betting = useBetting(balance, { max: (spot) => (spot === "main" ? BLACKJACK_LIMITS.max : BLACKJACK_LIMITS.side!.max), chip: 25 });
  const placeRef = useRef((_spot: Spot) => undefined as void);
  const [scene] = useState(() => createBlackjackScene({ onSpotTap: (spot) => placeRef.current(spot) }));

  const hand = table.hand;
  const v = hand?.view as BlackjackView | undefined;
  const betweenHands = !table.live;

  placeRef.current = (spot) => {
    if (!betweenHands || table.busy) return;
    betting.place(spot);
    buzz(8);
  };

  // The last hand stays on the felt until chips go down for the next.
  const view = useMemo<BlackjackSceneView>(
    () =>
      betweenHands && (betting.total > 0 || !hand)
        ? { id: "", hand: null, bets: betting.bets }
        : { id: hand!.id, hand: hand!.view as BlackjackView, bets: {} },
    [betweenHands, betting.total, betting.bets, hand],
  );

  async function deal() {
    const { main = 0, perfectPairs, twentyOnePlusThree } = betting.bets;
    if (!main) return toast("Put a bet on the main circle too", "loss");
    const reason =
      checkStake(main, BLACKJACK_LIMITS) ??
      checkSideStake("Perfect Pairs", perfectPairs, BLACKJACK_LIMITS) ??
      checkSideStake("21+3", twentyOnePlusThree, BLACKJACK_LIMITS);
    if (reason) return toast(reason[0].toUpperCase() + reason.slice(1), "loss");
    const started = await table.start({ main, ...(perfectPairs ? { perfectPairs } : {}), ...(twentyOnePlusThree ? { twentyOnePlusThree } : {}) });
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
      jackpot
      description={
        betweenHands && (betting.total > 0 || !table.shownHand)
          ? betsWords(betting.bets, SPOT_NAMES)
          : table.shownHand
            ? describeBlackjack(table.shownHand)
            : undefined
      }
      canvas={
        <TableCanvas
          scene={scene}
          equipped={equipped}
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
            spots={SPOTS}
            bets={betting.bets}
            onSpot={(s) => placeRef.current(s as Spot)}
          />
        ) : (
          <ActionBar actions={ACTIONS} legal={legal} onAction={(t) => void table.act(t)} busy={table.busy} />
        )
      }
    />
  );
}

/** Chips the side bets paid on the deal, for the balance pill to hold until they're shown. */
function sidesReturned(h: HandRow): number {
  const side = (h.view as BlackjackView).side;
  return (side?.perfectPairs?.returned ?? 0) + (side?.twentyOnePlusThree?.returned ?? 0);
}

function blackjackResult(h: HandRow) {
  const v = h.view as BlackjackView;
  if (h.status !== "settled") {
    // Mid-hand, only a side bet that won is news.
    const wins = SIDE_SPOTS.flatMap((k) => {
      const r = v.side?.[k];
      if (!r?.hand) return [];
      const name = k === "perfectPairs" ? PAIR_NAMES[r.hand as PairHand] : THREE_CARD_NAMES[r.hand as ThreeCardHand];
      return [`${k === "perfectPairs" ? name : `21+3 ${name.toLowerCase()}`} +${chips(r.returned - r.stake)}`];
    });
    return wins.length ? { text: wins.join(" · "), tone: "win" as const } : null;
  }
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
      <p>
        Side bets, 5 to 500 each, are settled and paid as soon as the first cards are down, whatever happens to the hand. Perfect Pairs is on your
        first two cards; 21+3 is your first two cards with the dealer's up card, as a three-card poker hand.
      </p>
      <Paytable
        caption="Perfect Pairs"
        rows={[
          ["Perfect pair (same suit)", "25 to 1"],
          ["Coloured pair (same colour)", "12 to 1"],
          ["Mixed pair", "6 to 1"],
        ]}
      />
      <Paytable
        caption="21+3"
        rows={[
          ["Suited three of a kind", "100 to 1"],
          ["Straight flush", "40 to 1"],
          ["Three of a kind", "30 to 1"],
          ["Straight", "10 to 1"],
          ["Flush", "5 to 1"],
        ]}
      />
    </>
  );
}
