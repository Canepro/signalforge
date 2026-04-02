import Link from "next/link";
import {
  DEFAULT_EXPECTED_ARTIFACT_TYPE,
  listArtifactFamilyPresentations,
  listArtifactTypeOptions,
  listSourceTypeOptions,
} from "@/lib/source-catalog";
import { NewSourceForm } from "./new-source-form";

export const dynamic = "force-dynamic";

export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const sourceTypeOptions = listSourceTypeOptions();
  const artifactTypeOptions = listArtifactTypeOptions();
  const artifactFamilies = listArtifactFamilyPresentations();

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/sources" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All sources
        </Link>
        <h1 className="font-headline text-2xl font-bold text-on-surface mt-3 tracking-tight">New source</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Register an evidence target and the execution surface that a long-lived external agent will collect it from.
        </p>
      </div>

      {sp.error === "duplicate" && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          A source with this <code className="sf-inline-code">target_identifier</code> already exists (among enabled sources).
        </p>
      )}
      {(sp.error === "missing" || sp.error === "type") && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          Please fill all required fields and pick a valid execution host kind.
        </p>
      )}
      {(sp.error === "artifact_type" || sp.error === "invalid_default_collection_scope") && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          {sp.error === "artifact_type" ?
            "Please choose a supported artifact family for this source."
          : "Default collection scope did not match the selected artifact family."}
        </p>
      )}

      <NewSourceForm
        sourceTypeOptions={sourceTypeOptions}
        artifactTypeOptions={artifactTypeOptions}
        artifactFamilies={artifactFamilies}
        defaultArtifactType={DEFAULT_EXPECTED_ARTIFACT_TYPE}
      />
    </div>
  );
}
