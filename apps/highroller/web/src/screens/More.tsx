import { useAuth, useSession } from "@stack/auth-ui";
import { useState } from "react";
import { GiftSheet } from "../components/GiftSheet";
import { PageTitle } from "../components/ui";
import { href } from "../router";

export function More() {
  const session = useSession();
  const { logout } = useAuth();
  const who = session.status === "signed-in" ? session.user.displayName || session.user.email : "";
  const [gifting, setGifting] = useState(false);

  const links = [
    { to: href({ name: "leaderboards" }), label: "Leaderboards", hint: "Net, biggest win and level" },
    { to: href({ name: "ledger" }), label: "Ledger", hint: "Every chip in and out" },
    { to: href({ name: "settings" }), label: "Settings", hint: "Leaderboards, sound, haptics, animation speed" },
    ...(import.meta.env.DEV ? [{ to: href({ name: "table-demo" }), label: "Table kit demo", hint: "Dev only: deal cards, stack chips" }] : []),
  ];

  return (
    <div>
      <PageTitle sub={who}>More</PageTitle>
      <ul className="card divide-y divide-line">
        {links.map((l) => (
          <li key={l.to}>
            <a href={l.to} className="focus-ring flex min-h-[56px] items-center justify-between rounded-2xl px-4 py-3">
              <span>
                <span className="block text-[15px] font-medium">{l.label}</span>
                <span className="block text-[13px] text-muted">{l.hint}</span>
              </span>
              <span aria-hidden="true" className="text-muted">
                ›
              </span>
            </a>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="focus-ring flex min-h-[56px] w-full items-center justify-between rounded-2xl px-4 py-3 text-left"
            onClick={() => setGifting(true)}
          >
            <span>
              <span className="block text-[15px] font-medium">Gift chips</span>
              <span className="block text-[13px] text-muted">Send chips to another player by email</span>
            </span>
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </button>
        </li>
      </ul>
      <button type="button" className="btn mt-5 w-full" onClick={() => void logout()}>
        Sign out
      </button>
      {gifting && <GiftSheet onClose={() => setGifting(false)} />}
    </div>
  );
}

/** A screen with nothing on it but a note. */
export function Placeholder({ title, what }: { title: string; what: string }) {
  return (
    <div>
      <PageTitle>{title}</PageTitle>
      <div className="card p-6 text-center text-[15px] text-muted">{what}</div>
    </div>
  );
}
