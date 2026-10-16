import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Short messages just under the header, where they never cover the bet or
 * action bar: a claimed bonus, a hand's result, a level gained, a quest
 * done, an error. One shows at a time; when several arrive together (a win
 * that also completes a quest) they queue and follow each other. Tables use
 * it for "Blackjack! +150"; anything longer belongs on the screen itself.
 */
export type ToastTone = "win" | "loss" | "info";

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

/** How long one toast stays up: shorter while others wait behind it. */
const ALONE_MS = 2600;
const QUEUED_MS = 1700;
/** Older messages are dropped past this, so a burst can't hold the strip for long. */
const MAX_QUEUE = 4;

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const queue = useRef<Toast[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(0);

  const advance = useCallback(() => {
    const next = queue.current.shift() ?? null;
    setToast(next);
    if (next) timer.current = window.setTimeout(advance, queue.current.length ? QUEUED_MS : ALONE_MS);
    else timer.current = undefined;
  }, []);

  const show = useCallback(
    (text: string, tone: ToastTone = "info") => {
      queue.current.push({ id: ++nextId.current, text, tone });
      if (queue.current.length > MAX_QUEUE) queue.current.shift();
      if (timer.current === undefined) {
        advance();
      } else if (queue.current.length === 1) {
        // Something is showing alone: cut it to the queued length.
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(advance, QUEUED_MS);
      }
    },
    [advance],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const tone =
    toast?.tone === "win"
      ? "border-win/50 text-win"
      : toast?.tone === "loss"
        ? "border-loss/50 text-loss"
        : "border-line text-ink";

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-50 flex justify-center px-4"
      >
        {toast && (
          <div key={toast.id} role="status" className={"toast-in rounded-2xl border bg-raised/95 px-4 py-3 text-[15px] font-semibold shadow-xl backdrop-blur " + tone}>
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
