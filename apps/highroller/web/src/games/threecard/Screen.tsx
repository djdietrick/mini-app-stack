import { useMemo, useRef, useState } from "react";
import { checkSideStake, checkStake } from "../../../../src/games/engine.js";
import { THREECARD_LIMITS, type ThreeCardView } from "../../../../src/games/threecard/engine.js";
import type { HandRow } from "../../api";
import { ActionBar } from "../../components/ActionBar";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { chipsShort, signed } from "../../format";
import { useEquipped, usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { resultText, useHand } from "../useHand";
import { type ThreeCardSceneView, createThreeCardScene } from "./Scene";

export default function ThreeCardScreen() {
  const { player } = usePlayer();
  const equipped = useEquipped();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("threecard");
  const betting = useBetting(balance, {
    max: (spot) => (spot === "ante" ? THREECARD_LIMITS.max : THREECARD_LIMITS.side!.max),
    chip: 25,
  });
  const placeRef = useRef((_spot: "ante" | "pairPlus") => undefined as void);
  const [scene] = useState(() => createThreeCardScene({ onSpotTap: (spot) => placeRef.current(spot) }));

  const hand = table.hand;
  const v = hand?.view as ThreeCardView | undefined;
  const betweenHands = !table.live;

  placeRef.current = (spot) => {
    if (!betweenHands || table.busy) return;
    betting.place(spot);
    buzz(8);
  };

  const view = useMemo<ThreeCardSceneView>(
    () =>
      betweenHands && (betting.total > 0 || !hand)
        ? { id: "", hand: null, ante: betting.bets.ante ?? 0, pairPlus: betting.bets.pairPlus ?? 0 }
        : { id: hand!.id, hand: hand!.view as ThreeCardView, ante: 0, pairPlus: 0 },
    [betweenHands, betting.total, betting.bets, hand],
  );

  async function deal() {
    const { ante = 0, pairPlus } = betting.bets;
    if (!ante) return toast("Put a bet on the Ante too", "loss");
    const reason = checkStake(ante, THREECARD_LIMITS) ?? checkSideStake("Pair Plus", pairPlus, THREECARD_LIMITS);
    if (reason) return toast(reason[0].toUpperCase() + reason.slice(1), "loss");
    if (await table.start({ ante, ...(pairPlus ? { pairPlus } : {}) })) {
      betting.commit();
      buzz(12);
    }
  }

  const ante = v?.ante ?? 0;
  // Play costs another ante; fold is always there.
  const legal = (hand?.legal_actions ?? []).filter((a) => a !== "play" || balance >= ante);
  const actions = [
    { type: "fold", label: "Fold" },
    { type: "play", label: `Play · ${chipsShort(ante)}`, primary: true },
  ];

  return (
    <TableFrame
      title="Three Card Poker"
      info={<Rules />}
      canvas={
        <TableCanvas
          scene={scene}
          equipped={equipped}
          view={table.resuming ? null : view}
          onShown={(s) => s.id && s.id === hand?.id && table.shown(hand, threeCardResult)}
          onError={(e) => toast(`Table error: ${String(e)}`, "loss")}
        />
      }
      above={
        betweenHands
          ? null
          : legal.includes("play")
            ? `${v?.label ?? ""}. Play for another ${chipsShort(ante)}, or fold.`
            : "Not enough chips to play: fold, or top up."
      }
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
          <ActionBar actions={actions} legal={legal} onAction={(t) => void table.act(t)} busy={table.busy} />
        )
      }
    />
  );
}

function threeCardResult(h: HandRow) {
  const v = h.view as ThreeCardView;
  const net = h.returned - h.wagered;
  if (v.folded) return { text: `Folded ${signed(net)}${v.returned?.pairPlus ? " (Pair Plus paid)" : ""}`, tone: net > 0 ? ("win" as const) : ("loss" as const) };
  const r = resultText(h)!;
  return v.showdown?.winner === "player" || v.returned?.anteBonus ? { ...r, text: `${v.label}. ${r.text}` } : r;
}

function Rules() {
  return (
    <>
      <p>
        You and the dealer get three cards each. Put chips on the Ante, look at your cards, then play (another bet the size of the Ante) or fold.
        A straight beats a flush with three cards, and three of a kind beats both.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>The dealer needs queen high or better to qualify. If not, the Ante pays 1 to 1 and the Play bet pushes.</li>
        <li>If the dealer qualifies, the higher hand wins: Ante and Play pay 1 to 1. A tie pushes both.</li>
        <li>Folding loses the Ante. Best play: play queen-six-four or better, fold anything less.</li>
        <li>Ante 10 to 2,500. Pair Plus (optional, 5 to 500) pays on your own hand, even if you fold.</li>
      </ul>
      <Paytable
        caption="Ante bonus (when you play, whatever the dealer has)"
        rows={[
          ["Straight flush", "5 to 1"],
          ["Three of a kind", "4 to 1"],
          ["Straight", "1 to 1"],
        ]}
      />
      <Paytable
        caption="Pair Plus"
        rows={[
          ["Straight flush", "40 to 1"],
          ["Three of a kind", "30 to 1"],
          ["Straight", "6 to 1"],
          ["Flush", "4 to 1"],
          ["Pair", "1 to 1"],
        ]}
      />
      <p className="text-muted">House edge: 3.37% of the Ante with best play; 2.32% on Pair Plus.</p>
    </>
  );
}
