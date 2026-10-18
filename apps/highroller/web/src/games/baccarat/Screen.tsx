import { useEffect, useMemo, useRef, useState } from "react";
import { BACCARAT_LIMITS, type BaccaratView, SPOTS, type Spot, type Winner } from "../../../../src/games/baccarat/engine.js";
import { checkStake } from "../../../../src/games/engine.js";
import { type HandRow, api } from "../../api";
import { BetBar } from "../../components/BetBar";
import { useToast } from "../../components/Toast";
import { useEquipped, usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { useBetting } from "../../table/betting";
import { Paytable, TableFrame } from "../TableFrame";
import { betsWords, describeBaccarat } from "../describe";
import { resultText, useHand } from "../useHand";
import { type BaccaratSceneView, coupText, createBaccaratScene } from "./Scene";

/**
 * The bead plate's size: read down then across, like the table's scoreboard,
 * but three rows rather than six so the strip stays one line tall on a phone.
 */
const PLATE_ROWS = 3;
const PLATE = 30;

export default function BaccaratScreen() {
  const { player } = usePlayer();
  const equipped = useEquipped();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("baccarat");
  const betting = useBetting(balance, { max: BACCARAT_LIMITS.max, chip: 25 });
  /** The coup on the table, until chips go down for the next one. */
  const [last, setLast] = useState<HandRow | null>(null);
  const [showing, setShowing] = useState(false);
  const [beads, setBeads] = useState<Winner[]>([]);
  const placeRef = useRef((_spot: Spot) => undefined as void);
  const [scene] = useState(() => createBaccaratScene({ onSpotTap: (spot) => placeRef.current(spot) }));

  placeRef.current = (spot) => {
    if (showing || table.busy) return;
    betting.place(spot);
    buzz(8);
  };

  // The last results, oldest first.
  useEffect(() => {
    let live = true;
    api
      .hands({ game: "baccarat", limit: PLATE })
      .then((page) => live && setBeads(page.hands.map((h) => (h.view as BaccaratView).winner).reverse()))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const view = useMemo<BaccaratSceneView>(
    () => (last && (showing || betting.total === 0) ? { id: last.id, hand: last.view as BaccaratView, bets: {} } : { id: "", hand: null, bets: betting.bets }),
    [last, showing, betting.total, betting.bets],
  );

  async function deal() {
    for (const spot of SPOTS) {
      const amount = betting.bets[spot];
      const reason = amount ? checkStake(amount, BACCARAT_LIMITS) : null;
      if (reason) return toast(`${cap(spot)}: ${reason}`, "loss");
    }
    const hand = await table.start(betting.bets);
    if (hand) {
      betting.commit();
      setLast(hand);
      setShowing(true);
      buzz(12);
    }
  }

  function shown(s: BaccaratSceneView) {
    if (!showing || !last || s.id !== last.id) return;
    table.shown(last, baccaratResult);
    setBeads((b) => [...b, (last.view as BaccaratView).winner].slice(-PLATE));
    setShowing(false);
  }

  return (
    <TableFrame
      title="Baccarat"
      info={<Rules />}
      description={
        betting.total > 0 || !table.shownHand
          ? betsWords(betting.bets, { player: "Player", banker: "Banker", tie: "Tie" })
          : describeBaccarat(table.shownHand)
      }
      canvas={<TableCanvas scene={scene} equipped={equipped} view={view} onShown={shown} onError={(e) => toast(`Table error: ${String(e)}`, "loss")} />}
      above={<BeadPlate beads={beads} />}
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
          onDeal={deal}
          busy={table.busy || showing}
          spots={SPOTS.map((s) => ({ id: s, label: cap(s), key: s[0] }))}
          bets={betting.bets}
          onSpot={(s) => placeRef.current(s as Spot)}
        />
      }
    />
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function baccaratResult(h: HandRow) {
  const r = resultText(h)!;
  return { ...r, text: `${coupText(h.view as BaccaratView)}. ${r.text}` };
}

const BEAD: Record<Winner, [string, string]> = {
  player: ["P", "bg-[#2563eb]"],
  banker: ["B", "bg-[#dc2626]"],
  tie: ["T", "bg-[#15803d]"],
};

/** The last 30 coups: three down, then the next column, the newest ringed. */
function BeadPlate({ beads }: { beads: Winner[] }) {
  // The same height empty or full, so the table never resizes under a thumb.
  if (!beads.length) return <div className="flex h-[43px] items-center justify-center text-muted">Tap Player, Banker or Tie to bet.</div>;
  const cols = Math.ceil(PLATE / PLATE_ROWS);
  return (
    <ol
      aria-label={`Last ${beads.length} results, oldest first`}
      className="mx-auto grid h-[43px] w-max grid-flow-col gap-[2px]"
      style={{ gridTemplateRows: `repeat(${PLATE_ROWS}, 13px)`, gridTemplateColumns: `repeat(${cols}, 13px)` }}
    >
      {beads.map((w, i) => (
        <li
          key={i}
          aria-label={cap(w)}
          className={
            "flex h-[13px] w-[13px] items-center justify-center rounded-full font-mono text-[8px] font-bold text-white " +
            BEAD[w][1] +
            (i === beads.length - 1 ? " ring-2 ring-gold" : "")
          }
        >
          {BEAD[w][0]}
        </li>
      ))}
    </ol>
  );
}

function Rules() {
  return (
    <>
      <p>
        Bet on the Player hand, the Banker hand or a Tie, then the cards are dealt by fixed rules: there is nothing to decide. The hand nearer 9 wins.
        Aces count 1, tens and court cards 0, and only the last digit of the total counts (7 + 8 is 5).
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Two cards each. An 8 or 9 is a natural, and both hands stand.</li>
        <li>Player draws a third card on 0 to 5. Banker then draws by the table below, or on 0 to 5 if Player stood.</li>
        <li>Eight decks, shuffled every hand. Bets 10 to 5,000 a spot.</li>
      </ul>
      <Paytable
        caption="Pays"
        rows={[
          ["Player", "1 to 1"],
          ["Banker", "1 to 1, less 5% (rounded down)"],
          ["Tie", "8 to 1"],
          ["Player or Banker on a tie", "push"],
        ]}
      />
      <Paytable
        caption="Banker draws when Player's third card is…"
        rows={[
          ["Banker 0–2", "always"],
          ["Banker 3", "anything but 8"],
          ["Banker 4", "2 to 7"],
          ["Banker 5", "4 to 7"],
          ["Banker 6", "6 or 7"],
          ["Banker 7", "never"],
        ]}
      />
      <p className="text-muted">House edge: Banker 1.06%, Player 1.24%, Tie 14.4%.</p>
    </>
  );
}
