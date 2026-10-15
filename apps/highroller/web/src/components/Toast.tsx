import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * One short message at a time, just under the header, where it never covers
 * the bet or action bar: a claimed bonus, a hand's result, an error. Tables
 * use it for "Blackjack! +150"; anything longer belongs on the screen itself.
 */
export type ToastTone = "win" | "loss" | "info";

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, tone: ToastTone = "info") => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

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
