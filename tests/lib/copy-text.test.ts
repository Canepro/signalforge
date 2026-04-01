import { afterEach, describe, expect, it, vi } from "vitest";
import { copyWithPromptFallback, writeClipboard } from "@/lib/copy-text";

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

function setGlobalValue<K extends "navigator" | "document" | "window">(
  key: K,
  value: typeof globalThis[K] | undefined
) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setGlobalValue("navigator", originalNavigator);
  setGlobalValue("document", originalDocument);
  setGlobalValue("window", originalWindow);
  vi.restoreAllMocks();
});

describe("copy-text", () => {
  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setGlobalValue("navigator", {
      clipboard: { writeText },
    } as unknown as Navigator);

    await writeClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("throws when the legacy execCommand fallback reports failure", async () => {
    const select = vi.fn();
    const textarea = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select,
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    setGlobalValue("navigator", undefined);
    setGlobalValue("document", {
      createElement: vi.fn(() => textarea),
      body: { appendChild, removeChild },
      execCommand: vi.fn(() => false),
    } as unknown as Document);

    await expect(writeClipboard("hello")).rejects.toThrow("clipboard_copy_failed");
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(select).toHaveBeenCalled();
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });

  it("falls back to prompt when clipboard copy is unavailable", async () => {
    const prompt = vi.fn();
    setGlobalValue("navigator", undefined);
    setGlobalValue("document", undefined);
    setGlobalValue("window", {
      prompt,
    } as unknown as Window & typeof globalThis);

    const result = await copyWithPromptFallback("hello", "Copy findings:");

    expect(result).toBe("prompt");
    expect(prompt).toHaveBeenCalledWith("Copy findings:", "hello");
  });
});
