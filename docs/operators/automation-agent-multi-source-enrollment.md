# Automation-Agent Multi-Source Enrollment

Status: Phase 12 slice 3 reference
Updated: 2026-05-27

This runbook covers source-bound automation-agent enrollment: how to name
tokens, where to store them, and how a wrapper chooses the right Source without
exposing private fleet details in this public repo.

For the Source map see [`source-inventory-map.md`](./source-inventory-map.md).
For the HTTP contract see [`automation-agent-integration.md`](./automation-agent-integration.md).

## Strict Separation

| pair | rule |
| --- | --- |
| automation-agent token vs execution-agent token | Never the same credential. The automation-agent token belongs to the external operator agent. The execution-agent token belongs to `signalforge-agent`. |
| automation-agent token vs Codex App Server identity | The automation agent authenticates to SignalForge over HTTP. Codex App Server is a local analysis-brain subprocess. They share no credentials. |
| token scope vs source scope | Each automation-agent token is bound to one Source at enrollment. SignalForge rejects attempts to override `source_id`. |
| SignalForge storage vs raw infrastructure | SignalForge stores token hashes and registrations. It does not store kubeconfigs, SSH keys, host credentials, or private token files. |

## Infisical Naming Convention

Use one Infisical secret per Source and environment.

```text
SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>
```

`SOURCE_SLUG` is the `target_identifier` with `:` and `-` replaced by `_`, then
uppercased.

| target identifier | Infisical secret name |
| --- | --- |
| `kubernetes:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_KUBERNETES_<CLUSTER_NAME>` |
| `linux:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_LINUX_<HOST_LABEL>` |
| `mac:<workstation>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_MAC_<WORKSTATION>` |
| `aks:<cluster-name>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_AKS_<CLUSTER_NAME>` |
| `container-host:<host-label>` | `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_CONTAINER_HOST_<HOST_LABEL>` |

Store the plaintext token value in Infisical or an equivalent secret manager.
SignalForge stores only the hash. Runtime hosts may also have a materialized
token file copied from the secret store so wrappers can run without printing or
fetching the value interactively.

## Host File Naming Convention

On Linux execution hosts:

```text
<token-dir>/signalforge-automation-agent-token-<source-slug>
```

`source-slug` is the `target_identifier` with `:` replaced by `-`, kept
lowercase.

On macOS workstation surfaces, use a user-local path under `~/.config` with
mode `600` unless the wrapper runs as a LaunchDaemon under a service account.

| target identifier | host token file |
| --- | --- |
| `kubernetes:<cluster-name>` | `<token-dir>/signalforge-automation-agent-token-kubernetes-<cluster-name>` |
| `linux:<host-label>` | `<token-dir>/signalforge-automation-agent-token-linux-<host-label>` |
| `mac:<workstation>` | `~/.config/signalforge/automation-agent-token-mac-<workstation>` |

Legacy unsuffixed token files should be migrated in the private operations repo
with a rollback plan. Do not document private legacy paths or copied token
values in SignalForge.

## Enrollment Steps

Prerequisites:

```bash
export SIGNALFORGE_BASE_URL=https://<your-signalforge-host>
export SIGNALFORGE_ADMIN_TOKEN=<from-secret-manager>
```

1. Confirm the Source exists in the Sources UI and has the expected
   `target_identifier`.
2. Register the automation agent for that Source:

   ```bash
   ./scripts/signalforge-automation-agent.sh \
     register <source-id> \
     --display-name operator-agent \
     --print-exports
   ```

   The token is shown once. Store it immediately in the secret manager and do
   not paste it into chat, docs, or issue comments.

3. Materialize the token on the host that runs the source-bound wrapper:

   ```bash
   install -m 0640 -o root -g <runtime-group> /dev/null \
     <token-dir>/signalforge-automation-agent-token-<source-slug>
   # Write the token value using your approved secret injection path.
   ```

4. Run the wrapper health check:

   ```bash
   SIGNALFORGE_BASE_URL=https://<your-signalforge-host> \
     <ops-base>/scripts/signalforge-diagnostic-<source-slug>.sh --health-check
   ```

5. Request one diagnostic for a real operational reason and record the private
   request id, run id, status, and top findings in the private operations
   report.

## Discovery Model

Token selection is **source-bound at invocation time**, not dynamic.

1. Each Source has one canonical token file path on the host where the wrapper
   runs.
2. Each Source has a dedicated wrapper script that reads only that token file.
   Avoid a shared wrapper with a runtime `--source` flag.
3. Infisical or an equivalent secret manager remains the durable source of
   truth. Host files are runtime materializations, not the source of truth.
4. `GET /auth.md` and well-known metadata publish supported scopes:
   `source.read`, `automation_signal.read`, `diagnostic_request.create`,
   `diagnostic_request.read`, and `fix_action.request`.

An operator agent should hold one credential per Source. A credential that spans
many unrelated Sources is a different trust model and should be designed
explicitly.

## Token Rotation

To rotate an existing automation-agent token:

1. Use the approved rotation path once available. The current registration
   command is create-only and returns `409 automation_agent_already_registered`
   for duplicates.
2. Store the new token in the secret manager under the same per-source name.
3. Update the host token file with restrictive permissions.
4. Run `--health-check`, then one real diagnostic request, before closing the
   rotation.

Do not rotate by editing the database directly.
