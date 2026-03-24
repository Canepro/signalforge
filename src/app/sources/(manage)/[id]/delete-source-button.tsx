"use client";

import { useState, useTransition } from "react";
import { deleteSourceAction } from "../../actions";

export function DeleteSourceButton({
  sourceId,
  blocked,
}: {
  sourceId: string;
  blocked: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (blocked) {
    return (
      <button
        type="button"
        disabled
        className="rounded-lg border border-severity-critical/20 bg-severity-critical/[0.04] px-4 py-2 text-xs font-bold uppercase tracking-wider text-severity-critical/60 opacity-70"
      >
        Finish active job first
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-on-surface-variant">
          Delete this source and its source-scoped jobs?
        </span>
        <form
          action={(formData) => {
            startTransition(() => {
              void deleteSourceAction(formData);
            });
          }}
        >
          <input type="hidden" name="source_id" value={sourceId} />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-severity-critical/20 bg-severity-critical/[0.08] px-3 py-2 text-xs font-bold uppercase tracking-wider text-severity-critical hover:bg-severity-critical/[0.12] disabled:opacity-50"
          >
            {isPending ? "Deleting…" : "Yes, delete"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface"
        >
          Keep source
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-severity-critical/20 bg-severity-critical/[0.04] px-4 py-2 text-xs font-bold uppercase tracking-wider text-severity-critical hover:bg-severity-critical/[0.08]"
    >
      Delete source
    </button>
  );
}
