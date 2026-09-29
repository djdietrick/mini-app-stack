import type { SaveStatus } from "./common";

/** Where a finished run's save stands, with a retry when it failed. */
export function SaveLine({ status, retry }: { status: SaveStatus; retry: () => void }) {
  return (
    <p className="text-[13px] text-faint">
      {status === "saving" && "Saving…"}
      {status === "saved" && "Saved to your runs."}
      {status === "error" && (
        <>
          <span className="text-miss">Couldn't save this run.</span>{" "}
          <button type="button" onClick={retry} className="focus-ring rounded underline">
            Try again
          </button>
        </>
      )}
    </p>
  );
}
