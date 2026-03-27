"use client";

import { useRef, useState, useTransition } from "react";
import { updateSourceAction } from "../../actions";
import { CollectionScopeFields } from "../../collection-scope-fields";
import type { CollectionScope } from "@/lib/collection-scope";
import type { ArtifactType } from "@/lib/source-catalog";

interface SourceSettingsFormProps {
  sourceId: string;
  displayName: string;
  artifactType: ArtifactType;
  collectorVersion: string | null;
  defaultCollectionScope: CollectionScope | null;
  enabled: boolean;
}

export function SourceSettingsForm({
  sourceId,
  displayName,
  artifactType,
  collectorVersion,
  defaultCollectionScope,
  enabled,
}: SourceSettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setSaved(false);
    startTransition(() => {
      void updateSourceAction(formData).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      });
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="source_id" value={sourceId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Display name
          </span>
          <input
            name="display_name"
            defaultValue={displayName}
            maxLength={256}
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Collector version
          </span>
          <input
            name="default_collector_version"
            defaultValue={collectorVersion ?? ""}
            placeholder="e.g. 1.2.0"
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm font-mono text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </label>
      </div>
      <CollectionScopeFields
        artifactType={artifactType}
        prefix="default_collection_scope"
        initialScope={defaultCollectionScope}
        emptyLabel="No default scope"
        caption="Optional. Jobs requested without an explicit override will inherit this scope."
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="relative inline-flex items-center">
            <input type="hidden" name="enabled" value="0" />
            <input
              type="checkbox"
              name="enabled"
              value="1"
              defaultChecked={enabled}
              className="peer sr-only"
            />
            <span className="block h-5 w-9 rounded-full bg-outline-variant/30 peer-checked:bg-primary transition-colors" />
            <span className="absolute left-0.5 top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="text-sm text-on-surface font-medium">Enabled</span>
          <span className="text-[10px] text-on-surface-variant">
            {enabled ? "accepting new jobs" : "new jobs will be rejected"}
          </span>
        </label>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-[fadeIn_0.2s_ease]">
              Saved
            </span>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-outline-variant/30 bg-surface-container-high px-4 py-2 text-xs font-bold uppercase tracking-wider text-on-surface hover:bg-surface-container-highest disabled:opacity-50 transition-all"
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
