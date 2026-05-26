import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthMarkdown,
  buildDiscoveryUrls,
} from "@/lib/auth-md/discovery";
import { resolvePublicBaseUrl } from "@/lib/auth-md/public-base-url";

export async function GET(request: NextRequest) {
  const urls = buildDiscoveryUrls(resolvePublicBaseUrl(request));
  const body = buildAuthMarkdown(urls);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
