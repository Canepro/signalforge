"use client";

import { useState } from "react";
import { writeClipboard } from "@/lib/copy-text";

export function CopyTextButton({
  value,
  idleLabel = "Copy",
  doneLabel = "Copied",
  className = "",
}: {
  value: string;
  idleLabel?: string;
  doneLabel?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleClick() {
    try {
      await writeClipboard(value);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("error");
      window.setTimeout(() => setState("idle"), 2000);
    }
  }

  const label =
    state === "copied" ? doneLabel
    : state === "error" ? "Copy failed"
    : idleLabel;

  return (
    <button type="button" onClick={handleClick} className={className}>
      {label}
    </button>
  );
}
