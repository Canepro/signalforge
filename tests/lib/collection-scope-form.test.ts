import { describe, expect, it } from "vitest";
import { parseCollectionScopeFormData } from "@/app/sources/collection-scope-form";

describe("parseCollectionScopeFormData", () => {
  it("returns null when no scope kind is selected", () => {
    const form = new FormData();
    const result = parseCollectionScopeFormData(form, {
      prefix: "default_collection_scope",
      artifactType: "linux-audit-log",
      errorCode: "invalid_default_collection_scope",
    });

    expect(result).toEqual({ ok: true, value: null });
  });

  it("parses a container target scope", () => {
    const form = new FormData();
    form.set("collection_scope_kind", "container_target");
    form.set("collection_scope_container_ref", "payments-api");
    form.set("collection_scope_runtime", "docker");
    form.set("collection_scope_host_hint", "runtime-a");

    const result = parseCollectionScopeFormData(form, {
      prefix: "collection_scope",
      artifactType: "container-diagnostics",
      errorCode: "invalid_collection_scope",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: "container_target",
        container_ref: "payments-api",
        runtime: "docker",
        host_hint: "runtime-a",
      },
    });
  });

  it("rejects namespace scope without namespace", () => {
    const form = new FormData();
    form.set("collection_scope_kind", "kubernetes_scope");
    form.set("collection_scope_scope_level", "namespace");

    const result = parseCollectionScopeFormData(form, {
      prefix: "collection_scope",
      artifactType: "kubernetes-bundle",
      errorCode: "invalid_collection_scope",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_collection_scope");
  });

  it("rejects mismatched artifact family", () => {
    const form = new FormData();
    form.set("default_collection_scope_kind", "kubernetes_scope");
    form.set("default_collection_scope_scope_level", "cluster");

    const result = parseCollectionScopeFormData(form, {
      prefix: "default_collection_scope",
      artifactType: "linux-audit-log",
      errorCode: "invalid_default_collection_scope",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_default_collection_scope");
  });
});
