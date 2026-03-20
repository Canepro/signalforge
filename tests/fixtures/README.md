# Test Fixtures

Audit log files copied from [server-audit-kit](https://github.com/Canepro/server-audit-kit) for use as mandatory test assets.

## Provenance

| Fixture file | Source | Lines | Description |
|---|---|---|---|
| `sample-prod-server.log` | `server-audit-kit/examples/sample_audit.log` | 141 | Fabricated production Ubuntu 22.04 server. UFW enabled, nginx running. No ANSI codes. |
| `wsl-nov2025-full.log` | `server-audit-kit/server_audit_20251102_232137.log` | 1532 | Full WSL2 audit, kernel 5.15.153.1-microsoft-standard-WSL2, Nov 2025. No ANSI codes. |
| `wsl-nov2025-truncated.log` | `server-audit-kit/server_audit_20251102_231019.log` | 52 | Truncated WSL2 audit — stops after NETWORK CONFIGURATION. Incomplete. |
| `wsl-mar2026-full.log` | `server-audit-kit/server_audit_20260320_193559.log` | 1654 | Full WSL2 audit, kernel 6.6.87.2-microsoft-standard-WSL2, Mar 2026. **Contains ANSI color codes.** |

## Parser contract

The `LinuxAuditLogAdapter` depends on the output format of `first-audit.sh`:

- **Section delimiters**: lines of `━` characters (Unicode box-drawing, U+2501)
- **Section headers**: `[SECTION NAME]` on its own line between two delimiter lines
- **Known sections** (9): SYSTEM IDENTITY, NETWORK CONFIGURATION, USER ACCOUNTS, SSH CONFIGURATION, FIREWALL & SECURITY, INSTALLED PACKAGES, DISK & MEMORY USAGE, RUNNING SERVICES, RECENT ERRORS & LOGS
- **Sub-section markers**: lines starting with `→` (with or without ANSI color wrapping)
- **ANSI codes**: present in logs from Mar 2026 onward (`\x1b[0;32m` etc.), absent in earlier logs. The parser must handle both.
- **Log header**: 3-line box-drawing banner with `SERVER AUDIT REPORT` and UTC timestamp
- **Log footer**: delimiter line + `Audit completed at:` + delimiter line

If `first-audit.sh` changes its output format, collect a fresh log and add it as a new fixture.
