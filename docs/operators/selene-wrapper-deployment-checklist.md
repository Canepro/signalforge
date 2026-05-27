# Automation-Agent Wrapper Deployment Checklist

Status: Phase 12 operational reference
Updated: 2026-05-27

Use this checklist when deploying or rotating a source-bound automation-agent
wrapper. Keep real hostnames, token paths, run ids, and incident notes in the
private operations repo.

**Placeholders**

- `<token-dir>` - host directory for automation-agent token files.
- `<ops-base>/scripts/` - host directory for deployed wrappers.
- `<source-slug>` - `target_identifier` with `:` replaced by `-`.
- `<SOURCE_SLUG>` - `target_identifier` with `:` and `-` replaced by `_`, then uppercased.

For the wrapper contract see [`selene-source-wrappers.md`](./selene-source-wrappers.md).
For enrollment see [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md).

Do not add secret values, token contents, kubeconfigs, private host paths, or
private reports to this file.

## Token-Path Cutover

Use this when migrating a Source from a legacy shared token file to a per-source
token file.

**Pre-conditions**

- [ ] The current automation-agent path works.
- [ ] The Source has a stable `target_identifier`.
- [ ] The new per-source wrapper is deployed but not yet used for production requests.
- [ ] The token exists in the secret manager under `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>`.

**Steps**

1. Write the token to the per-source path without printing the value:

   ```bash
   install -m 0640 -o root -g <runtime-group> /dev/null \
     <token-dir>/signalforge-automation-agent-token-<source-slug>
   # Copy token bytes with an approved secret injection method.
   ```

2. Confirm ownership, mode, and non-empty file:

   ```bash
   stat -c '%U:%G %a %n' \
     <token-dir>/signalforge-automation-agent-token-<source-slug>
   test -s <token-dir>/signalforge-automation-agent-token-<source-slug>
   ```

3. Run the new wrapper health check:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   <ops-base>/scripts/signalforge-diagnostic-<source-slug>.sh --health-check
   ```

4. Request diagnostics for a real operator reason:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   <ops-base>/scripts/signalforge-diagnostic-<source-slug>.sh \
     collect-summary "operator verification after token-path cutover"
   ```

5. Record the request id, run id, status, and top findings in the private
   verification report.
6. Remove the legacy token file only after the new wrapper is confirmed.

**Rollback**

If the legacy token file has not been removed, switch the invocation path back
to the legacy wrapper and remove the new token file. If the legacy file was
removed, restore it from the secret manager before changing the wrapper path.

## New Linux Host Deployment

Use this for a new `linux:<host-label>` Source.

**Pre-conditions**

- [ ] Source exists in the Sources UI.
- [ ] Execution-agent token and automation-agent token are both enrolled.
- [ ] `signalforge-agent` is running on the host and heartbeating.
- [ ] SignalForge is reachable from the host.
- [ ] Automation-agent token is stored under
  `SIGNALFORGE_AUTOMATION_AGENT_TOKEN_<SOURCE_SLUG>`.

**Steps**

1. Write the token to:

   ```text
   <token-dir>/signalforge-automation-agent-token-<source-slug>
   ```

2. Confirm file mode and ownership:

   ```bash
   test -s <token-dir>/signalforge-automation-agent-token-<source-slug>
   stat -c '%U:%G %a %n' \
     <token-dir>/signalforge-automation-agent-token-<source-slug>
   ```

3. Deploy the wrapper:

   ```bash
   cp /path/to/signalforge/examples/selene-wrappers/signalforge-diagnostic-<source-slug>.sh \
      <ops-base>/scripts/signalforge-diagnostic-<source-slug>.sh
   chmod 0755 <ops-base>/scripts/signalforge-diagnostic-<source-slug>.sh
   ```

4. Run `--health-check`.
5. Request diagnostics with `collect-summary` for a real operator reason.
6. Record the private verification result outside this repo.

**Rollback**

Remove the wrapper script and token file. If a diagnostic request was queued by
mistake, record its `request_id` and cancel it through the Source detail page or
collection-job cancel route when appropriate.

## Blocked Sources

Do not deploy wrappers or token files for Sources whose target name, artifact
family, execution agent, or secret path is not decided yet.

| source pattern | common blocker |
| --- | --- |
| `mac:<workstation>` | dedicated macOS artifact family or interim Linux-compatible evidence decision |
| `aks:<cluster-name>` | cluster identity, kubeconfig path, and read-only RBAC not confirmed |
| `container-host:<host-label>` | runtime host and Docker/Podman socket access not confirmed |

## Verification Report Template

Store completed reports in the private operations repo or ticket system.

```markdown
## Automation-agent wrapper deployment verification

Date:
Source target_identifier:
Operator:
SignalForge git sha:
Private wrapper path:

### Pre-deployment checks
- [ ] Source exists in SignalForge Sources UI
- [ ] Automation-agent token enrolled and stored under the correct per-source name
- [ ] Execution agent is heartbeating for this Source

### Token path
- [ ] Token file written at per-source path
- [ ] Permissions confirmed (`root:<runtime-group> 0640` on Linux)
- [ ] Legacy file removed only after replacement path works, if applicable

### Wrapper
- [ ] Template copied to production scripts path
- [ ] `SIGNALFORGE_AGENT_SCRIPT` set or helper on PATH
- [ ] `--health-check` exit 0

### Verification
- [ ] Diagnostic request returned a request_id
- [ ] Request reached terminal state: _______________
- [ ] Run appeared in SignalForge linked to correct Source
- [ ] Result was non-empty

### Notes / blockers
(free text)
```

## Related Docs

- [`selene-source-wrappers.md`](./selene-source-wrappers.md)
- [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md)
- [`source-inventory-map.md`](./source-inventory-map.md)
- [`../infisical-secrets.md`](../infisical-secrets.md)
