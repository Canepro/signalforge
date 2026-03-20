# SignalForge

**Infrastructure Diagnostics** — evidence-to-findings analysis for audit logs and beyond.

SignalForge ingests evidence artifacts from infrastructure systems, normalizes them through type-specific adapters, runs deterministic classification and model-assisted explanation, and produces structured finding reports.

## Status

Phase 1a complete. Analyzer core with deterministic pipeline, LLM explanation, and fixture-driven tests.

## Quick start

```bash
bun install
```

### Run against an audit log

```bash
bun run analyze path/to/server_audit.log
```

Without `OPENAI_API_KEY` set, produces a deterministic fallback report. With a key, adds model-assisted explanations and prioritization.

### Run tests

```bash
bun test
```

## Architecture

```
Artifact in → Adapter → Deterministic pipeline → LLM explanation → Structured report
```

- **Adapter**: type-specific parser (currently: `linux-audit-log` for `first-audit.sh` output)
- **Deterministic pipeline**: ANSI stripping, section parsing, environment detection, noise classification, pre-finding extraction, incomplete detection
- **LLM explanation**: single OpenAI Responses API call for `why_it_matters`, `recommended_action`, summary, and top 3 actions
- **Fallback**: if LLM is unavailable, returns deterministic results with placeholder explanations

## Fixture logs

Test fixtures in `tests/fixtures/` are copied from [server-audit-kit](https://github.com/Canepro/server-audit-kit). See `tests/fixtures/README.md` for provenance and parser contract.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | For LLM | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-5-mini` | Model to use for explanation |

## License

MIT
