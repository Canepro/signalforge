import type { LatestRunBySourceTargetInput, SourceView } from "@/lib/storage/contract";

export function latestRunLookupForSource(
  source: Pick<SourceView, "target_identifier" | "expected_artifact_type">
): LatestRunBySourceTargetInput {
  return {
    targetIdentifier: source.target_identifier,
    artifactType: source.expected_artifact_type,
  };
}
