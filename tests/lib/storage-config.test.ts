import { describe, expect, it } from "vitest";
import { resolveStorageDriver } from "@/lib/storage";

describe("resolveStorageDriver", () => {
  it("normalizes whitespace and case for postgres", () => {
    expect(
      resolveStorageDriver({
        ...process.env,
        DATABASE_DRIVER: " Postgres ",
      } satisfies NodeJS.ProcessEnv)
    ).toEqual({
      raw: "postgres",
      driver: "postgres",
      supported: true,
    });
  });

  it("flags unsupported values while falling runtime selection back to sqlite", () => {
    expect(
      resolveStorageDriver({
        ...process.env,
        DATABASE_DRIVER: "mongo",
      } satisfies NodeJS.ProcessEnv)
    ).toEqual({
      raw: "mongo",
      driver: "sqlite",
      supported: false,
    });
  });
});
