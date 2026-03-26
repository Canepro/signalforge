# Plan: Container And Kubernetes Evidence Expansion

> Source request: operator wants concrete next implementation steps for container and Kubernetes support, and the current drift UI is too low-value when findings remain unchanged.

## Architectural decisions

Durable decisions that apply across all phases:

- **Boundary**: SignalForge remains an analysis platform. Collectors stay external. No SSH, `kubectl`, `docker exec`, or privileged remote execution from the Next.js app.
- **Artifact strategy**: add two narrow artifact families, not a generic collector framework:
  - `container-diagnostics`
  - `kubernetes-bundle`
- **Artifact envelope guardrail**: Phase 8 must declare whether each family fits the current text-oriented ingestion path. If a family requires raw archive or binary upload support, that is a prerequisite ingestion/storage slice, not an adapter-only follow-on.
- **Acquisition model**: ship both families as **push-first** submission patterns first. Do not block on job-driven collection or agent orchestration.
- **Reuse path**: preserve the existing ingestion contract (`POST /api/runs` and job-bound artifact upload) and extend adapter selection by `artifact_type`.
- **Compare model**: keep deterministic finding-key drift as the base layer, but add a second read model exposed as deterministic `evidence_delta` data so compare remains useful when systems are stable.
- **Execution-plane shape**: prefer one SignalForge agent product over many unrelated agents, but let it ship in different deployment forms and advertise bounded capabilities based on environment and trust level.
- **Source/registration guardrail**: do not deepen the current one-registration-per-source assumption while adding new artifact families. Phase 8 can stay push-first, but any later Sources or orchestration work must treat execution scope as a design gate.
- **Identity**:
  - containers should prefer explicit `target_identifier` values that reflect the intended compare scope, for example `container-workload:<host>:<runtime>:<service>` or `container-instance:<host>:<runtime>:<container-id>`
  - Kubernetes should prefer explicit `target_identifier` values such as `cluster:<cluster-name>` or `cluster:<cluster-name>:namespace:<scope>`
- **Operator UX**: containers and Kubernetes must feel like first-class evidence types in upload, run detail, compare, and docs before any orchestration work is considered.
- **Quality bar**: Phase 8 should not stop at the weakest demo that proves the plumbing. Container and Kubernetes slices should aim for credible operator value, using official platform guidance, realistic fixtures, and real read-only cluster/runtime inspection when that materially improves rule quality.
- **Kubernetes breadth without tool lock-in**: richer platform examples such as Argo CD, Grafana, ingress controllers, or secrets operators are useful evidence sources, but the product should still describe and detect plain Kubernetes primitives first. A cluster without those optional tools should still recognize the rule set as relevant.
- **Trust model**: collection and remediation are different trust classes. Remediation is deferred for now, but not forbidden as a future product direction.

---

## Tomorrow Start Here

If implementation starts tomorrow, the recommended first three slices are:

1. **Phase 0 first**: improve compare so stable systems still produce useful output.
2. **Container slice before Kubernetes**: prove the second artifact-family pattern on the smaller surface first.
3. **Push-first before job-driven**: do not extend the agent until container and Kubernetes evidence can already be uploaded, analyzed, and compared cleanly.

That gives the fastest route to a demoable result without reopening the product boundary.

---

## Pre-Implementation Contract Gates

These are not optional polish items. Lock them before implementation work spreads across adapters, compare, docs, and Sources:

1. **Artifact envelope gate**
   - `container-diagnostics` should fit the current text-oriented upload path in v1, either as plain text or a small structured artifact normalized to text or JSON before submission.
   - `kubernetes-bundle` must explicitly choose between:
     - a normalized text or JSON evidence export that still fits current ingestion, or
     - a raw archive upload path, which would require a separate ingestion/storage contract change before the Kubernetes adapter begins.
2. **Compare payload gate**
   - Phase 0 should add a shared deterministic compare payload block named `evidence_delta` for stable evidence and metadata deltas.
   - This should land in the compare read model and API contract, not as UI-only logic.
3. **Identity gate**
   - Containers must declare whether compare is anchored to a workload-style identity or an instance-style identity.
   - Kubernetes must make scope explicit so cluster-wide and namespace-scoped evidence do not silently compare as if they were the same target.
4. **Source/registration gate**
   - The shipped Source model is still effectively one source, one expected artifact family, one registration.
   - That is acceptable for push-first Phase 8 work, but any follow-on Sources or orchestration work must first decide whether new execution forms are separate sources, multiple registrations per source, or a more explicit registration-scope model.

If these gates are skipped, early code will likely be correct locally but expensive to reshape once real submissions arrive.

