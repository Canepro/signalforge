# Plan: Container And Kubernetes Evidence Expansion

> Source request: operator wants concrete next implementation steps for container and Kubernetes support, and the current drift UI is too low-value when findings remain unchanged.

## Architectural decisions

Durable decisions that apply across all phases:

- **Boundary**: SignalForge remains an analysis platform. Collectors stay external. No SSH, `kubectl`, `docker exec`, or privileged remote execution from the Next.js app.
- **Artifact strategy**: add two narrow artifact families, not a generic collector framework:
  - `container-diagnostics`
  - `kubernetes-bundle`
- **Acquisition model**: ship both families as **push-first** submission patterns first. Do not block on job-driven collection or agent orchestration.
- **Reuse path**: preserve the existing ingestion contract (`POST /api/runs` and job-bound artifact upload) and extend adapter selection by `artifact_type`.
- **Compare model**: keep deterministic finding-key drift as the base layer, but add a second read model for “same findings, changed evidence/metadata” so compare remains useful when systems are stable.
- **Identity**:
  - containers should prefer explicit `target_identifier` values such as `container:<host>:<runtime>:<name-or-id>`
  - Kubernetes should prefer explicit `target_identifier` values such as `cluster:<cluster-name>` or `cluster:<cluster-name>:namespace:<scope>`
- **Operator UX**: containers and Kubernetes must feel like first-class evidence types in upload, run detail, compare, and docs before any orchestration work is considered.

---

## Phase 0: Compare Becomes Useful

**User stories**:
- As an operator, I want compare to tell me something useful even when the same findings persist.
- As an operator, I want to know whether evidence changed, metadata changed, or only the analyzer output stayed flat.

### What to build

Add a deterministic “stability and evidence delta” layer to compare so runs can show meaningful movement even when there are no new, resolved, or severity-shifted findings. This should work for the existing Linux evidence first, then carry forward to new artifact families.

### Acceptance criteria

- [ ] Compare distinguishes “no finding drift” from “no meaningful change at all”.
- [ ] Compare exposes stable deltas such as evidence changes, package-count changes, listener count changes, metadata differences, or collection-time differences when findings remain matched.
- [ ] The compare UI shows a useful empty-state alternative such as “same finding set; evidence changed in X places”.
- [ ] Existing deterministic finding drift remains unchanged as the primary compatibility layer.

---

## Phase 1: Container Push Path

**User stories**:
- As an operator, I can submit a container diagnostic artifact and get a real SignalForge run.
- As an operator, I can compare two runs for the same container or containerized workload.

### What to build

Introduce `container-diagnostics` as the second artifact family. Define a narrow reference collector pattern that gathers container runtime facts and container-focused security/configuration evidence, submits it through the existing ingestion API, and produces deterministic findings plus one LLM explanation pass.

### Acceptance criteria

- [ ] SignalForge accepts `artifact_type=container-diagnostics`.
- [ ] A dedicated adapter handles environment detection, noise suppression, deterministic findings, and incomplete-audit detection for container evidence.
- [ ] At least one real fixture and one golden expected-output contract exist for a container artifact.
- [ ] Upload, run detail, and compare work end-to-end for container runs.
- [ ] Docs describe the reference submission pattern and required metadata for stable compare.

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

---

## Phase 3: Kubernetes Bundle Push Path

**User stories**:
- As an operator, I can submit a Kubernetes support bundle and get a usable SignalForge run.
- As an operator, I can compare two runs for the same cluster or namespace scope.

### What to build

Introduce `kubernetes-bundle` as a third artifact family. Start with support-bundle style evidence that is easy to export and upload, rather than live-cluster access from SignalForge. Focus the first slice on cluster/namespace configuration and health evidence that can be analyzed deterministically.

### Acceptance criteria

- [ ] SignalForge accepts `artifact_type=kubernetes-bundle`.
- [ ] A dedicated adapter handles Kubernetes environment detection, noise suppression, deterministic findings, and incomplete-bundle detection.
- [ ] At least one real fixture and one golden expected-output contract exist for Kubernetes evidence.
- [ ] Upload, run detail, and compare work end-to-end for Kubernetes runs.
- [ ] Submission docs define the recommended `target_identifier` and scope model for clusters and namespaces.

---

## Phase 4: Kubernetes Findings Quality

**User stories**:
- As an operator, I get findings that map to Kubernetes concepts instead of generic Linux findings.
- As an operator, I can distinguish cluster misconfiguration from expected platform noise.

### What to build

Improve the Kubernetes adapter around RBAC exposure, control-plane or workload misconfiguration, public service exposure, secret/config drift, workload health, and noisy-but-expected platform conditions. Tune summaries and actions around cluster operators and platform engineers rather than host admins.

### Acceptance criteria

- [ ] Deterministic rules cover a first credible Kubernetes-specific risk set.
- [ ] Expected platform noise is documented and suppressed deterministically where appropriate.
- [ ] Compare normalization handles stable issue identity across bundle exports with volatile names or counts.
- [ ] The product can demonstrate meaningful compare output across two Kubernetes runs even when the broad risk posture is stable.

---

## Phase 5: Sources And Collection Integration

**User stories**:
- As an operator, I can register a source for container or Kubernetes evidence with honest product expectations.
- As an operator, I know which evidence types are push-first and which are job-driven.

### What to build

Extend Sources and collection setup so container and Kubernetes evidence types become visible product concepts without pretending that the current host agent can collect them automatically. Keep push-first flows as the default until there is a proven reason to add execution-plane support for either family.

### Acceptance criteria

- [ ] Source registration supports the new artifact families and collector labels.
- [ ] “How to collect” guidance is artifact-aware for Linux, containers, and Kubernetes.
- [ ] The UI clearly distinguishes push-first submission patterns from job-driven host collection.
- [ ] No live-cluster or container-runtime remote execution is introduced into the web app.

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

