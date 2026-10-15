import { useMemo, useRef, useState } from "react";
import { checkStake } from "../../../../src/games/engine.js";
import { UTH_LIMITS, type UthView } from "../../../../src/games/uth/engine.js";
import type { HandRow } from "../../api";
import { ActionBar } from "../../components/ActionBar";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { chipsShort } from "../../format";
import { usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { resultText, useHand } from "../useHand";
import { type UthSceneView, createUthScene } from "./Scene";

const MULTIPLE: Record<string, number> = { bet4: 4, bet3: 3, bet2: 2, bet1: 1 };

export default function UthScreen() {
  const { player } = usePlayer();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("uth");
  // The Blind matches the Ante, so a chip on the Ante costs twice its value.
  const betting = useBetting(Math.floor(balance / 2), { max: UTH_LIMITS.max, chip: 25 });
  const placeRef = useRef(() => undefined as void);
  const [scene] = useState(() => createUthScene({ onAnteTap: () => placeRef.current() }));

  const hand = table.hand;
  const v = hand?.view as UthView | undefined;
  const betweenHands = !table.live;

  placeRef.current = () => {
    if (!betweenHands || table.busy) return;
    betting.place("ante");
    buzz(8);
  };

  const view = useMemo<UthSceneView>(
    () =>
      betweenHands && (betting.total > 0 || !hand)
        ? { id: "", hand: null, ante: betting.total }
        : { id: hand!.id, hand: hand!.view as UthView, ante: 0 },
    [betweenHands, betting.total, hand],
  );

  async function deal() {
    const reason = checkStake(betting.total, UTH_LIMITS);
    if (reason) return toast(reason[0].toUpperCase() + reason.slice(1), "loss");
    if (await table.start({ ante: betting.total })) {
      betting.commit();
      buzz(12);
    }
  }

  const ante = v?.ante ?? 0;
  const legal = (hand?.legal_actions ?? []).filter((a) => !(a in MULTIPLE) || balance >= MULTIPLE[a] * ante);
  const actions = [
    { type: "fold", label: "Fold" },
    { type: "check", label: "Check" },
    { type: "bet3", label: `3× · ${chipsShort(3 * ante)}` },
    { type: "bet4", label: `4× · ${chipsShort(4 * ante)}`, primary: true },
    { type: "bet2", label: `Bet 2× · ${chipsShort(2 * ante)}`, primary: true },
    { type: "bet1", label: `Bet 1× · ${chipsShort(ante)}`, primary: true },
  ];
  const short = (hand?.legal_actions ?? []).length > legal.length;
  const prompt = !betweenHands
    ? short
      ? "Not enough chips for every raise."
      : v?.street === "preflop"
        ? "Raise 4× or 3× now, or check and see the flop."
        : v?.street === "flop"
          ? "Raise 2×, or check to the river."
          : "Last call: play 1× or fold."
    : null;

  return (
    <TableFrame
      title="Ultimate Texas Hold'em"
      info={<Rules />}
      canvas={
        <TableCanvas
          scene={scene}
          view={table.resuming ? null : view}
          onShown={(s) => s.id && s.id === hand?.id && table.shown(hand, uthResult)}
          onError={(e) => toast(`Table error: ${String(e)}`, "loss")}
        />
      }
      above={prompt}
      bar={
        betweenHands ? (
          <BetBar
            chip={betting.chip}
            onChip={betting.setChip}
            total={betting.total * 2}
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

function uthResult(h: HandRow) {
  const v = h.view as UthView;
  if (v.folded) return { text: `Folded −${chipsShort(h.wagered)}`, tone: "loss" as const };
  const r = resultText(h);
  return v.showdown && v.showdown.winner === "player" ? { ...r, text: `${v.showdown.player.label}. ${r.text}` } : r;
}

function Rules() {
  return (
    <>
      <p>
        You and the dealer each get two cards and share five on the board. Put equal chips on the Ante and the Blind, then make one Play bet: 4× or 3×
        the ante before the flop, 2× after it, or 1× after the river (or fold). The best five-card hand wins.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Win: Ante and Play pay 1 to 1, the Blind by the table below.</li>
        <li>The dealer needs a pair or better to qualify; if not, the Ante pushes.</li>
        <li>Lose: Ante, Blind and Play lose. A tie pushes everything. Folding loses Ante and Blind.</li>
        <li>Ante 10 to 1,000. Payouts round down to whole chips.</li>
      </ul>
      <Paytable
        caption="Blind pays (when you win)"
        rows={[
          ["Royal flush", "500 to 1"],
          ["Straight flush", "50 to 1"],
          ["Four of a kind", "10 to 1"],
          ["Full house", "3 to 1"],
          ["Flush", "3 to 2"],
          ["Straight", "1 to 1"],
          ["Anything less", "push"],
        ]}
      />
    </>
  );
}