---

## Open Decisions To Lock Before Coding

These should be settled quickly before writing implementation code:

- **Container artifact shape**: one plain-text collector output vs a small structured bundle normalized to text or JSON before ingestion.
- **Kubernetes scope**: cluster-wide support bundle first vs namespace-scoped evidence first.
- **Compare delta contract**: whether `evidence_delta` is a sibling summary block or a new row status family, and what exact API payload carries it.
- **Reference collectors**: whether the first container and Kubernetes push paths live only in `signalforge-collectors` or begin as documented external contracts with fixtures first.
- **Target identity defaults**:
  - containers: prefer a workload-stable identifier when the user story is workload compare, with container ID kept as supporting metadata
  - Kubernetes: prefer cluster identifier + optional namespace scope, not pod names
- **Kubernetes capability scope**:
  - namespace-scoped collection for workload-local diagnostics
  - cluster-scoped collection for real cluster diagnostics
  - do not force namespace-only scope where the diagnostic value depends on cluster-level evidence
- **Future execution tiers**:
  - read-only collection
  - higher-trust remediation later, with explicit approvals and auditability

If any of these stay fuzzy, compare and fixtures will get reworked later.

---

## Kubernetes Envelope Decision For v1

This decision is now locked for the first Kubernetes implementation slice.

- **Envelope**: `kubernetes-bundle` v1 will use a **UTF-8 JSON manifest submitted through the existing text upload path**.
- **No raw archives in v1**: `.zip`, `.tar`, `.tar.gz`, binary blobs, or base64-packed bundle uploads are explicitly out of scope for the first slice.
- **Producer responsibility**: collectors must unpack, normalize, and select relevant Kubernetes evidence **before** upload.
- **Analyzer responsibility**: SignalForge consumes one JSON document that contains stable metadata plus a set of named text documents.

### Why this shape wins

Three viable designs were considered:

1. **Raw archive ingestion**
   - Best fidelity, but it immediately forces binary upload, archive parsing, storage changes, and new failure modes before any Kubernetes finding value exists.
2. **Single flattened text export**
   - Fits today’s ingestion path, but it loses document boundaries too aggressively and makes deterministic parsing, fixture review, and compare metrics harder.
3. **Structured JSON manifest carrying named text documents**
   - Keeps the current ingestion/storage model, preserves internal document boundaries, and is easy to fixture, diff, and parse deterministically.

Recommendation: choose option 3 for v1 and defer raw archive support until there is clear evidence that the normalized manifest loses necessary diagnostic value.

### Required manifest properties

- One uploaded artifact is one UTF-8 JSON string.
- The manifest must carry stable cluster and scope metadata at the top level.
- Each embedded document must be UTF-8 text, not binary content.
- Each embedded document must keep a stable `path` or logical name so deterministic parsing and compare metrics can stay document-aware.
- The first scope model should support:
  - cluster-wide bundles
  - namespace-scoped bundles
- The intended compare anchor should be explicit in submission metadata:
  - cluster scope: `target_identifier=cluster:<cluster-name>`
  - namespace scope: `target_identifier=cluster:<cluster-name>:namespace:<namespace>`

### Recommended manifest shape

```json
{
  "schema_version": "kubernetes-bundle.v1",
  "cluster": {
    "name": "prod-eu-1",
    "provider": "aks"
  },
  "scope": {
    "level": "cluster",
    "namespace": null
  },
  "collected_at": "2026-03-25T10:15:00Z",
  "collector": {
    "type": "signalforge-collectors",
    "version": "0.1.0"
  },
  "documents": [
    {
      "path": "kubectl/get-nodes.json",
      "kind": "kubectl-resource-list",
      "media_type": "application/json",
      "content": "{...json text...}"
    },
    {
      "path": "kubectl/get-pods-all-namespaces.txt",
      "kind": "kubectl-table",
      "media_type": "text/plain",
      "content": "NAMESPACE NAME READY STATUS ..."
    },
    {
      "path": "events/warning-events.txt",
      "kind": "events",
      "media_type": "text/plain",
      "content": "..."
    }
  ]
}
```

### Guardrails

- Keep `documents[*].content` text-only in v1.
- Do not add nested tarballs, screenshots, or opaque binary attachments.
- Do not require SignalForge to understand every possible support-bundle layout.
- Prefer a narrow reference export with a small set of explicit document kinds first.
- If later evidence shows that critical value is lost during normalization, treat raw archive support as a separate ingestion/storage phase, not a quiet extension of the same adapter.

---

## Explicit Near-Term Non-Goals

These are out of scope for the first implementation pass:

