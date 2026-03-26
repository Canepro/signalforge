"use client";

import { useRef, useState, useEffect, useCallback, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  listArtifactFamilyPresentations,
} from "@/lib/source-catalog";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

export function UploadModal({ open, onClose }: UploadModalProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifactFamilies = listArtifactFamilyPresentations();

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

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_type", "upload");

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
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-surface-container bg-surface-container-lowest p-6 shadow-lg outline-none"
      >
        <div className="flex items-center justify-between">
          <h2
            id="upload-title"
            className="font-headline text-sm font-bold text-on-surface"
          >
            Upload Artifact
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-outline-variant hover:text-on-surface text-lg leading-none p-1 rounded hover:bg-surface-container-high transition-colors"
          >
            &times;
          </button>
        </div>

        <div
          className={`mt-4 flex h-36 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
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
              <svg className="h-8 w-8 text-outline-variant mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="text-xs text-on-surface-variant">
                Drop an artifact file here, or
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-high transition-colors shadow-sm"
              >
                Choose File
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
            if (file) handleFile(file);
          }}
        />

        {error && (
          <div className="mt-3 rounded border border-severity-critical/20 bg-severity-critical-bg px-3 py-2 text-xs text-severity-critical">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Supported artifact families
            </div>
            <div className="mt-2 space-y-2">
              {artifactFamilies.map((family) => (
                <div
                  key={family.value}
                  className="rounded-md border border-outline-variant/15 bg-surface-container-lowest px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-on-surface">{family.label}</div>
                    <code className="text-[10px] text-outline-variant">{family.value}</code>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    {family.uploadShape}
                  </div>
                  <div className="mt-1 text-[10px] leading-snug text-outline-variant">
                    {family.targetIdentifierHint}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] leading-snug text-outline-variant">
            UI upload analyzes the file immediately, but it does not prompt for metadata such as
            <code className="mx-1 text-[10px] font-mono">target_identifier</code>. For stable compare on repeated manual submissions, prefer the CLI or external submit path so you can pass source metadata explicitly.
          </div>
        </div>
      </div>
    </div>
  );
}
