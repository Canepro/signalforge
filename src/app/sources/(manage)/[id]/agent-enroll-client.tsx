"use client";

import { useRef, useEffect, useState, useTransition } from "react";
import { registerAgentForSource, type RegisterAgentState } from "../../actions";

const initial: RegisterAgentState = { ok: false };

export function AgentEnrollClient({
  sourceId,
  hasRegistration,
}: {
  sourceId: string;
  hasRegistration: boolean;
}) {
  const [state, setState] = useState<RegisterAgentState>(initial);
  const [isPending, startTransition] = useTransition();
  const tokenRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (state.ok && tokenRef.current) {
      tokenRef.current.focus();
    }
  }, [state.ok]);

  if (hasRegistration) {
    return (
      <p className="text-sm text-on-surface-variant">
        An agent is already enrolled for this source (one registration per source in v1). Token rotation is deferred.
      </p>
    );
  }

  if (state.ok) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
        <p className="text-sm font-semibold text-on-surface">Save this token now — it will not be shown again.</p>
        <pre
          ref={tokenRef}
          tabIndex={0}
          className="text-xs font-mono break-all bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/20 select-all shadow-inner"
        >
          {state.token}
        </pre>
        <p className="text-[10px] text-on-surface-variant">
          Prefix: <code className="font-mono bg-surface-container px-1 py-0.5 rounded">{state.token_prefix}…</code>{" "}
          · agent id: <code className="font-mono bg-surface-container px-1 py-0.5 rounded">{state.agent_id}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.error === "already_registered" && (
        <p className="text-sm text-amber-800 dark:text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          Already registered — refresh the page.
        </p>
      )}
      {state.error === "not_found" && (
        <p className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          Source not found.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          startTransition(() => {
            void registerAgentForSource(formData).then(setState);
          });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="source_id" value={sourceId} />
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Agent label (optional)
          </span>
          <input
            name="display_name"
            placeholder="e.g. laptop-agent"
            className="mt-1.5 block rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-gradient-to-b from-secondary to-secondary/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
        >
          {isPending ? "Enrolling…" : "Enroll agent"}
        </button>
      </form>
    </div>
  );
}
