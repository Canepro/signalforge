"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface CollectEvidenceModalProps {
  open: boolean;
  onClose: () => void;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-outline-variant">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed font-mono bg-surface-container-low p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all border border-outline-variant/20 text-on-surface">
        {text}
      </pre>
    </div>
  );
}

export function CollectEvidenceModal({ open, onClose }: CollectEvidenceModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState("http://localhost:3000");

  useEffect(() => {
    if (open && typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, [open]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleEscape);
      prev?.focus();
    };
  }, [open, handleEscape]);

  if (!open) return null;

  const agentOnce = [
    `export SIGNALFORGE_URL=${origin}`,
    `export SIGNALFORGE_AGENT_TOKEN='<token from enrollment>'`,
    `export SIGNALFORGE_AGENT_INSTANCE_ID="$(hostname)-agent-1"`,
    `export SIGNALFORGE_COLLECTORS_DIR=/path/to/signalforge-collectors`,
    ``,
    `bun run src/cli.ts once`,
  ].join("\n");

  const cliSubmit = `SIGNALFORGE_URL=${origin} ./scripts/analyze.sh /path/to/your-audit.log`;

  const collectorPush = [
    `cd /path/to/signalforge-collectors`,
    `SIGNALFORGE_URL=${origin} ./submit-to-signalforge.sh --file examples/sample_audit.log`,
  ].join("\n");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collect-evidence-title"
        className="w-full max-w-lg mx-4 rounded-xl bg-surface-container-lowest shadow-xl border border-outline-variant/30 outline-none max-h-[90vh] overflow-y-auto"
      >
        <div className="px-5 pt-5 pb-4 border-b border-surface-container flex items-start justify-between gap-3">
          <div>
            <h2 id="collect-evidence-title" className="font-headline text-lg font-bold text-on-surface">
              Collect evidence
            </h2>
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
              SignalForge analyzes evidence; collection runs outside the app.
              Use the <strong>job-driven</strong> path (Sources + agent) or <strong>push</strong> directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Job-driven path — lead with this */}
          <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary">Recommended: job-driven collection</h3>
            <ol className="text-[11px] text-on-surface-variant leading-relaxed space-y-1 list-decimal list-inside">
              <li>
                Open{" "}
                <Link href="/sources" onClick={onClose} className="font-semibold text-primary hover:underline">
                  Sources
                </Link>{" "}
                and register a target
              </li>
              <li>Enroll an agent (one token per source)</li>
              <li>Click <strong>Collect Fresh Evidence</strong> to create a queued job</li>
              <li>
                Run <code className="text-[10px] bg-surface-container px-1 py-0.5 rounded">signalforge-agent once</code>{" "}
                on the host — it claims, collects, and uploads automatically
              </li>
            </ol>
          </div>

          <CopyBlock label="Agent one-shot (from signalforge-agent checkout)" text={agentOnce} />

          <div className="border-t border-outline-variant/20 pt-4 space-y-1">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Alternative: direct push</h3>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              If you already have an audit log and don&apos;t need job tracking, push it directly.
              Use <span className="font-semibold text-on-surface">--target-id</span> so compare can match runs to the same host.
            </p>
          </div>

          <CopyBlock label="Submit from this repo (CLI)" text={cliSubmit} />

          <CopyBlock label="Reference push (from signalforge-collectors checkout)" text={collectorPush} />

          <p className="text-[10px] text-outline-variant leading-snug">
            Docs: <span className="font-mono">docs/external-submit.md</span>,{" "}
            <span className="font-mono">docs/getting-started.md</span>
          </p>
        </div>
      </div>
    </div>
  );
}
