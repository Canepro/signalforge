"use client";

import { useTransition } from "react";
import { createCollectionJobAction } from "../../actions";

export function RequestJobForm({
  sourceId,
  enabled,
}: {
  sourceId: string;
  enabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        startTransition(() => {
          void createCollectionJobAction(formData);
        });
      }}
      className="flex flex-col sm:flex-row items-start sm:items-end gap-3"
    >
      <input type="hidden" name="source_id" value={sourceId} />
      <label className="flex-1 w-full text-sm text-on-surface">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Reason (optional)
        </span>
        <input
          name="request_reason"
          placeholder="e.g. pre-deploy check"
          className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
        />
      </label>
      <button
        type="submit"
        disabled={!enabled || isPending}
        className="rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary hover:brightness-110 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed shadow-sm whitespace-nowrap transition-all"
      >
        {isPending ? "Submitting…" : "Request job"}
      </button>
    </form>
  );
}
