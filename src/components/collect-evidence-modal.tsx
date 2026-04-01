"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COLLECTION_STACK_ROLES,
  listArtifactFamilyPresentations,
} from "@/lib/source-catalog";
import { writeClipboard } from "@/lib/copy-text";
import { ModalShell } from "./modal-shell";

interface CollectEvidenceModalProps {
  open: boolean;
  onClose: () => void;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const copy = useCallback(async () => {
    try {
      await writeClipboard(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      window.setTimeout(() => setState("idle"), 2000);
    }
  }, [text]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline-variant">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
        >
          {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-outline-variant/20 bg-surface-container-low p-3 font-mono text-xs leading-relaxed text-on-surface">
        {text}
      </pre>
    </div>
  );
}

export function CollectEvidenceModal({ open, onClose }: CollectEvidenceModalProps) {
  const [origin, setOrigin] = useState("http://localhost:3000");
  const artifactFamilies = listArtifactFamilyPresentations();

  useEffect(() => {
    if (open && typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, [open]);

  if (!open) return null;

  const agentEnvFile = [
    `SIGNALFORGE_URL=${origin}`,
    `SIGNALFORGE_AGENT_TOKEN=<token from enrollment or reissue>`,
    `SIGNALFORGE_AGENT_INSTANCE_ID=$(hostname)-agent-1`,
    `SIGNALFORGE_COLLECTORS_DIR=/path/to/signalforge-collectors`,
    `# Optional: narrow capabilities explicitly instead of relying on auto-detection`,
    `# SIGNALFORGE_AGENT_CAPABILITIES=collect:linux-audit-log,upload:multipart`,
    `# Preferred: set target scope in SignalForge source defaults or per-job request fields`,
    `# Legacy fallback only when collector-side job scope mapping is not available yet:`,
    `# SIGNALFORGE_CONTAINER_REF=payments-api`,
    `# SIGNALFORGE_KUBERNETES_SCOPE=namespace`,
    `# SIGNALFORGE_KUBERNETES_NAMESPACE=payments`,
    `SIGNALFORGE_POLL_INTERVAL_MS=30000`,
    `SIGNALFORGE_JOBS_WAIT_SECONDS=20`,
  ].join("\n");

  const agentServiceSetup = [
    `cd /path/to/signalforge-agent`,
    `git pull origin main`,
    `bun install`,
    ``,
    `cp contrib/systemd/signalforge-agent.env.example contrib/systemd/signalforge-agent.env`,
    `# edit contrib/systemd/signalforge-agent.env`,
    `sudo ./scripts/install-systemd-service.sh`,
  ].join("\n");

  const agentServiceCheck = [`systemctl status signalforge-agent`, `journalctl -u signalforge-agent -f`].join("\n");

  const agentRun = [
    `export SIGNALFORGE_URL=${origin}`,
    `export SIGNALFORGE_AGENT_TOKEN='<token from enrollment>'`,
    `export SIGNALFORGE_AGENT_INSTANCE_ID="$(hostname)-agent-1"`,
    `export SIGNALFORGE_COLLECTORS_DIR=/path/to/signalforge-collectors`,
    ``,
    `bun run src/cli.ts run`,
  ].join("\n");

  const agentOnce = [
    `export SIGNALFORGE_URL=${origin}`,
    `export SIGNALFORGE_AGENT_TOKEN='<token from enrollment>'`,
    `export SIGNALFORGE_AGENT_INSTANCE_ID="$(hostname)-agent-1"`,
    `export SIGNALFORGE_COLLECTORS_DIR=/path/to/signalforge-collectors`,
    ``,
    `bun run src/cli.ts once`,
  ].join("\n");

  const cliSubmit = `SIGNALFORGE_URL=${origin} ./scripts/analyze.sh /path/to/your-artifact.log`;

  const collectorPushLinux = [
    `cd /path/to/signalforge-collectors`,
    `SIGNALFORGE_URL=${origin} ./submit-to-signalforge.sh --file examples/sample_audit.log`,
  ].join("\n");

  const collectorPushContainer = [
    `cd /path/to/signalforge-collectors`,
    `./collect-container-diagnostics.sh --runtime podman --container payments-api --output ./payments-container.txt`,
    `SIGNALFORGE_URL=${origin} ./submit-to-signalforge.sh --file ./payments-container.txt --artifact-type container-diagnostics --target-id 'container-workload:host-a:podman:payments-api' --source-label 'signalforge-collectors:collect-container-diagnostics.sh'`,
  ].join("\n");

  const collectorPushKubernetes = [
    `cd /path/to/signalforge-collectors`,
    `./collect-kubernetes-bundle.sh --namespace payments --output ./payments-bundle.json`,
    `SIGNALFORGE_URL=${origin} ./submit-to-signalforge.sh --file ./payments-bundle.json --artifact-type kubernetes-bundle --target-id 'cluster:prod-eu-1:namespace:payments' --source-label 'signalforge-collectors:collect-kubernetes-bundle.sh'`,
  ].join("\n");

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId="collect-evidence-title"
      maxWidthClassName="max-w-3xl"
    >
        <div className="px-5 pt-5 pb-4 border-b border-surface-container flex items-start justify-between gap-3">
          <div>
            <h2 id="collect-evidence-title" className="font-headline text-xl font-bold tracking-tight text-on-surface">
              Collect evidence
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
              SignalForge analyzes evidence, but collection runs outside the app. Use a <strong>push-first</strong> path when you already have an artifact, or a <strong>job-driven</strong> path when you want a running agent to poll and collect on demand.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sf-btn-icon h-10 w-10 shrink-0"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              How the repos fit together
            </h3>
            <div className="space-y-2">
              {COLLECTION_STACK_ROLES.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-md border border-outline-variant/15 bg-surface-container-lowest px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-[10px] font-mono text-on-surface">{entry.label}</code>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      {entry.role}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    {entry.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Supported artifact families
            </h3>
            <div className="space-y-2">
              {artifactFamilies.map((family) => (
                <div
                  key={family.value}
                  className="rounded-md border border-outline-variant/15 bg-surface-container-lowest px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-on-surface">{family.label}</div>
                    <code className="text-[10px] text-outline-variant">{family.value}</code>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    {family.description}
                  </p>
                  <div className="mt-2 space-y-1 text-[11px] leading-snug text-outline-variant">
                    <div>Upload shape: {family.uploadShape}</div>
                    <div>Compare hint: {family.targetIdentifierHint}</div>
                    <div>Target id example: <code className="font-mono">{family.targetIdentifierExample}</code></div>
                    <div>Normal path: {family.recommendedCollection}</div>
                    <div>Job-driven status: {family.jobDrivenStatus}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Job-driven path — lead with this */}
          <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              Recommended: installed agent service
            </h3>
            <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed text-on-surface-variant">
              <li>
                Open{" "}
                <Link href="/sources" onClick={onClose} className="font-semibold text-primary hover:underline">
                  Sources
                </Link>{" "}
                and register a target
              </li>
              <li>Enroll an agent and copy the one-time token</li>
              <li>
                Install <code className="text-[10px] bg-surface-container px-1 py-0.5 rounded">signalforge-agent</code>{" "}
                as a background service on the source host
              </li>
              <li>
                Request collection from the UI. The running agent heartbeats, long-polls for work, and claims queued jobs automatically.
              </li>
            </ol>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              This is the normal operator setup.{" "}
              <span className="font-semibold text-on-surface">run</span> stays alive in the background;{" "}
              <span className="font-semibold text-on-surface">once</span> is only for smoke tests, debugging, or cron-style schedules.
            </p>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Linux host sources are the cleanest fit for this model. Container and Kubernetes sources should now prefer typed source defaults and per-job scope in SignalForge. Host-local target env remains a fallback until the agent and collectors finish the Phase 9 scope mapping.
            </p>
          </div>

          <CopyBlock label="Agent env file" text={agentEnvFile} />

          <CopyBlock label="Install agent service (recommended)" text={agentServiceSetup} />

          <CopyBlock label="Check service status" text={agentServiceCheck} />

          <div className="border-t border-outline-variant/20 pt-4 space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Fallback: manual agent commands
            </h3>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Use these only when you are testing or debugging agent behavior directly from a shell. They are not the preferred long-running production setup, and shell-exported tokens should not be your durable secret-handling path.
            </p>
          </div>

          <CopyBlock label="Agent continuous mode (manual)" text={agentRun} />

          <CopyBlock label="Agent one-shot (debug or cron)" text={agentOnce} />

          <div className="border-t border-outline-variant/20 pt-4 space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Alternative: direct push</h3>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              If you already have a compatible diagnostic artifact and don&apos;t need job tracking, push it directly.
              This is the most flexible path for container and Kubernetes because you can choose target scope explicitly.
            </p>
          </div>

          <CopyBlock label="Submit from this repo (CLI)" text={cliSubmit} />

          <CopyBlock label="Reference push: Linux audit" text={collectorPushLinux} />

          <CopyBlock label="Reference push: container diagnostics" text={collectorPushContainer} />

          <CopyBlock label="Reference push: Kubernetes bundle" text={collectorPushKubernetes} />

          <p className="text-xs leading-snug text-outline-variant">
            Docs: <span className="font-mono">docs/external-submit.md</span>,{" "}
            <span className="font-mono">docs/getting-started.md</span>,{" "}
            <span className="font-mono">docs/agent-deployment.md</span>
          </p>
        </div>
    </ModalShell>
  );
}
