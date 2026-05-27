# Selene Multi-Source Enrollment

Status: Phase 12 slice 3 — operator runbook  
Updated: 2026-05-27

This runbook covers how to enroll Selene as an automation agent for each
Source in the inventory map, how to name and store tokens, and how Selene
discovers which token belongs to which Source.

For the canonical Source list see
[`source-inventory-map.md`](./source-inventory-map.md).  
For the HTTP API contract see
[`automation-agent-integration.md`](./automation-agent-integration.md).

---

## Strict separation — read this first

| pair | rule |
|------|------|
| automation-agent token vs execution-agent token | Never the same credential. The automation-agent token is Selene's. The execution-agent token is `signalforge-agent`'s. They are enrolled separately and stored in different files. |
| Selene token vs Codex App Server identity | Selene authenticates to SignalForge with a source-bound token over HTTP. Codex App Server is a local analysis-brain subprocess. They share no credentials. |
| token scope vs source scope | Each automation-agent token is bound to exactly one Source at enroll time. SignalForge rejects requests that try to override `source_id`. Selene cannot read or act on Sources other than the one bound to the token in use. |
| SignalForge storage vs raw infrastructure | SignalForge stores token hashes and issued registrations. It does not store kubeconfigs, SSH keys, or VPS credentials. |

---

## Infisical naming convention

One Infisical secret per Source, per environment (`production` or `development`).

**Name pattern:**

```
SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>
```

where `<SOURCE_SLUG>` is the `target_identifier` with `:` and `-` replaced by `_`,
uppercased.

| target\_identifier      | Infisical secret name |
|-------------------------|-----------------------|
| `oke:prod-eu1`          | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` |
| `linux:hostinger-prod`  | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD` |
| `mac:vincent-primary`   | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_MAC_VINCENT_PRIMARY` |
| `aks:TODO`              | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_AKS_TODO` *(do not create until cluster is named)* |
| `container-host:TODO`   | `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_CONTAINER_HOST_TODO` *(do not create until target is named)* |

Store the plaintext token value in Infisical as the durable secret source.
SignalForge stores only the hash. Runtime hosts may also have a materialized
token file copied from Infisical so Selene wrappers can run without printing or
fetching the value interactively.

---

## Host file naming convention

On Linux/VPS execution hosts that run Selene wrappers, store the token at:

```
/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-<source-slug>
```

where `<source-slug>` is the `target_identifier` with `:` replaced by `-` and
kept lowercase.

On macOS workstation surfaces, use a user-local path under `~/.config` with
mode `600` unless the wrapper is intentionally installed as a LaunchDaemon with
a different service account.

| target\_identifier      | host file path |
|-------------------------|----------------|
| `oke:prod-eu1`          | `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1` |
| `linux:hostinger-prod`  | `/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod` |
| `mac:vincent-primary`   | `~/.config/signalforge/selene-automation-agent-token-mac-vincent-primary` |

**OKE backward-compatibility note:** The existing live OKE token is currently
stored at the legacy path
`/etc/velora-infra/selene/secrets/signalforge-automation-agent-token`
(no source suffix). That path is in use and must not be moved until the
`signalforge-diagnostic.sh` wrapper on the VPS is updated to read the
per-source path. Until that wrapper update (slice 4), keep the OKE token at
the legacy path. The per-source convention applies to all new enrollments.

---

## Enrollment steps

Prerequisites for all Sources:

```bash
export SIGNALFORGE_BASE_URL=https://<your-signalforge-host>
export SIGNALFORGE_ADMIN_TOKEN=<from-infisical>   # do not hard-code
```

### `oke:prod-eu1` (already live — verification only)

The OKE automation-agent token is already enrolled. To verify:

1. Confirm the Source appears in the SignalForge Sources UI.
2. Confirm the automation-agent registration shows a display name of `selene`
   or equivalent.
3. Confirm the token file exists at the legacy path (do not print value):

   ```bash
   test -f /etc/velora-infra/selene/secrets/signalforge-automation-agent-token \
     && echo "token file present" || echo "MISSING"
   ```

4. Confirm Selene can request a diagnostic run:

   ```bash
   SIGNALFORGE_AUTOMATION_AGENT_TOKEN=$(cat /etc/velora-infra/selene/secrets/signalforge-automation-agent-token) \
   ./scripts/signalforge-automation-agent.sh request --reason "slice-3 smoke"
   ```

5. Add the token to Infisical under
   `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` if not already
   stored there. Use the token value that is already deployed on the VPS —
   do not issue a new token unless intentionally rotating.

---

### `linux:hostinger-prod` (enrolled — end-to-end smoke pending)

1. Find the SignalForge `source_id` for this Source from the Sources UI.

