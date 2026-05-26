import { NextRequest, NextResponse } from "next/server";
import {
  buildDiscoveryUrls,
  buildProtectedResourceMetadata,
} from "@/lib/auth-md/discovery";
import { resolvePublicBaseUrl } from "@/lib/auth-md/public-base-url";

export async function GET(request: NextRequest) {
  const urls = buildDiscoveryUrls(resolvePublicBaseUrl(request));
  return NextResponse.json(buildProtectedResourceMetadata(urls), {
    status: 200,
    headers: { "cache-control": "public, max-age=300" },
  });
}
