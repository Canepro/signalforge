"use client";

import { useState } from "react";

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("clipboard_unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

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
