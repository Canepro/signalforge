"use client";

import { useState, useTransition } from "react";
import { cancelCollectionJobAction } from "../../actions";

export function CancelJobButton({ jobId, sourceId }: { jobId: string; sourceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-on-surface-variant">Cancel this job?</span>
        <form
          action={(formData) => {
            startTransition(() => {
              void cancelCollectionJobAction(formData);
            });
          }}
        >
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="source_id" value={sourceId} />
          <button
            type="submit"
            disabled={isPending}
            className="text-[11px] font-bold uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
          >
            {isPending ? "Cancelling…" : "Yes, cancel"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface"
        >
          No, keep
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-[11px] font-bold uppercase tracking-widest text-danger/80 hover:text-danger transition-colors"
    >
      Cancel job
    </button>
  );
}
