"use client";

export async function writeClipboard(text: string): Promise<void> {
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

  try {
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    if (!copied) {
      throw new Error("clipboard_copy_failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyWithPromptFallback(
  text: string,
  promptMessage = "Copy text:"
): Promise<"clipboard" | "prompt"> {
  try {
    await writeClipboard(text);
    return "clipboard";
  } catch {
    if (typeof window !== "undefined" && typeof window.prompt === "function") {
      window.prompt(promptMessage, text);
      return "prompt";
    }
    throw new Error("clipboard_unavailable");
  }
}
