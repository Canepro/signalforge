import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "@/lib/db/client";
import {
  insertSource,
  listSources,
  sourceToJson,
  type SourceType,
} from "@/lib/db/source-job-repository";
import { requireAdminBearer } from "@/lib/api/admin-auth";

function isSourceType(v: string): v is SourceType {
  return v === "linux_host" || v === "wsl";
}

export async function GET(request: NextRequest) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const enabled = searchParams.get("enabled");
    const rows =
      enabled === "true" ?
        listSources(db, { enabled: true })
      : enabled === "false" ?
        listSources(db, { enabled: false })
      : listSources(db);

    return NextResponse.json({ sources: rows.map(sourceToJson) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdminBearer(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const display_name =
      typeof body.display_name === "string" ? body.display_name : "";
    const target_identifier =
      typeof body.target_identifier === "string" ? body.target_identifier : "";
    const source_type = typeof body.source_type === "string" ? body.source_type : "";

    if (!display_name.trim() || display_name.length > 256) {
      return NextResponse.json(
        { error: "display_name is required (1–256 chars)", code: "validation_error" },
        { status: 400 }
      );
    }
    if (!target_identifier.trim() || target_identifier.length > 512) {
      return NextResponse.json(
        { error: "target_identifier is required (1–512 chars)", code: "validation_error" },
        { status: 400 }
      );
    }
    if (!isSourceType(source_type)) {
      return NextResponse.json(
        { error: "source_type must be linux_host or wsl", code: "validation_error" },
        { status: 400 }
      );
    }

    const db = await getDb();
    try {
      const row = insertSource(db, {
        display_name,
        target_identifier,
        source_type,
        expected_artifact_type:
          typeof body.expected_artifact_type === "string" ?
            body.expected_artifact_type
          : undefined,
        default_collector_type:
          typeof body.default_collector_type === "string" ?
            body.default_collector_type
          : undefined,
        default_collector_version:
          typeof body.default_collector_version === "string" ?
            body.default_collector_version
          : null,
        capabilities: Array.isArray(body.capabilities) ?
          body.capabilities.filter((x): x is string => typeof x === "string")
        : undefined,
        attributes:
          body.attributes && typeof body.attributes === "object" && body.attributes !== null ?
            (body.attributes as Record<string, unknown>)
          : undefined,
        labels:
          body.labels && typeof body.labels === "object" && body.labels !== null ?
            (Object.fromEntries(
              Object.entries(body.labels as Record<string, unknown>).filter(
                ([k, v]) => typeof k === "string" && typeof v === "string"
              )
            ) as Record<string, string>)
          : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      });
      saveDb();
      return NextResponse.json(sourceToJson(row), { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        return NextResponse.json(
          {
            error: "A source with this target_identifier already exists (enabled)",
            code: "duplicate_target_identifier",
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
