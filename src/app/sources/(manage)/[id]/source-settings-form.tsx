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
          <span className="sf-field-label">
            Display name
          </span>
          <input
            name="display_name"
            defaultValue={displayName}
            maxLength={256}
            className="sf-field bg-surface-container-lowest"
          />
        </label>
        <label className="block">
          <span className="sf-field-label">
            Collector version
          </span>
          <input
            name="default_collector_version"
            defaultValue={collectorVersion ?? ""}
            placeholder="e.g. 1.2.0"
            className="sf-field bg-surface-container-lowest font-mono"
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
        <label className="flex cursor-pointer items-center gap-3">
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
            className="sf-btn-secondary"
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