- live `kubectl` access from SignalForge
- live `docker` or `podman` execution from SignalForge
- a generalized collector plugin system
- multi-artifact fleet management
- scheduling and notification work for new artifact families
- extending the current host agent to handle Kubernetes or containers before push-first flows are proven
- remediation implementation in this phase

---

## Longer-Term Execution Direction

These are not first-pass implementation items, but they should shape the architecture now:

- **One agent product, multiple deployment modes**
  - host / VM / WSL service
  - containerized deployment for container-host environments
  - in-cluster deployment for Kubernetes environments
- **Capability-scoped behavior**
  - examples:
    - `collect:linux-audit-log`
    - `collect:container-diagnostics`
    - `collect:kubernetes-bundle:namespace`
    - `collect:kubernetes-bundle:cluster`
- **Trust-tier separation**
  - read-only collection capabilities should not automatically imply write/remediation authority
  - future remediation should be modeled as a separate capability class, not just “another collector”
- **Auditability**
  - any future remediation path should support explicit approvals, action logging, and reviewable blast radius

This keeps the door open for a broader execution-plane product later without muddying the current evidence-first boundary.

---

## Phase 0: Compare Becomes Useful

**User stories**:
- As an operator, I want compare to tell me something useful even when the same findings persist.
- As an operator, I want to know whether evidence changed, metadata changed, or only the analyzer output stayed flat.

### What to build

Add a deterministic “stability and evidence delta” layer to compare so runs can show meaningful movement even when there are no new, resolved, or severity-shifted findings. This should work for the existing Linux evidence first, then carry forward to new artifact families.

The implementation should add a shared compare payload block named `evidence_delta`, produced by shared compare code and exposed through the read API. Candidate fields include:

- evidence or artifact changed vs identical
- metadata differences such as `collected_at`, `collector_type`, `collector_version`, and `target_identifier`
- stable aggregate changes that are deterministic and family-aware, such as package counts, listener counts, object counts, or section completeness markers
- a summary string or count block the UI can render when finding drift is empty

### Recommended `evidence_delta` contract

Use a sibling payload block on compare responses rather than adding more `drift.rows` statuses. Recommendation:

```ts
type EvidenceDeltaStatus = "changed" | "unchanged" | "added" | "removed";

interface EvidenceDeltaMetricRow {
  key: string;
  label: string;
  family: "common" | "linux-audit-log" | "container-diagnostics" | "kubernetes-bundle";
  status: EvidenceDeltaStatus;
  previous: string | number | boolean | null;
  current: string | number | boolean | null;
  unit?: string | null;
}

interface EvidenceDeltaPayload {
  changed: boolean;
  summary: {
    metadata_changed: number;
    metric_changes: number;
    artifact_changed: boolean;
  };
  metadata: {
    filename: EvidenceDeltaStatus;
    target_identifier: EvidenceDeltaStatus;
    collected_at: EvidenceDeltaStatus;
    collector_type: EvidenceDeltaStatus;
    collector_version: EvidenceDeltaStatus;
  };
  metrics: EvidenceDeltaMetricRow[];
}
```

Recommended compare response shape:

```json
{
  "current": { "...": "existing fields" },
  "baseline": { "...": "existing fields" },
  "baseline_missing": false,
  "target_mismatch": false,
  "baseline_selection": "implicit_same_target",
  "against_requested": null,
  "drift": { "...": "existing finding drift payload" },
  "evidence_delta": {
    "changed": true,
    "summary": {
      "metadata_changed": 2,
      "metric_changes": 1,
      "artifact_changed": true
    },
    "metadata": {
      "filename": "unchanged",
      "target_identifier": "unchanged",
      "collected_at": "changed",
      "collector_type": "unchanged",
      "collector_version": "changed"
    },
    "metrics": [
      {
        "key": "listener_count",
        "label": "Listening ports",
        "family": "linux-audit-log",
        "status": "changed",
        "previous": 14,
        "current": 16,
        "unit": null
      }
    ]
  }
}
```

Why this shape:

- it preserves backward compatibility for existing `drift`
- it avoids overloading finding drift with non-finding changes
- it gives the UI a compact summary and a deterministic details list
- it lets each artifact family add stable metrics without changing the top-level contract

Guardrails:

- `evidence_delta` should be present even when there is no finding drift
- when `baseline_missing=true`, return `evidence_delta=null` rather than inventing synthetic changes
- do not emit raw evidence excerpts here; this block is for stable metadata and aggregate deltas only

### Acceptance criteria

