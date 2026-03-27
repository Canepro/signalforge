"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getArtifactFamilyPresentation,
  listArtifactFamilyPresentations,
} from "@/lib/source-catalog";
import { ModalShell } from "./modal-shell";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

export function UploadModal({ open, onClose }: UploadModalProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [artifactType, setArtifactType] = useState("");
  const [targetIdentifier, setTargetIdentifier] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const artifactFamilies = listArtifactFamilyPresentations();
  const selectedFamily = getArtifactFamilyPresentation(artifactType);

  useEffect(() => {
    if (!open) {
      setDragging(false);
      setUploading(false);
      setError(null);
      setAdvancedOpen(true);
      setArtifactType("");
      setTargetIdentifier("");
      setSourceLabel("");
    }
  }, [open]);

  if (!open) return null;

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_type", "upload");
      if (artifactType) formData.append("artifact_type", artifactType);
      if (targetIdentifier.trim()) formData.append("target_identifier", targetIdentifier.trim());
      if (sourceLabel.trim()) formData.append("source_label", sourceLabel.trim());

      const res = await fetch("/api/runs", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `Upload failed (${res.status})`
        );
      }
      const data = (await res.json()) as { run_id: string };
      onClose();
      router.push(`/runs/${data.run_id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <ModalShell open={open} onClose={onClose} titleId="upload-title" maxWidthClassName="max-w-2xl">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2
            id="upload-title"
            className="font-headline text-xl font-bold tracking-tight text-on-surface"
          >
            Upload Artifact
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="sf-btn-icon h-10 w-10 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Upload a compatible artifact directly into SignalForge. For one-off checks, inference is often
          enough. For stable compare, add source metadata so repeated submissions line up to the same logical target.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
          <div className="space-y-4">
            <div
              className={`flex h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-outline-variant/50 bg-surface-container-low"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {uploading ? (
                <div className="text-sm text-on-surface-variant">
                  Analyzing artifact...
                </div>
              ) : (
                <>
                  <svg className="mb-3 h-9 w-9 text-outline-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <div className="text-sm font-medium text-on-surface">
                    Drop an artifact file here
                  </div>
                  <div className="mt-1 text-sm text-on-surface-variant">
                    Accepts `.log`, `.txt`, and `.json` files
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="sf-btn-secondary mt-4 px-3.5 py-2"
                  >
                    Choose file
                  </button>
                </>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".log,.txt,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleFile(file);
              }}
            />

            {error ? (
              <div className="rounded-lg border border-severity-critical/20 bg-severity-critical-bg px-3 py-2 text-sm text-severity-critical">
                {error}
              </div>
            ) : null}

            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low">
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={advancedOpen}
              >
                <div>
                  <div className="text-base font-semibold text-on-surface">Target and compare metadata</div>
                  <div className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                    Recommended for repeat uploads. Stable identity here makes compare and drift far more useful.
                  </div>
                </div>
                <svg
                  className={`h-4 w-4 shrink-0 text-on-surface-variant transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {advancedOpen ? (
                <div className="grid gap-4 border-t border-outline-variant/15 px-4 py-4">
                  <label className="block">
                    <span className="sf-field-label">Artifact family</span>
                    <select
                      value={artifactType}
                      onChange={(event) => setArtifactType(event.target.value)}
                      className="sf-field"
                    >
                      <option value="">Infer from content</option>
                      {artifactFamilies.map((family) => (
                        <option key={family.value} value={family.value}>
                          {family.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="sf-field-label">Target identifier</span>
                    <input
                      value={targetIdentifier}
                      onChange={(event) => setTargetIdentifier(event.target.value)}
                      placeholder={selectedFamily?.targetIdentifierExample ?? "e.g. host:prod-web-01"}
                      className="sf-field font-mono"
                    />
                  </label>

                  <label className="block">
                    <span className="sf-field-label">Source label</span>
                    <input
                      value={sourceLabel}
                      onChange={(event) => setSourceLabel(event.target.value)}
                      placeholder="e.g. laptop, CI runner, jump host"
                      className="sf-field"
                    />
                  </label>

                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-3 py-3 text-sm leading-relaxed text-on-surface-variant">
                    {selectedFamily ? (
                      <>
                        <div className="font-semibold text-on-surface">{selectedFamily.label}</div>
                        <div className="mt-1">{selectedFamily.targetIdentifierHint}</div>
                        <div className="mt-2 font-mono text-xs text-outline-variant">
                          Example: {selectedFamily.targetIdentifierExample}
                        </div>
                      </>
                    ) : (
                      <>
                        Leave artifact family on inference for quick uploads, or choose one when the file shape is ambiguous.
                        Use a stable <code className="mx-1 font-mono text-[11px]">target_identifier</code> if you want compare to follow the same host, container workload, or Kubernetes scope over time.
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
            <div className="text-sm font-semibold text-on-surface-variant">
              Supported artifact families
            </div>
            <div className="space-y-2">
              {artifactFamilies.map((family) => {
                const isSelected = family.value === artifactType;
                return (
                  <div
                    key={family.value}
                    className={`rounded-lg border px-3 py-3 ${
                      isSelected
                        ? "border-primary/35 bg-primary/[0.06]"
                        : "border-outline-variant/15 bg-surface-container-lowest"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-on-surface">{family.label}</div>
                      <code className="text-xs text-outline-variant">{family.value}</code>
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                      {family.description}
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-outline-variant">
                      {family.uploadShape}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-3 py-3 text-sm leading-relaxed text-on-surface-variant">
              For richer metadata such as collector type, collector version, and collected timestamp, the CLI and external submit path remain the best fit.
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
