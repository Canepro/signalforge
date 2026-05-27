#!/usr/bin/env python3
"""
Build a recommendation-only handoff for an external agent from SignalForge output.
OpenClaw/Hermes-style operator systems can use this shape when they need
recommendation text without execution rights.

This example keeps the trust boundary explicit:
- SignalForge provides diagnostics and findings
- the external agent provides reasoning and recommendation text
- no execution or remediation rights are implied by this handoff
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
AUTOMATION_CLIENT = SCRIPT_DIR / "automation_agent_client.py"


def load_summary_from_file(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def fetch_summary_from_signalforge(args: argparse.Namespace) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(AUTOMATION_CLIENT),
        "--summary-only",
        "--url",
        args.url,
        "--token",
        args.token,
        "--reason",
        args.reason,
        "--poll-interval",
        str(args.poll_interval),
        "--timeout",
        str(args.timeout),
    ]
    if args.idempotency_key:
        cmd.extend(["--idempotency-key", args.idempotency_key])

    completed = subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def build_recommendation_handoff(summary: dict[str, Any], user_goal: str) -> dict[str, Any]:
    system_prompt = """You are an infrastructure diagnostics recommendation agent.

Use the supplied SignalForge summary as your evidence boundary.
Do not invent facts outside the supplied findings and severity counts.
Do not claim you executed commands or changed infrastructure.
Do not produce remediation steps that assume execution rights.
Recommend the safest next investigative or operator actions first.
Call out uncertainty clearly when the evidence is incomplete."""

    user_prompt = f"""User goal:
{user_goal}

SignalForge summary JSON:
{json.dumps(summary, indent=2)}

Respond with:
1. A short situation summary
2. The most important risks or signals, ordered by urgency
3. A flat list of recommended next actions for a human operator
4. Any assumptions or missing evidence that should be checked before remediation

Important constraints:
- Recommendation only
- No command execution
- No claim of live access to the monitored device
- Stay grounded in the SignalForge evidence"""

    return {
        "policy": {
            "execution_allowed": False,
            "remediation_allowed": False,
            "reasoning_scope": "recommendation_only",
            "evidence_source": "SignalForge automation-agent summary",
        },
        "signalforge_summary": summary,
        "agent_system_prompt": system_prompt,
        "agent_user_prompt": user_prompt,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an external recommendation handoff from SignalForge automation-agent output."
    )
    parser.add_argument(
        "--summary-file",
        default="",
        help="Optional path to a pre-fetched SignalForge summary JSON file",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("SIGNALFORGE_BASE_URL", "http://localhost:3000"),
        help="SignalForge base URL when fetching directly (default: SIGNALFORGE_BASE_URL or http://localhost:3000)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("SIGNALFORGE_AUTOMATION_AGENT_TOKEN", ""),
        help="Automation-agent token when fetching directly (default: SIGNALFORGE_AUTOMATION_AGENT_TOKEN)",
    )
    parser.add_argument(
        "--reason",
        default="Investigate this monitored source and return the current findings.",
        help="Diagnostic request reason used when fetching directly from SignalForge",
    )
    parser.add_argument(
        "--idempotency-key",
        default="",
        help="Optional idempotency key for the SignalForge request",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=2.0,
        help="Polling interval in seconds when fetching directly (default: 2)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=300.0,
        help="Overall fetch timeout in seconds when fetching directly (default: 300)",
    )
    parser.add_argument(
        "--user-goal",
        default="Recommend the next safest operator actions for this monitored source.",
        help="Goal statement inserted into the downstream recommendation prompt",
    )
    parser.add_argument(
        "--prompt-only",
        action="store_true",
        help="Print only the downstream user prompt instead of the full handoff JSON",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.summary_file:
        summary = load_summary_from_file(args.summary_file)
    else:
        if not args.token:
            print(
                "error: provide --summary-file or set --token / SIGNALFORGE_AUTOMATION_AGENT_TOKEN",
                file=sys.stderr,
            )
            return 1
        summary = fetch_summary_from_signalforge(args)

    handoff = build_recommendation_handoff(summary, args.user_goal)
    if args.prompt_only:
        print(handoff["agent_user_prompt"])
    else:
        print(json.dumps(handoff, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
