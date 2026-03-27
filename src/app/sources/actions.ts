"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ADMIN_SESSION_COOKIE,
  getAdminTokenFromEnv,
  hashAdminSessionCookie,
  verifyAdminSessionCookie,
} from "@/lib/api/admin-auth";
import {
  isCatalogArtifactType,
  isSourceType,
  type ArtifactType,
  type SourceType,
} from "@/lib/source-catalog";
import { getStorage } from "@/lib/storage";
import { parseCollectionScopeFormData } from "./collection-scope-form";

async function assertAdminSession(): Promise<void> {
  const jar = await cookies();
  const v = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionCookie(v))) {
    redirect("/sources/login");
  }
}

async function hasAdminSession(): Promise<boolean> {
  const jar = await cookies();
  const v = jar.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSessionCookie(v);
}

export async function loginAdminAction(formData: FormData): Promise<void> {
  const env = getAdminTokenFromEnv();
  if (!env) {
    redirect("/sources/login?unconfigured=1");
  }
  const token = formData.get("token");
  if (typeof token !== "string" || token !== env) {
    redirect("/sources/login?error=1");
  }
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, await hashAdminSessionCookie(env), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/sources");
}

export async function logoutAdminAction(_formData?: FormData): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_SESSION_COOKIE);
  redirect("/sources/login");
}

export async function createSourceAction(formData: FormData): Promise<void> {
  await assertAdminSession();
  const display_name = String(formData.get("display_name") ?? "").trim();
  const target_identifier = String(formData.get("target_identifier") ?? "").trim();
  const source_type = String(formData.get("source_type") ?? "").trim();
  const expected_artifact_type = String(formData.get("expected_artifact_type") ?? "").trim();

  if (!display_name || !target_identifier || !source_type || !expected_artifact_type) {
    redirect("/sources/new?error=missing");
  }
  if (!isSourceType(source_type)) {
    redirect("/sources/new?error=type");
  }
  if (!isCatalogArtifactType(expected_artifact_type)) {
    redirect("/sources/new?error=artifact_type");
  }

  const defaultCollectionScope = parseCollectionScopeFormData(formData, {
    prefix: "default_collection_scope",
    artifactType: expected_artifact_type as ArtifactType,
    errorCode: "invalid_default_collection_scope",
  });
  if (!defaultCollectionScope.ok) {
    redirect("/sources/new?error=invalid_default_collection_scope");
  }

  const storage = await getStorage();
  try {
    const row = await storage.withTransaction((tx) =>
      tx.sources.create({
        display_name,
        target_identifier,
        source_type: source_type as SourceType,
        expected_artifact_type: expected_artifact_type as ArtifactType,
        default_collection_scope: defaultCollectionScope.value,
      })
    );
    revalidatePath("/sources");
    redirect(`/sources/${row.id}`);
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "invalid_default_collection_scope") {
      redirect("/sources/new?error=invalid_default_collection_scope");
    }
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      redirect("/sources/new?error=duplicate");
    }
    throw e;
  }
}

export async function createCollectionJobAction(formData: FormData): Promise<void> {
  await assertAdminSession();
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) redirect("/sources");

  const storage = await getStorage();
  const source = await storage.sources.getById(sourceId);
  if (!source) redirect("/sources");

  const request_reason = String(formData.get("request_reason") ?? "").trim() || null;
  const idemRaw = formData.get("idempotency_key");
  const idempotency_key =
    typeof idemRaw === "string" && idemRaw.trim() ? idemRaw.trim() : null;
  const collectionScope = parseCollectionScopeFormData(formData, {
    prefix: "collection_scope",
    artifactType: source.expected_artifact_type as ArtifactType,
    errorCode: "invalid_collection_scope",
  });
  if (!collectionScope.ok) {
    redirect(`/sources/${sourceId}?error=invalid_collection_scope`);
  }

  try {
    const { row } = await storage.withTransaction((tx) =>
      tx.jobs.queueForSource(sourceId, {
        request_reason,
        idempotency_key,
        collection_scope: collectionScope.value,
      })
    );
    revalidatePath(`/sources/${sourceId}`);
    redirect(`/sources/${sourceId}?job=${row.id}`);
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "source_disabled") {
      redirect(`/sources/${sourceId}?error=disabled`);
    }
    if (code === "invalid_collection_scope") {
      redirect(`/sources/${sourceId}?error=invalid_collection_scope`);
    }
    throw e;
  }
}

export async function cancelCollectionJobAction(formData: FormData): Promise<void> {
  await assertAdminSession();
  const jobId = String(formData.get("job_id") ?? "");
  const sourceId = String(formData.get("source_id") ?? "");
  if (!jobId || !sourceId) redirect("/sources");

  const storage = await getStorage();
  try {
    await storage.withTransaction((tx) => tx.jobs.cancel(jobId));
    revalidatePath(`/sources/${sourceId}`);
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "cannot_cancel_running" || code === "already_terminal") {
      redirect(`/sources/${sourceId}?cancel_error=${code}`);
    }
    throw e;
  }
  redirect(`/sources/${sourceId}`);
}

export type DashboardRequestCollectionState =
  | {
      ok: false;
      error:
        | "admin_required"
        | "missing_source"
        | "not_found"
        | "disabled"
        | "not_ready"
        | "invalid_collection_scope";
    }
  | { ok: true; job_id: string; source_id: string; source_name: string };

