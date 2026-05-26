import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationServerMetadata,
  buildDiscoveryUrls,
} from "@/lib/auth-md/discovery";
import { resolvePublicBaseUrl } from "@/lib/auth-md/public-base-url";

export async function GET(request: NextRequest) {
  const urls = buildDiscoveryUrls(resolvePublicBaseUrl(request));
  return NextResponse.json(buildAuthorizationServerMetadata(urls), {
    status: 200,
    headers: { "cache-control": "public, max-age=300" },
  });
}