2. Confirm the automation-agent registration already exists. Do not run
   `register` again for this Source; duplicate registration returns
   `409 automation_agent_already_registered`.

   For a new Source that is not yet registered, the enrollment command is:

   ```bash
   ./scripts/signalforge-automation-agent.sh \
     register <source-id> \
     --display-name selene \
     --print-exports
   ```

   The response JSON goes to stdout. The `--print-exports` flag writes
   ready-to-export env lines to stderr. Copy the token from the response —
   it is shown only once.

3. Confirm the already-issued token is stored in Infisical under
   `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD`. If the
   token is missing from Infisical and not present on the host, stop and use the
   operator-approved rotation procedure once available; do not try to recover by
   re-registering.

4. Write the token to the host file (on the VPS, as root or with sudo):

   ```bash
   # On the VPS host — do not run on a shared or dev machine
   install -m 0640 -o root -g ubuntu /dev/null \
     /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod
   # Write the token value using your preferred secret injection method
   ```

   Use the group that the Selene runtime belongs to. On the current VPS that is
   `ubuntu`, matching the live OKE token file contract (`root:ubuntu 0640`).

5. Smoke-test the enrollment:

   ```bash
   SIGNALFORGE_AUTOMATION_AGENT_TOKEN=$(cat \
     /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod) \
   ./scripts/signalforge-automation-agent.sh request --reason "slice-3 smoke"
   ```

   Expected: a `request_id` is returned and the request transitions to
   `submitted` after the execution agent completes the collection job.

---

### `mac:vincent-primary` (planned — do not enroll yet)

Blocked pending the `mac-diagnostics` artifact family decision. When the Source
is created in the app and the family is decided:

1. Create the Source in SignalForge with `target_identifier=mac:vincent-primary`.
2. Enroll the automation-agent token using the same `register` command above.
3. Store in Infisical under
   `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_MAC_VINCENT_PRIMARY`.
4. Store token at `~/.config/signalforge/selene-automation-agent-token-mac-vincent-primary`
   on the workstation (permissions `600`).

---

### `aks:TODO` and `container-host:TODO` (planned — leave as TODO)

Do not enroll until the target cluster name and container host are decided.
Update the Source inventory map and replace `TODO` in the Infisical secret name
before running the enrollment command.

---

## How Selene discovers which Source/token to use

Selene's token selection is **source-bound at invocation time**, not discovered
dynamically at runtime. The model is:

1. Each Source has a canonical token file path on the host where Selene's
   wrapper runs (see the host file naming convention above).
2. Each Source has a dedicated per-source wrapper script that reads its own
   token file (not a shared multi-source wrapper with a `--source` flag).
   See [`selene-source-wrappers.md`](./selene-source-wrappers.md) for the
   per-source script names and deployment contract.
   Until the OKE wrapper is updated in velora-infra, the live OKE wrapper
   continues to read the legacy unsuffixed token path.
3. Infisical is the durable store for all tokens. When a host is reprovisioned
   or the token is rotated, the new value comes from Infisical and is written to
   the host token file path by the provisioning process — not from chat or
   manual copy-paste.
4. SignalForge `auth.md` and well-known metadata publish the supported scopes
   (`source.read`, `automation_signal.read`, `diagnostic_request.create`,
   `diagnostic_request.read`, `fix_action.request`). Selene can read these to
   confirm what the token is authorized to do, but does not use them to discover
   which Source to operate. Source selection remains explicit and operator-assigned.

Selene never holds a credential that spans multiple Sources. If Selene needs to
operate two Sources, she holds two tokens, one per Source.

---

## Token rotation

To rotate an existing automation-agent token for a Source:

1. Use the operator-approved automation-agent rotation path once implemented.
   The current `register` command is create-only and duplicate registration
   returns `409 automation_agent_already_registered`, so it is not a rotation
   mechanism.
2. Copy the new token to Infisical under the per-source secret name.
3. Write the new token to the host file path.
4. Confirm the wrapper can still request diagnostics before closing the rotation.

Do not attempt to rotate by editing the database directly.

---

## Verification checklist

Run after enrolling or rotating a token for any Source:

- [ ] `register` returned an `automation_agent_id` and a one-time token
- [ ] Token stored in Infisical under the correct per-source secret name
- [ ] Token stored at the correct host file path (`root:<selene-runtime-group> 0640` on Linux hosts; `600` for local user-only workstation files)
- [ ] `request --reason "smoke"` returns a `request_id`
- [ ] `wait <request-id>` reaches `submitted` with a non-null `result`
- [ ] Run appears in the SignalForge Sources UI linked to the correct Source
- [ ] No cross-source access: a token enrolled for Source A must return `403` when used against Source B's requests

---

## Related docs

- [`source-inventory-map.md`](./source-inventory-map.md)
- [`automation-agent-integration.md`](./automation-agent-integration.md)
- [`selene-codex-app-server-integration.md`](./selene-codex-app-server-integration.md)
- [`sources-and-agents.md`](./sources-and-agents.md)
- [`../infisical-secrets.md`](../infisical-secrets.md)
