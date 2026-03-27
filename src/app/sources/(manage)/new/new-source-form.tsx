"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createSourceAction } from "../../actions";
import { CollectionScopeFields } from "../../collection-scope-fields";
import type {
  ArtifactFamilyPresentation,
  ArtifactType,
  SourceType,
} from "@/lib/source-catalog";

type Option<T extends string> = {
  value: T;
  label: string;
  description: string;
};

type NewSourceFormProps = {
  sourceTypeOptions: ReadonlyArray<Option<SourceType>>;
  artifactTypeOptions: ReadonlyArray<Option<ArtifactType>>;
  artifactFamilies: ReadonlyArray<ArtifactFamilyPresentation>;
  defaultArtifactType: ArtifactType;
};

export function NewSourceForm({
  sourceTypeOptions,
  artifactTypeOptions,
  artifactFamilies,
  defaultArtifactType,
}: NewSourceFormProps) {
  const [artifactType, setArtifactType] = useState<ArtifactType>(defaultArtifactType);
  const [sourceType, setSourceType] = useState<SourceType>(sourceTypeOptions[0]?.value ?? "linux_host");
  const selectedFamily = useMemo(
    () => artifactFamilies.find((family) => family.value === artifactType) ?? artifactFamilies[0],
    [artifactFamilies, artifactType]
  );
  const selectedSourceType = useMemo(
    () => sourceTypeOptions.find((option) => option.value === sourceType) ?? sourceTypeOptions[0],
    [sourceType, sourceTypeOptions]
  );

  return (
    <form action={createSourceAction} className="space-y-5">
      <div className="sf-panel p-6">
        <div className="space-y-5">
          <div>
            <p className="sf-kicker">Identity first</p>
            <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">
              Register a source that compare and collection can trust
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
              The two most important decisions here are the stable target identifier and the typed collection scope.
              Get those right and repeat uploads, queued jobs, and compare drift all line up cleanly.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="sf-field-label">Display name</span>
              <input
                name="display_name"
                required
                maxLength={256}
                placeholder="e.g. Prod Web-01"
                className="sf-field"
              />
            </label>
            <label className="block">
              <span className="sf-field-label">Target identifier</span>
              <input
                name="target_identifier"
                required
                maxLength={512}
                placeholder="e.g. prod-web-01 or host:myserver"
                className="sf-field font-mono"
              />
              <span className="sf-field-help">
                Stable key for compare and drift. Must match <code className="sf-inline-code">target_identifier</code> in uploaded run metadata.
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="sf-field-label">Source type</span>
              <select
                name="source_type"
                required
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as SourceType)}
                className="sf-field"
              >
                {sourceTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {selectedSourceType ? (
                <span className="sf-field-help">{selectedSourceType.description}</span>
              ) : null}
            </label>
            <label className="block">
              <span className="sf-field-label">Artifact family</span>
              <select
                name="expected_artifact_type"
                required
                value={artifactType}
                onChange={(event) => setArtifactType(event.target.value as ArtifactType)}
                className="sf-field"
              >
                {artifactTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="sf-field-help">
                This controls which collector capability the source expects and which artifact family collection jobs may upload.
              </span>
            </label>
          </div>

          {selectedFamily ? (
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)]">
                <div>
                  <div className="sf-kicker">Selected family</div>
                  <div className="mt-2 text-base font-semibold text-on-surface">
                    {selectedFamily.label}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                    {selectedFamily.description}
                  </p>
                </div>
                <div className="space-y-2 text-sm text-on-surface-variant">
                  <div>
                    <span className="font-semibold text-on-surface">Target id hint:</span>{" "}
                    {selectedFamily.targetIdentifierHint}
                  </div>
                  <div>
                    <span className="font-semibold text-on-surface">Example:</span>{" "}
                    <code className="font-mono text-on-surface">{selectedFamily.targetIdentifierExample}</code>
                  </div>
                  <div>
                    <span className="font-semibold text-on-surface">Preferred collection:</span>{" "}
                    {selectedFamily.recommendedCollection}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <CollectionScopeFields
            artifactType={artifactType}
            prefix="default_collection_scope"
            emptyLabel="No default scope"
            caption="Optional. Store a typed default scope on the source so queued jobs inherit it unless you override the request."
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4">
          <div className="sf-kicker">What matters most</div>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-on-surface-variant">
            <li>Pick a display name operators will recognize quickly in queues and run history.</li>
            <li>Use a stable target identifier that will still make sense after reanalyze or future uploads.</li>
            <li>Set a default collection scope when the source should consistently target one workload, namespace, or cluster shape.</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <button
            type="submit"
            className="sf-btn-primary"
          >
            Create source
          </button>
          <Link
            href="/sources"
            className="sf-btn-secondary"
          >
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
