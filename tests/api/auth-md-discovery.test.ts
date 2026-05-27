import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as GET_AUTH_MD } from "@/app/auth.md/route";
import { GET as GET_PRM } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as GET_AS } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as POST_AGENT_AUTH } from "@/app/agent/auth/route";
import { POST as POST_LEGACY_REG } from "@/app/api/agent/registrations/route";
import { POST as POST_SOURCES } from "@/app/api/sources/route";
import * as dbClient from "@/lib/db/client";
import { getTestDb } from "@/lib/db/client";
import type { Database } from "sql.js";

const ADMIN = "auth-md-discovery-admin";
const adminAuth = { authorization: `Bearer ${ADMIN}` };

describe("auth.md discovery routes", () => {
  let db: Database;

  beforeEach(async () => {
    process.env.SIGNALFORGE_ADMIN_TOKEN = ADMIN;
    db = await getTestDb();
    dbClient.setDbOverride(db);
  });

  afterEach(() => {
    dbClient.setDbOverride(null);
    db.close();
    delete process.env.SIGNALFORGE_ADMIN_TOKEN;
    delete process.env.SIGNALFORGE_PUBLIC_BASE_URL;
  });

  it("GET /auth.md returns markdown with discovery pointers", async () => {
    const res = await GET_AUTH_MD(
      new NextRequest("http://localhost:3000/auth.md", {
        headers: { host: "localhost:3000" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("# auth.md");
    expect(body).toContain("/.well-known/oauth-protected-resource");
    expect(body).toContain("POST http://localhost:3000/agent/auth");
    expect(body).toContain("/api/automation-agent/registrations");
    expect(body).toContain("diagnostic_request.create");
    expect(body).toContain("SIGNALFORGE_AUTOMATION_AGENT_TOKEN");
  });

  it("GET /.well-known/oauth-protected-resource returns PRM JSON", async () => {
    const res = await GET_PRM(
      new NextRequest("http://localhost:3000/.well-known/oauth-protected-resource")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource_name).toBe("SignalForge");
    expect(body.scopes_supported).toContain("collection_job.execute");
    expect(body.scopes_supported).toContain("diagnostic_request.create");
    expect(body.scopes_supported).toContain("fix_action.request");
    expect(body.authorization_servers).toEqual(["http://localhost:3000"]);
  });

  it("GET /.well-known/oauth-authorization-server returns agent_auth block", async () => {
    const res = await GET_AS(
      new NextRequest("http://localhost:3000/.well-known/oauth-authorization-server")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent_auth.register_uri).toBe("http://localhost:3000/agent/auth");
    expect(body.agent_auth.compatibility.legacy_register_uri).toBe(
      "http://localhost:3000/api/agent/registrations"
    );
    expect(body.agent_auth.compatibility.claim_implemented).toBe(false);
  });

  it("respects SIGNALFORGE_PUBLIC_BASE_URL for absolute discovery URLs", async () => {
    process.env.SIGNALFORGE_PUBLIC_BASE_URL = "https://signalforge.example.test";
    const res = await GET_AS(
      new NextRequest("http://localhost:3000/.well-known/oauth-authorization-server")
    );
    const body = await res.json();
    expect(body.agent_auth.register_uri).toBe("https://signalforge.example.test/agent/auth");
  });

  it("POST /agent/auth mirrors legacy registration and adds scopes metadata", async () => {
    const sourceRes = await POST_SOURCES(
      new NextRequest("http://localhost/api/sources", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Auth MD Host",
          target_identifier: "auth-md-host-1",
          source_type: "linux_host",
        }),
      })
    );
    expect(sourceRes.status).toBe(201);
    const { id: sourceId } = await sourceRes.json();

    const res = await POST_AGENT_AUTH(
      new NextRequest("http://localhost/agent/auth", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, display_name: "edge-agent" }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token_prefix).toBe(body.token.slice(0, 8));
    expect(body.scopes).toContain("collection_job.poll");
    expect(body.rotation_guidance).toContain("once");

    const dup = await POST_AGENT_AUTH(
      new NextRequest("http://localhost/agent/auth", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(dup.status).toBe(409);

    const legacyDup = await POST_LEGACY_REG(
      new NextRequest("http://localhost/api/agent/registrations", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      })
    );
    expect(legacyDup.status).toBe(409);
  });

  it("POST /agent/auth requires admin Bearer", async () => {
    const res = await POST_AGENT_AUTH(
      new NextRequest("http://localhost/agent/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_id: "missing" }),
      })
    );
    expect(res.status).toBe(401);
  });
});
