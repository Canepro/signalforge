import type { Finding } from "@/lib/analyzer/schema";
import type { SourceView } from "@/lib/storage/contract";
import type { GetRunDetailResponse } from "@/types/api-contract";

export type KubernetesPatchTemplate = {
  kind: "kubernetes_patch_template";
  patch_type: "server_side_apply";
  manifest: Record<string, unknown>;
};

export type KubernetesPatchTarget = {
  api_version: string;
  kind: string;
  namespace: string;
  name: string;
  resource: string;
  kubectl_context?: string;
};

export type KubernetesFixActionPayload = {
  kind: "kubernetes_safe_patch";
  policy_id: string;
  action_kind: "kubernetes_patch";
  target: KubernetesPatchTarget;
  patch_template: KubernetesPatchTemplate;
  changed_fields: string[];
};

export type FixActionEligibility =
  | {
      eligible: true;
      policy_id: string;
      action_kind: string;
      action_payload: KubernetesFixActionPayload;
      patch_template: KubernetesPatchTemplate;
      reason: string;
    }
  | {
      eligible: false;
      code: string;
      reason: string;
    };

export const KUBERNETES_SAFE_FIX_CAPABILITY = "fix:kubernetes-safe";
export const POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT =
  "kubernetes.disable-service-account-token-automount.v1";

function titleIncludes(finding: Finding, text: string): boolean {
  return finding.title.toLowerCase().includes(text);
}

function sourceAllowsPolicy(source: SourceView, policyId: string): boolean {
  return (
    source.automation_enabled &&
    source.auto_fix_enabled &&
    source.allowed_fix_policy_ids.includes(policyId)
  );
}

function parseWorkloadEvidence(finding: Finding): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(finding.evidence) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ?
        parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function targetFromFinding(source: SourceView, finding: Finding): KubernetesPatchTarget | null {
  const workload = parseWorkloadEvidence(finding);
  if (!workload) return null;

  const rawKind = stringField(workload, "kind");
  const namespace = stringField(workload, "namespace");
  const name = stringField(workload, "name");
  if (!rawKind || !namespace || !name) return null;

  const kind = rawKind.charAt(0).toUpperCase() + rawKind.slice(1);
  const scope = source.default_collection_scope;
  const kubectlContext =
    scope?.kind === "kubernetes_scope" && scope.kubectl_context?.trim() ?
      scope.kubectl_context.trim()
    : undefined;

  return {
    api_version: "apps/v1",
    kind,
    namespace,
    name,
    resource: `${kind.toLowerCase()}/${name}`,
    ...(kubectlContext ? { kubectl_context: kubectlContext } : {}),
  };
}

function serviceAccountAutomountPayload(
  policyId: string,
  target: KubernetesPatchTarget
): KubernetesFixActionPayload {
  const manifest = {
    apiVersion: target.api_version,
    kind: target.kind,
    metadata: {
      name: target.name,
      namespace: target.namespace,
    },
    spec: {
      template: {
        spec: {
          automountServiceAccountToken: false,
        },
      },
    },
  };

  return {
    kind: "kubernetes_safe_patch",
    policy_id: policyId,
    action_kind: "kubernetes_patch",
    target,
    patch_template: {
      kind: "kubernetes_patch_template",
      patch_type: "server_side_apply",
      manifest,
    },
    changed_fields: ["spec.template.spec.automountServiceAccountToken"],
  };
}

export function evaluateFixActionEligibility(input: {
  source: SourceView;
  run: GetRunDetailResponse;
  finding: Finding | null;
}): FixActionEligibility {
  const { source, run, finding } = input;

  if (run.artifact_type !== "kubernetes-bundle") {
    return {
      eligible: false,
      code: "unsupported_artifact_type",
      reason: "Autonomous fixes are only available for kubernetes-bundle runs.",
    };
  }

  if (run.is_incomplete) {
    return {
      eligible: false,
      code: "incomplete_evidence",
      reason: "Incomplete evidence cannot be used for autonomous fixes.",
    };
  }

  if (!finding) {
    return {
      eligible: false,
      code: "finding_not_present",
      reason: "The triggering finding is no longer present in the diagnostic run.",
    };
  }

  if (titleIncludes(finding, "automatically mounts service account tokens")) {
    const policyId = POLICY_DISABLE_SERVICE_ACCOUNT_TOKEN_AUTOMOUNT;
    if (!sourceAllowsPolicy(source, policyId)) {
      return {
        eligible: false,
        code: "policy_not_enabled",
        reason: "The Source has not enabled this autonomous Kubernetes fix policy.",
      };
    }
    const target = targetFromFinding(source, finding);
    if (!target) {
      return {
        eligible: false,
        code: "incomplete_evidence",
        reason: "The finding does not include a concrete Kubernetes workload target.",
      };
    }
    const actionPayload = serviceAccountAutomountPayload(policyId, target);

    return {
      eligible: true,
      policy_id: policyId,
      action_kind: "kubernetes_patch",
      action_payload: actionPayload,
      patch_template: actionPayload.patch_template,
      reason: "The workload automatically mounts service account tokens and the Source explicitly allows this safe patch.",
    };
  }

  return {
    eligible: false,
    code: "finding_not_allowlisted",
    reason: "This finding does not map to an allowlisted autonomous Kubernetes fix policy.",
  };
}
