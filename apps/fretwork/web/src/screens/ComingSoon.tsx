/** Holding screen for tabs whose feature has not landed yet. */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="card p-5 text-[15px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
