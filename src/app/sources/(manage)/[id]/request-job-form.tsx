"use client";

import { useTransition } from "react";
import { createCollectionJobAction } from "../../actions";
import { CollectionScopeFields } from "../../collection-scope-fields";
import type { CollectionScope } from "@/lib/collection-scope";
import type { ArtifactType } from "@/lib/source-catalog";

export function RequestJobForm({
  sourceId,
  enabled,
  artifactType,
  defaultScope,
}: {
  sourceId: string;
  enabled: boolean;
  artifactType: ArtifactType;
  defaultScope: CollectionScope | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        startTransition(() => {
          void createCollectionJobAction(formData);
        });
      }}
      className="space-y-4"
    >
      <input type="hidden" name="source_id" value={sourceId} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <label className="block text-sm text-on-surface">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Reason (optional)
          </span>
          <input
            name="request_reason"
            placeholder="e.g. pre-deploy check"
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </label>
        <CollectionScopeFields
          artifactType={artifactType}
          prefix="collection_scope"
          emptyLabel="Use source default / no override"
          caption={
            defaultScope ?
              "Optional. Leave blank to inherit the source default scope, or override it for this one job."
            : "Optional. Leave blank to queue the job without an explicit override."
          }
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!enabled || isPending}
          className="rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary hover:brightness-110 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed shadow-sm whitespace-nowrap transition-all"
        >
          {isPending ? "Submitting…" : "Request job"}
        </button>
      </div>
    </form>
  );
}
