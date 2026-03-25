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
      {
        path: "workloads/specs.json",
        kind: "workload-specs",
        media_type: "application/json",
        content: JSON.stringify([
          {
            namespace: "payments",
            name: "payments-api",
            kind: "Deployment",
            pod_spec: {
              serviceAccountName: "default",
              automountServiceAccountToken: true,
              hostNetwork: true,
              hostPID: true,
              hostIPC: true,
              volumes: [
                {
                  name: "payments-api-secrets-volume",
                  secret: { secretName: "payments-api-secrets" },
                },
                {
                  name: "payments-host-data",
                  hostPath: { path: "/var/lib/payments-data" },
                },
                {
                  name: "payments-token",
                  projected: {
                    sources: [
                      {
                        serviceAccountToken: {
                          audience: "payments-api",
                          expirationSeconds: 3600,
                          path: "token",
                        },
                      },
                    ],
                  },
                },
              ],
              containers: [
                {
                  name: "api",
                  env: [
                    {
                      name: "DATABASE_URL",
                      valueFrom: {
                        secretKeyRef: {
                          name: "payments-api-secrets",
                          key: "database_url",
                        },
                      },
                    },
                  ],
                  envFrom: [
                    {
                      secretRef: {
                        name: "payments-api-env",
                      },
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "payments-api-secrets-volume",
                      mountPath: "/var/run/secrets/payments",
                      readOnly: true,
                    },
                    {
                      name: "payments-host-data",
                      mountPath: "/host/payments-data",
                    },
                    {
                      name: "payments-token",
                      mountPath: "/var/run/secrets/tokens",
                      readOnly: true,
                    },
                  ],
                  securityContext: {
                    privileged: true,
                    allowPrivilegeEscalation: true,
                    runAsNonRoot: false,
                    capabilities: { add: ["NET_ADMIN"] },
                    seccompProfile: { type: "Unconfined" },
                  },
                  readinessProbe: null,
                  livenessProbe: null,
                  resources: {},
                },
              ],
              initContainers: [
                {
                  name: "bootstrap",
                  securityContext: {
                    privileged: true,
                  },
                },
              ],
            },
          },
        ]),
      },
      {
        path: "network/network-policies.json",
        kind: "network-policies",
        media_type: "application/json",
        content: JSON.stringify([]),
      },
      {
        path: "rbac/roles.json",
        kind: "rbac-roles",
        media_type: "application/json",
        content: JSON.stringify([
          {
            scope: "namespace",
            namespace: "payments",
            name: "payments-ops",
            rules: [
              {
                apiGroups: ["*"],
                resources: ["*"],
                verbs: ["*"],
              },
            ],
          },
          {
            scope: "cluster",
            name: "payments-breakglass",
            rules: [
              {
                apiGroups: ["rbac.authorization.k8s.io"],
                resources: ["clusterroles"],
                verbs: ["bind", "escalate", "impersonate"],
              },
              {
                apiGroups: [""],
                resources: ["nodes/proxy"],
                verbs: ["get"],
              },
            ],
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
    expect(
      findings.some((finding) => finding.title.includes("without NetworkPolicy isolation"))
    ).toBe(true);
    expect(findings.some((finding) => finding.title.includes("runs privileged"))).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("allows privilege escalation"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("automatically mounts service account tokens"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("uses the default service account with token automount"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("injects Secret values into environment variables"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("bulk-imports Secret data into environment variables"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("mounts Secret volumes"))
    ).toBe(true);
    expect(
      findings.some((finding) => finding.title.includes("mounts projected service account token volumes"))
    ).toBe(true);
    expect(findings.some((finding) => finding.title.includes("shares the host network namespace"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("shares the host PID namespace"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("shares the host IPC namespace"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("mounts hostPath volumes"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("adds Linux capabilities"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("uses privileged init containers"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("does not enforce runAsNonRoot"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("uses a writable root filesystem"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("missing liveness or readiness probes"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("missing resource requests or limits"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("missing a RuntimeDefault seccomp profile"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("grants wildcard access"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("grants privilege-escalation verbs"))).toBe(true);
    expect(findings.some((finding) => finding.title.includes("can access kubelet or node proxy APIs"))).toBe(true);
  });
});
