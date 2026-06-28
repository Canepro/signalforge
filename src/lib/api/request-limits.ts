import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const DEFAULT_MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export function resolveMaxArtifactBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIGNALFORGE_MAX_ARTIFACT_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_ARTIFACT_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_ARTIFACT_BYTES;
  }
  return parsed;
}

export function payloadTooLargeResponse(maxBytes = resolveMaxArtifactBytes()) {
  return NextResponse.json(
    {
      error: `Artifact payload exceeds the ${maxBytes} byte limit`,
      code: "payload_too_large",
      max_bytes: maxBytes,
    },
    { status: 413 }
  );
}

export function rejectOversizeContentLength(
  request: NextRequest,
  maxBytes = resolveMaxArtifactBytes()
): NextResponse | null {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const contentLength = Number.parseInt(raw, 10);
  if (!Number.isFinite(contentLength)) return null;
  return contentLength > maxBytes ? payloadTooLargeResponse(maxBytes) : null;
}

export function rejectOversizeFile(
  file: File,
  maxBytes = resolveMaxArtifactBytes()
): NextResponse | null {
  return file.size > maxBytes ? payloadTooLargeResponse(maxBytes) : null;
}

export function rejectOversizeText(
  content: string,
  maxBytes = resolveMaxArtifactBytes()
): NextResponse | null {
  const size = new TextEncoder().encode(content).byteLength;
  return size > maxBytes ? payloadTooLargeResponse(maxBytes) : null;
}