export async function requestCollectionFromDashboardAction(
  formData: FormData
): Promise<DashboardRequestCollectionState> {
  if (!(await hasAdminSession())) {
    return { ok: false, error: "admin_required" };
  }

  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) return { ok: false, error: "missing_source" };

  const storage = await getStorage();
  const source = await storage.sources.getById(sourceId);
  if (!source) return { ok: false, error: "not_found" };
  if (!source.enabled) return { ok: false, error: "disabled" };
  if (source.health_status !== "online") return { ok: false, error: "not_ready" };

  const registration = await storage.agents.getRegistrationBySourceId(sourceId);
  if (!registration) return { ok: false, error: "not_ready" };

  const request_reason = String(formData.get("request_reason") ?? "").trim() || null;
  const collectionScope = parseCollectionScopeFormData(formData, {
    prefix: "collection_scope",
    artifactType: source.expected_artifact_type as ArtifactType,
    errorCode: "invalid_collection_scope",
  });
  if (!collectionScope.ok) {
    return { ok: false, error: "invalid_collection_scope" };
  }
  try {
    const { row } = await storage.withTransaction((tx) =>
      tx.jobs.queueForSource(sourceId, {
        request_reason,
        collection_scope: collectionScope.value,
      })
    );
    revalidatePath("/");
    revalidatePath("/sources");
    revalidatePath(`/sources/${sourceId}`);
    return {
      ok: true,
      job_id: row.id,
      source_id: sourceId,
      source_name: source.display_name,
    };
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "source_disabled") {
      return { ok: false, error: "disabled" };
    }
    if (code === "invalid_collection_scope") {
      return { ok: false, error: "invalid_collection_scope" };
    }
    throw e;
  }
}

export async function updateSourceAction(formData: FormData): Promise<void> {
  await assertAdminSession();
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) redirect("/sources");

  const storage = await getStorage();
  const source = await storage.sources.getById(sourceId);
  if (!source) redirect("/sources");

  const display_name = formData.get("display_name");
  const enabledValues = formData.getAll("enabled");
  const enabledChecked = enabledValues.includes("1");
  const default_collector_version = formData.get("default_collector_version");

  const patch: Record<string, unknown> = {};
  if (typeof display_name === "string" && display_name.trim()) {
    patch.display_name = display_name.trim();
  }
  patch.enabled = enabledChecked;
  if (typeof default_collector_version === "string") {
    patch.default_collector_version = default_collector_version.trim() || null;
  }
  const defaultCollectionScope = parseCollectionScopeFormData(formData, {
    prefix: "default_collection_scope",
    artifactType: source.expected_artifact_type as ArtifactType,
    errorCode: "invalid_default_collection_scope",
  });
  if (!defaultCollectionScope.ok) {
    redirect(`/sources/${sourceId}?settings_error=invalid_default_collection_scope`);
  }
  patch.default_collection_scope = defaultCollectionScope.value;

  if (Object.keys(patch).length > 0) {
    try {
      await storage.withTransaction((tx) => tx.sources.update(sourceId, patch));
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "invalid_default_collection_scope") {
        redirect(`/sources/${sourceId}?settings_error=invalid_default_collection_scope`);
      }
      throw e;
    }
  }
  revalidatePath(`/sources/${sourceId}`);
  revalidatePath("/sources");
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  await assertAdminSession();
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) redirect("/sources");

  const storage = await getStorage();
  const result = await storage.withTransaction((tx) => tx.sources.delete(sourceId));
  if (!result.ok) {
    if (result.code === "not_found") {
      redirect("/sources");
    }
    if (result.code === "active_jobs") {
      redirect(`/sources/${sourceId}?delete_error=${result.code}`);
    }
  }

  revalidatePath(`/sources/${sourceId}`);
  revalidatePath("/sources");
  redirect("/sources?deleted=1");
}

export type RegisterAgentState =
  | { ok: false; error?: string }
  | { ok: true; token: string; token_prefix: string; agent_id: string };

export async function registerAgentForSource(formData: FormData): Promise<RegisterAgentState> {
  await assertAdminSession();
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) return { ok: false, error: "missing_source" };

  const storage = await getStorage();
  try {
    const { row, plainToken, token_prefix } = await storage.withTransaction((tx) =>
      tx.agents.createRegistration(
        sourceId,
        String(formData.get("display_name") ?? "").trim() || null
      )
    );
    return { ok: true, token: plainToken, token_prefix, agent_id: row.id };
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "source_already_registered") {
      return { ok: false, error: "already_registered" };
    }
    if (code === "source_not_found") {
      return { ok: false, error: "not_found" };
    }
    throw e;
  }
}

export async function reissueAgentTokenForSource(formData: FormData): Promise<RegisterAgentState> {
  await assertAdminSession();
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceId) return { ok: false, error: "missing_source" };

  const storage = await getStorage();
  try {
    const { row, plainToken, token_prefix } = await storage.withTransaction((tx) =>
      tx.agents.rotateRegistration(sourceId)
    );
    return { ok: true, token: plainToken, token_prefix, agent_id: row.id };
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "registration_not_found") {
      return { ok: false, error: "not_registered" };
    }
    if (code === "source_not_found") {
      return { ok: false, error: "not_found" };
    }
    throw e;
  }
}
