"use client";

import Link from "next/link";
import { useState } from "react";
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

  return (
    <form action={createSourceAction} className="relative rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-6 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="space-y-5">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Display name</span>
            <input
              name="display_name"
              required
              maxLength={256}
              placeholder="e.g. Prod Web-01"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Target identifier</span>
            <input
              name="target_identifier"
              required
              maxLength={512}
              placeholder="e.g. prod-web-01 or host:myserver"
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm font-mono text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
            <span className="text-[10px] text-on-surface-variant mt-1 block leading-snug">
              Stable key for compare / drift. Must match <code className="text-[10px] font-mono bg-surface-container px-1 py-0.5 rounded">target_identifier</code>{" "}
              in uploaded run metadata.
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Source type</span>
            <select
              name="source_type"
              required
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            >
              {sourceTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Artifact family</span>
            <select
              name="expected_artifact_type"
              required
              value={artifactType}
              onChange={(event) => setArtifactType(event.target.value as ArtifactType)}
              className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            >
              {artifactTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-on-surface-variant mt-1 block leading-snug">
              This controls which collector capability the source expects and which artifact family collection jobs may upload.
            </span>
          </label>
          <CollectionScopeFields
            artifactType={artifactType}
            prefix="default_collection_scope"
            emptyLabel="No default scope"
            caption="Optional. Store a typed default scope on the source so queued jobs can inherit it when you do not override the request."
          />
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Supported source types
            </p>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-on-surface-variant">
              {sourceTypeOptions.map((option) => (
                <li key={option.value}>
                  <div className="font-semibold text-on-surface">{option.label}</div>
                  <div>{option.description}</div>
                  <div className="mt-1 font-mono text-[10px] text-outline-variant">
                    value: {option.value}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Supported artifact families
            </p>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-on-surface-variant">
              {artifactFamilies.map((family) => (
                <li key={family.value}>
                  <div className="font-semibold text-on-surface">{family.label}</div>
                  <div>{family.description}</div>
                  <div className="mt-1 font-mono text-[10px] text-outline-variant">
                    value: {family.value}
                  </div>
                  <div className="mt-1 text-[10px] text-outline-variant">
                    {family.targetIdentifierHint}
                  </div>
                  <div className="mt-1 text-[10px] text-outline-variant">
                    {family.recommendedCollection}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary shadow-md hover:shadow-lg hover:brightness-110 transition-all"
        >
          Create source
        </button>
        <Link
          href="/sources"
          className="rounded-lg border border-outline-variant/30 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container-high transition-all"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
