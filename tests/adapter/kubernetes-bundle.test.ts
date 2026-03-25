import { describe, expect, it } from "vitest";
import { KubernetesBundleAdapter } from "@/lib/adapter/kubernetes-bundle/index";

const RAW = JSON.stringify(
  {
    schema_version: "kubernetes-bundle.v1",
    cluster: { name: "aks-prod-eu-1", provider: "aks" },
    scope: { level: "namespace", namespace: "payments" },
    documents: [
      {
        path: "services/public-services.json",
        kind: "service-exposure",
        media_type: "application/json",
        content: JSON.stringify([
          { namespace: "payments", name: "payments-public", type: "LoadBalancer" },
          { namespace: "payments", name: "payments-internal", type: "ClusterIP" },
        ]),
      },
      {
        path: "rbac/bindings.json",
        kind: "rbac-bindings",
        media_type: "application/json",
        content: JSON.stringify([
          {
            scope: "cluster",
            subject: "system:serviceaccount:payments:default",
            roleRef: "cluster-admin",
          },
        ]),
      },
      {
        path: "workloads/status.json",
        kind: "workload-status",
        media_type: "application/json",
        content: JSON.stringify([
          {
            namespace: "payments",
            name: "payments-api",
            status: "CrashLoopBackOff",
            restarts: 12,
          },
        ]),
      },
    ],
  },
  null,
  2
);

describe("KubernetesBundleAdapter", () => {
  it("detects Kubernetes bundle environment and extracts first-slice findings", () => {
    const adapter = new KubernetesBundleAdapter();
    const clean = adapter.stripNoise(RAW);
    const sections = adapter.parseSections(clean);
    const env = adapter.detectEnvironment(sections);
    const findings = adapter.extractPreFindings(sections, env);
    const incomplete = adapter.detectIncomplete(sections);

    expect(env.hostname).toBe("aks-prod-eu-1");
    expect(env.os).toContain("Kubernetes");
    expect(env.os).toContain("aks");
    expect(incomplete.incomplete).toBe(false);
    expect(findings.some((finding) => finding.title.includes("Service exposed externally"))).toBe(
      true
    );
    expect(findings.some((finding) => finding.title.includes("Cluster-admin binding"))).toBe(
      true
    );
    expect(findings.some((finding) => finding.title.includes("CrashLoopBackOff"))).toBe(true);
  });
});