- [ ] Compare distinguishes “no finding drift” from “no meaningful change at all”.
- [ ] Compare exposes stable deltas such as evidence changes, package-count changes, listener count changes, metadata differences, or collection-time differences when findings remain matched.
- [ ] The compare UI shows a useful empty-state alternative such as “same finding set; evidence changed in X places”.
- [ ] Existing deterministic finding drift remains unchanged as the primary compatibility layer.
- [ ] The compare API contract documents the new deterministic delta block so Linux, container, and Kubernetes runs use the same read model.

### Notes

This is not optional polish. If compare remains dead when findings are unchanged, both container and Kubernetes adoption will inherit the same low-value operator experience.

---

## Phase 1: Container Push Path

**User stories**:
- As an operator, I can submit a container diagnostic artifact and get a real SignalForge run.
- As an operator, I can compare two runs for the same container or containerized workload.

### What to build

Introduce `container-diagnostics` as the second artifact family. Define a narrow reference collector pattern that gathers container runtime facts and container-focused security/configuration evidence, submits it through the existing ingestion API, and produces deterministic findings plus one LLM explanation pass.

For the first slice, keep the artifact envelope compatible with the current ingestion path. That means plain text or a small structured payload normalized to text or JSON before upload, not raw runtime archives.

### Acceptance criteria

- [x] SignalForge accepts `artifact_type=container-diagnostics`.
- [x] A dedicated adapter handles environment detection, noise suppression, deterministic findings, and incomplete-audit detection for container evidence.
- [x] At least one real fixture and one golden expected-output contract exist for a container artifact.
- [x] Upload, run detail, and compare work end-to-end for container runs.
- [x] Docs describe the reference submission pattern and required metadata for stable compare.
- [x] The docs make the intended compare identity explicit: container workload vs container instance.

### Tracer-bullet success condition

A single container artifact can be submitted end-to-end and produces a credible run page, not just parser output in isolation.

---

## Phase 2: Container Findings Quality

**User stories**:
- As an operator, I get findings that reflect container reality, not host-oriented wording.
- As an operator, I can trust that common container noise is not overstated.

### What to build

Improve the container adapter until it produces a narrow, credible set of deterministic findings around runtime exposure, privileged configuration, image/runtime hygiene, mounted secrets, host-path access, and resource risk. Tune the LLM summary and action ranking for container workloads instead of generic server language.

### Acceptance criteria

- [ ] Deterministic rules cover a first credible set of container-specific risks and expected noise.
- [ ] Summary/action wording is container-aware and not phrased like a generic VM audit.
- [ ] Compare normalization handles volatile container identifiers where the underlying issue is the same.
- [ ] The product can demonstrate at least one resolved issue and one unchanged issue across two container runs.

### Notes

Container quality work should stay narrow at first:
- exposed ports
- privileged or host-network/container settings
- mounted secrets or broad host-path access
- image/runtime hygiene signals that are explicit in the artifact
- noisy-but-expected container runtime chatter

Current branch status:
- complete through the first credible container slice
- compare and fallback wording are already container-aware
- further work is optional tuning, not missing plumbing

---

## Phase 3: Kubernetes Bundle Push Path

**User stories**:
- As an operator, I can submit a Kubernetes support bundle and get a usable SignalForge run.
- As an operator, I can compare two runs for the same cluster or namespace scope.

### What to build

Introduce `kubernetes-bundle` as a third artifact family. Start with support-bundle style evidence that is easy to export and upload, rather than live-cluster access from SignalForge. Focus the first slice on cluster or namespace configuration and health evidence that can be analyzed deterministically.

For v1, the artifact envelope is already chosen:

- use a UTF-8 JSON manifest submitted through the current text upload path
- carry stable top-level cluster and scope metadata plus named embedded text documents
- keep raw archive or binary support out of scope for this phase

### Acceptance criteria

- [x] SignalForge accepts `artifact_type=kubernetes-bundle`.
- [x] A dedicated adapter handles Kubernetes environment detection, noise suppression, deterministic findings, and incomplete-bundle detection.
- [x] At least one real fixture and one golden expected-output contract exist for Kubernetes evidence.
- [x] Upload, run detail, and compare work end-to-end for Kubernetes runs.
- [x] The first implementation consumes the locked `kubernetes-bundle.v1` JSON manifest shape rather than a raw archive.
- [x] Submission docs define the recommended `target_identifier` and scope model for clusters and namespaces.
- [x] The implementation makes scope explicit so cluster-wide and namespace-scoped bundles do not compare accidentally.

### Tracer-bullet success condition

A single Kubernetes bundle can be submitted end-to-end and produces a credible run page, with compare anchored to a stable cluster identifier instead of volatile pod-level names.

---

## Phase 4: Kubernetes Findings Quality

