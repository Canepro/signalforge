# Selene Wrapper Deployment Checklist

Status: Phase 12 operational follow-through  
Updated: 2026-05-27

Operational checklists for deploying and verifying the per-source Selene
wrapper scripts in velora-infra.

For the wrapper contract and script templates see
[`selene-source-wrappers.md`](./selene-source-wrappers.md).  
For token enrollment steps see
[`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md).

**Do not add secret values, token contents, or host-specific credentials to
this file.**

---

## `oke:prod-eu1` — token-path cutover and wrapper deployment

**Pre-conditions (verify before starting):**

- [ ] Selene live path is currently working (OKE runs appear in SignalForge)
- [ ] Current token is at legacy path; test with:
  ```bash
  test -f /etc/velora-infra/selene/secrets/signalforge-automation-agent-token \
    && echo "legacy token file: present" || echo "MISSING"
  ```
- [ ] SignalForge template is on the VPS (copy from
  `examples/selene-wrappers/signalforge-diagnostic-oke-prod-eu1.sh`)
- [ ] `signalforge-automation-agent.sh` is accessible on the VPS and path is
  known for `SIGNALFORGE_AGENT_SCRIPT`

**Deployment steps:**

1. Write the token to the per-source path (do not print the value):

   ```bash
   # On the VPS host — requires root or sudo
   install -m 0640 -o root -g ubuntu /dev/null \
     /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1
   # Copy the token value from the legacy file:
   cp /etc/velora-infra/selene/secrets/signalforge-automation-agent-token \
      /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-oke-prod-eu1
   ```

2. Deploy the wrapper script from the SignalForge template:

   ```bash
   cp /path/to/signalforge/examples/selene-wrappers/signalforge-diagnostic-oke-prod-eu1.sh \
      /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh
   chmod 0755 /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh
   ```

3. Set `SIGNALFORGE_AGENT_SCRIPT` to the location of `signalforge-automation-agent.sh`
   on the VPS if it is not on PATH (either in the wrapper config or as an env
   var for the Selene runtime).

4. Run the no-value health check on the **new** wrapper:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh \
     --health-check
   ```

   Expected: exit 0, token file present, SignalForge reachable.

5. Run a smoke diagnostic request through the **new** wrapper:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-oke-prod-eu1.sh \
     --reason "oke cutover smoke" \
     --wait
   ```

   Expected: terminal state `submitted`, run appears in SignalForge linked to
   `oke:prod-eu1`.

6. **Only after step 5 is confirmed:** remove the legacy unsuffixed token file:

   ```bash
   rm /etc/velora-infra/selene/secrets/signalforge-automation-agent-token
   ```

7. Update `docs/operators/source-inventory-map.md`: replace the legacy path
   note on the OKE row with the confirmed per-source path.

**Rollback:**

The legacy token file is **not removed** until step 6 — so the legacy wrapper
(if still deployed) will continue to work if anything fails before that point.

If step 4 or 5 fail and you have not yet removed the legacy file:
- The existing live Selene path is unaffected.
- Remove the new wrapper and the new per-source token file.
- Investigate the failure (token file permissions, SIGNALFORGE_AGENT_SCRIPT
  path, connectivity).

If you removed the legacy file and need to roll back:
- Restore the token from Infisical secret
  `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_OKE_PROD_EU1` to the legacy path.

---

## `linux:hostinger-prod` — initial wrapper deployment

**Pre-conditions (verify before starting):**

- [ ] Source `linux:hostinger-prod` exists in SignalForge Sources UI
- [ ] Automation-agent token has been issued (see
  [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md))
- [ ] Token is stored in Infisical under
  `SIGNALFORGE_SELENE_AUTOMATION_AGENT_TOKEN_LINUX_HOSTINGER_PROD`
- [ ] `signalforge-agent` is running on the VPS and the Source shows a recent
  heartbeat in the Sources UI
- [ ] SignalForge is reachable from the VPS

**Deployment steps:**

1. Write the token to the host at the per-source path (fetch value from
   Infisical; do not pass it through a shell variable that might appear in logs):

   ```bash
   # On the VPS host — requires root or sudo
   install -m 0640 -o root -g ubuntu /dev/null \
     /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod
   # Write the token value using infisical run or a trusted injection method
   ```

2. Verify the token file exists and is non-empty (without printing the value):

   ```bash
   test -s /etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod \
     && echo "token file: present and non-empty" || echo "MISSING or empty"
   ```

3. Deploy the wrapper script from the SignalForge template:

   ```bash
   cp /path/to/signalforge/examples/selene-wrappers/signalforge-diagnostic-linux-hostinger-prod.sh \
      /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh
   chmod 0755 /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh
   ```

4. Run the no-value health check:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh \
     --health-check
   ```

   Expected: exit 0, token file present, SignalForge reachable.

5. Confirm the `signalforge-agent` execution agent is actively heartbeating
   for `linux:hostinger-prod` before requesting a run:

   ```bash
   # Check in the SignalForge Sources UI — look for a recent heartbeat timestamp.
   # Only proceed when the Source shows an active heartbeat.
   ```

6. Run a smoke diagnostic request:

   ```bash
   SIGNALFORGE_BASE_URL=https://<signalforge-host> \
   SIGNALFORGE_AGENT_SCRIPT=/path/to/signalforge-automation-agent.sh \
   /opt/velora-infra/stacks/hermes/selene/scripts/signalforge-diagnostic-linux-hostinger-prod.sh \
     --reason "linux hostinger smoke" \
     --wait
   ```

   Expected: terminal state `submitted`, `linux-audit-log` run appears in
   SignalForge linked to `linux:hostinger-prod`.

**Rollback:**

This is the initial deployment — there is no live path to break. To roll back:
- Remove the wrapper script from velora-infra.
- The token file on the host can stay; it is not harmful to leave it present.
- A diagnostic request in flight will expire naturally (default: 5 minutes).
- No change to SignalForge state is needed.

---

## Blocked sources — do not deploy

| source | blocker |
|--------|---------|
| `mac:vincent-primary` | `mac-diagnostics` family decision pending; Source not enrolled |
| `aks:TODO` | AKS cluster name unknown; Source not created |
| `container-host:TODO` | Container host target unknown; Source not created |

Do not deploy wrapper scripts or write token files for these Sources until their
prerequisites are met. See [`source-inventory-map.md`](./source-inventory-map.md).

---

## Operator verification report template

Copy this block into a deployment record (local notes, Jira, or the velora-infra
runbook) after deploying or rotating a wrapper. Do not commit completed reports
to the SignalForge repo.

```markdown
## Selene wrapper deployment verification

Date:
Source target_identifier:
Operator:
SignalForge git sha:
velora-infra wrapper path:

### Pre-deployment checks
- [ ] Source exists in SignalForge Sources UI
- [ ] Automation-agent token enrolled and in Infisical under correct per-source name
- [ ] execution agent (signalforge-agent) heartbeating for this Source

### OKE cutover only
- [ ] Legacy token file confirmed present before migration
- [ ] Per-source token file written and permissions confirmed (root:ubuntu 0640)
- [ ] Legacy file removed only after new wrapper confirmed working

### New deployment (linux, mac, or future sources)
- [ ] Token file written at per-source path, permissions confirmed (root:ubuntu 0640 on Linux)

### Wrapper deployment
- [ ] Template copied to production scripts path
- [ ] SIGNALFORGE_AGENT_SCRIPT set or binary on PATH
- [ ] `--health-check` exit 0

### Smoke test
- [ ] Diagnostic request returned a request_id
- [ ] `--wait` reached terminal state: _______________
- [ ] Run appeared in SignalForge linked to correct Source
- [ ] Result was non-empty (submitted state, not failed/expired)

### Notes / blockers
(free text)
```

---

## Related docs

- [`selene-source-wrappers.md`](./selene-source-wrappers.md)
- [`selene-multi-source-enrollment.md`](./selene-multi-source-enrollment.md)
- [`source-inventory-map.md`](./source-inventory-map.md)
- [`../infisical-secrets.md`](../infisical-secrets.md)
