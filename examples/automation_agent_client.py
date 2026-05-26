#!/usr/bin/env python3
"""
Minimal example automation-agent client for SignalForge.

This is intended as a copy-and-adapt starting point for external AI agents such as
Codex- or OpenClaw-style automation clients. It uses only the Python standard
library and the published automation-agent HTTP routes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


TERMINAL_STATUSES = {"submitted", "failed", "cancelled", "expired"}


class SignalForgeClient:
    def __init__(self, base_url: str, automation_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.automation_token = automation_token

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None
        headers = {
            "Authorization": f"Bearer {self.automation_token}",
        }
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"SignalForge HTTP {exc.code}: {raw}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"SignalForge request failed: {exc}") from exc

    def request_diagnostics(self, request_reason: str | None = None, idempotency_key: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if request_reason:
            payload["request_reason"] = request_reason
        if idempotency_key:
            payload["idempotency_key"] = idempotency_key
        return self._request("POST", "/api/automation-agent/diagnostic-requests", payload)

    def get_request(self, request_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/automation-agent/diagnostic-requests/{request_id}")

    def wait_for_result(
        self,
        request_id: str,
        poll_interval_seconds: float = 2.0,
        timeout_seconds: float = 300.0,
    ) -> dict[str, Any]:
        deadline = time.time() + timeout_seconds
        while True:
            result = self.get_request(request_id)
            status = (result.get("request") or {}).get("status")
            if status in TERMINAL_STATUSES:
                return result
            if time.time() >= deadline:
                raise TimeoutError(f"Timed out waiting for request {request_id}")
            time.sleep(poll_interval_seconds)


def build_agent_summary(result: dict[str, Any]) -> dict[str, Any]:
    request = result.get("request") or {}
    findings_result = result.get("result") or {}
    findings = findings_result.get("findings") or []
    top_actions = findings_result.get("top_actions_now") or []

    return {
        "request_id": request.get("id"),
        "status": request.get("status"),
        "run_id": findings_result.get("run_id"),
        "artifact_type": findings_result.get("artifact_type"),
        "target_identifier": findings_result.get("target_identifier"),
        "severity_counts": findings_result.get("severity_counts"),
        "top_action": top_actions[0] if top_actions else None,
        "finding_titles": [finding.get("title") for finding in findings[:5]],
        "compare_api": ((findings_result.get("links") or {}).get("compare_api")),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Example SignalForge automation-agent client for Codex/OpenClaw-style agents."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("SIGNALFORGE_BASE_URL", "http://localhost:3000"),
        help="SignalForge base URL (default: SIGNALFORGE_BASE_URL or http://localhost:3000)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("SIGNALFORGE_AUTOMATION_AGENT_TOKEN", ""),
        help="Automation-agent bearer token (default: SIGNALFORGE_AUTOMATION_AGENT_TOKEN)",
    )
    parser.add_argument(
        "--reason",
        default="Investigate this monitored source and return the current findings.",
        help="Optional diagnostic request reason",
    )
    parser.add_argument(
        "--idempotency-key",
        default="",
        help="Optional idempotency key for request replay safety",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=2.0,
        help="Polling interval in seconds (default: 2)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=300.0,
        help="Overall wait timeout in seconds (default: 300)",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print a reduced agent-friendly summary instead of the full response JSON",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.token:
        print(
            "error: provide --token or set SIGNALFORGE_AUTOMATION_AGENT_TOKEN",
            file=sys.stderr,
        )
        return 1

    client = SignalForgeClient(args.url, args.token)
    request = client.request_diagnostics(
        request_reason=args.reason,
        idempotency_key=args.idempotency_key or None,
    )
    request_id = request.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        print("error: SignalForge response did not include request_id", file=sys.stderr)
        print(json.dumps(request, indent=2), file=sys.stderr)
        return 1

    print(f"queued diagnostic request {request_id}", file=sys.stderr)
    final = client.wait_for_result(
        request_id=request_id,
        poll_interval_seconds=args.poll_interval,
        timeout_seconds=args.timeout,
    )

    output: dict[str, Any]
    if args.summary_only:
        output = build_agent_summary(final)
    else:
        output = final

    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