**User stories**:
- As an operator, I get findings that map to Kubernetes concepts instead of generic Linux findings.
- As an operator, I can distinguish cluster misconfiguration from expected platform noise.

### What to build

Improve the Kubernetes adapter around RBAC exposure, control-plane or workload misconfiguration, public service exposure, secret/config drift, workload health, and noisy-but-expected platform conditions. Tune summaries and actions around cluster operators and platform engineers rather than host admins.

The implementation should use real platform guidance rather than improvised severity lore. Recommended sources include upstream Kubernetes security guidance, Pod Security Standards, RBAC least-privilege guidance, Service/networking docs, probe guidance, and provider-specific operational guidance where it affects realistic defaults or wording.

### Acceptance criteria

- [x] Deterministic rules cover a first credible Kubernetes-specific risk set.
- [ ] Expected platform noise is documented and suppressed deterministically where appropriate.
- [ ] Compare normalization handles stable issue identity across bundle exports with volatile names or counts.
- [x] The product can demonstrate meaningful compare output across two Kubernetes runs even when the broad risk posture is stable.
- [x] At least part of the Kubernetes rule and fixture set is informed by realistic bundle content or live read-only cluster inspection rather than purely invented synthetic examples.

### Notes

Kubernetes quality work should start with high-signal areas only:
- public service exposure
- RBAC over-breadth that is explicit in the bundle
- workload health and crash patterns
- secret/config drift that is explicit in the evidence
- noisy control-plane or system add-on conditions filtered as expected where justified

Guardrails for execution:

- prefer read-only cluster inspection when generating or validating realistic fixtures
- use local tools such as `kubectl`, `podman`, or Docker-compatible commands when they materially improve fixture realism
- do not mutate live clusters unless the user explicitly asks for that
- document which cluster/runtime context informed a rule or fixture when that context meaningfully shaped the result

Current branch status:
- public exposure, namespace isolation gaps, workload health, secret handling, workload hardening, host-escape settings, RBAC over-breadth, workload-to-identity joins, and exposed-workload-to-identity joins are already implemented
- the main remaining quality gaps are noise suppression depth and stronger stable issue normalization across changing bundle exports

---

## Phase 5: Sources And Collection Integration

**User stories**:
- As an operator, I can register a source for container or Kubernetes evidence with honest product expectations.
- As an operator, I know which evidence types are push-first and which are job-driven.

### What to build

Extend Sources and collection setup so container and Kubernetes evidence types become visible product concepts without pretending that the current host agent can collect them automatically. Keep push-first flows as the default until there is a proven reason to add execution-plane support for either family.

This phase must not silently assume that one logical source always maps to one registration or one execution scope. If Sources grow beyond the current host model, document whether different deployment forms or capability scopes are represented as:

- separate sources
- multiple registrations bound to one source
- a new execution-scope model layered under one source identity

### Acceptance criteria

- [ ] Source registration supports the new artifact families and collector labels.
- [ ] “How to collect” guidance is artifact-aware for Linux, containers, and Kubernetes.
- [ ] The UI clearly distinguishes push-first submission patterns from job-driven host collection.
- [ ] No live-cluster or container-runtime remote execution is introduced into the web app.
- [ ] The chosen model for execution scope is documented before any multi-scope agent behavior is implied in UI copy or API shape.

### Notes

This phase should follow real submissions, not lead them. SignalForge needs the artifact contracts and findings shape first.

When this phase happens, the UI should be honest about scope:
- push-first flows remain valid even if no agent is present
- some future capabilities may require cluster-scoped collection, not just namespace-scoped collection
- remediation, if ever added, must be represented as a higher-trust mode than read-only diagnostics

---

## Phase 6: Optional Orchestration Decision

**User stories**:
- As a product owner, I can decide whether either new artifact family deserves job-driven collection after real usage.

### What to build

Make an explicit product decision after real submissions: keep both families push-first, or introduce a thin execution-plane path for one of them. This phase is a decision gate, not an automatic implementation commitment.

### Acceptance criteria

- [ ] Real usage data exists for both container and Kubernetes submissions.
- [ ] The team can point to concrete operator pain that justifies orchestration work.
- [ ] Any proposed agent or collection workflow preserves the current product boundary and blast-radius constraints.

### Notes

If orchestration is added later, choose capability scope based on diagnostic need:
- container hosts may need local runtime visibility
- Kubernetes may need cluster-scoped read access for meaningful diagnostics
- do not assume the current one-registration-per-source shape is sufficient for Kubernetes or mixed-scope execution
- future remediation should be a separate decision and trust tier, not bundled into the first orchestration step
