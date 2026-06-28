import { describe, expect, it } from "vitest";
import { getStorage, resolveStorageDriver } from "@/lib/storage";

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

  it("flags unsupported values without selecting postgres", () => {
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

  it("fails fast instead of falling back to sqlite for unsupported runtime driver values", async () => {
    const previous = process.env.DATABASE_DRIVER;
    process.env.DATABASE_DRIVER = "mongo";
    try {
      await expect(getStorage()).rejects.toThrow(/Unsupported DATABASE_DRIVER/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_DRIVER;
      } else {
        process.env.DATABASE_DRIVER = previous;
      }
    }
  });
});
