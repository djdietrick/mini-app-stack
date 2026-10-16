import { useEffect, useMemo, useRef, useState } from "react";
import { COIN_VALUES, HAND_NAMES, MAX_COINS, type VideoPokerView, VP_HANDS, payFor } from "../../../../src/games/videopoker/engine.js";
import { simpleHold } from "../../../../src/games/videopoker/strategy.js";
import type { HandRow } from "../../api";
import { useToast } from "../../components/Toast";
import { chips } from "../../format";
import { useEquipped, usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { Paytable, TableFrame } from "../TableFrame";
import { resultText, useHand } from "../useHand";
import { type VideoPokerSceneView, createVideoPokerScene } from "./Scene";

const NONE = [false, false, false, false, false];

export default function VideoPokerScreen() {
  const { player } = usePlayer();
  const equipped = useEquipped();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("videopoker");
  const [coins, setCoins] = useState(MAX_COINS);
  const [coinValue, setCoinValue] = useState<number>(COIN_VALUES[0]);
  const [held, setHeld] = useState<boolean[]>(NONE);
  const hand = table.hand;
  const v = hand?.view as VideoPokerView | undefined;
  const live = table.live;

  const toggleRef = useRef((_i: number) => undefined as void);
  toggleRef.current = (i) => {
    if (!live || table.busy) return;
    setHeld((h) => h.map((x, k) => (k === i ? !x : x)));
    buzz(6);
  };
  const [scene] = useState(() => createVideoPokerScene({ onToggle: (i) => toggleRef.current(i) }));

  // A new hand starts with nothing held.
  useEffect(() => setHeld(NONE), [hand?.id]);

  const view = useMemo<VideoPokerSceneView>(() => {
    if (!hand || !v) return { id: "", phase: "idle", cards: [null, null, null, null, null], held: NONE, coins, hand: null, returned: null };
    return {
      id: hand.id,
      phase: v.phase,
      cards: v.cards,
      held: v.held ?? held,
      coins: live ? v.coins : coins,
      hand: v.phase === "done" ? v.hand : null,
      returned: v.returned,
    };
  }, [hand, v, held, coins, live]);

  async function deal(n = coins) {
    if (n * coinValue > balance) return toast("Not enough chips", "loss");
    setCoins(n);
    if (await table.start({ coins: n, coinValue })) buzz(12);
  }

  async function draw() {
    await table.act({ type: "draw", hold: held });
  }

  const stake = coins * coinValue;
  const busy = table.busy || table.resuming;

  return (
    <TableFrame
      title="Jacks or Better"
      info={<Rules />}
      canvas={
        <TableCanvas
          scene={scene}
          equipped={equipped}
          view={table.resuming ? null : view}
          onShown={(s) => s.phase === "done" && s.id === hand?.id && table.shown(hand, vpResult)}
          onError={(e) => toast(`Table error: ${String(e)}`, "loss")}
        />
      }
      above={
        live ? (
          <span>
            {v && v.hand !== "nothing" ? `${HAND_NAMES[v.hand]} dealt. ` : ""}Tap cards to hold, then draw.
          </span>
        ) : (
          <span className="font-mono tabular">
            Bet {coins} coin{coins > 1 ? "s" : ""} × {coinValue} = {chips(stake)}
            {coins < MAX_COINS && <span className="text-muted"> · the royal pays 4,000 coins at 5</span>}
          </span>
        )
      }
      bar={
        <div className="flex flex-col gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-2 backdrop-blur">
          {live ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn px-4" disabled={busy} onClick={() => setHeld(simpleHold(v!.dealt))}>
                Hint
              </button>
              <button type="button" className="btn px-4" disabled={busy || !held.some(Boolean)} onClick={() => setHeld(NONE)}>
                Clear
              </button>
              <button type="button" className="btn-primary min-h-[52px] flex-1" disabled={busy} onClick={() => void draw()}>
                Draw
              </button>
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Coin value" className="grid grid-cols-3 gap-2">
                {COIN_VALUES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={coinValue === c}
                    className={(coinValue === c ? "btn-primary" : "btn") + " min-h-[44px]"}
                    disabled={busy}
                    onClick={() => setCoinValue(c)}
                  >
                    {c} a coin
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn px-3" disabled={busy} onClick={() => setCoins((n) => (n % MAX_COINS) + 1)}>
                  Bet one
                </button>
                <button type="button" className="btn px-3" disabled={busy} onClick={() => void deal(MAX_COINS)}>
                  Bet max
                </button>
                <button type="button" className="btn-primary min-h-[52px] flex-1" disabled={busy || stake > balance} onClick={() => void deal()}>
                  Deal <span className="font-mono tabular">{chips(stake)}</span>
                </button>
              </div>
            </>
          )}
        </div>
      }
    />
  );
}

function vpResult(h: HandRow) {
  const v = h.view as VideoPokerView;
  const r = resultText(h)!;
  return v.hand === "nothing" ? r : { ...r, text: `${HAND_NAMES[v.hand]}. ${r.text}` };
}

function Rules() {
  return (
    <>
      <p>
        Bet 1 to 5 coins at 5, 25 or 100 chips a coin and take five cards. Tap the ones you want to keep, then draw: the others are replaced from the
        same deck. Pays are per coin and include your bet, so a high pair gives your coins back.
      </p>
      <p>The royal flush pays 250 a coin, or 800 a coin when you bet all 5, so always bet 5 if you can.</p>
      <Paytable
        caption="Pays per coin (9/6 Jacks or Better)"
        rows={VP_HANDS.filter((h) => h !== "nothing").map((h) => [HAND_NAMES[h], h === "royal_flush" ? "250 (800 at 5 coins)" : String(payFor(h, 1))])}
      />
      <p className="text-muted">With perfect play this table returns 99.54% at 5 coins. Hint holds by a simple strategy that returns 99.46%.</p>
    </>
  );
}
