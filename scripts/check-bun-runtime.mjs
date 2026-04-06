#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const MIN_BUN_VERSION = "1.3.11";

function parseVersion(value) {
  const [core] = value.trim().split("-");
  const [major, minor, patch] = core.split(".").map((part) => Number.parseInt(part, 10));

  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    return null;
  }

  return { major, minor, patch };
}

function isAtLeastVersion(actual, minimum) {
  if (actual.major !== minimum.major) {
    return actual.major > minimum.major;
  }
  if (actual.minor !== minimum.minor) {
    return actual.minor > minimum.minor;
  }

  return actual.patch >= minimum.patch;
}

const minimum = parseVersion(MIN_BUN_VERSION);
if (!minimum) {
  console.error(`[runtime-check] Invalid minimum Bun version: ${MIN_BUN_VERSION}`);
  process.exit(1);
}

const check = spawnSync("bun", ["--version"], { encoding: "utf8" });

if (check.error) {
  if (check.error.code === "ENOENT") {
    console.error(
      [
        "[runtime-check] Bun is required for this repository but was not found on PATH.",
        `[runtime-check] Expected Bun >= ${MIN_BUN_VERSION}.`,
        "[runtime-check] Install Bun: https://bun.sh/docs/installation",
      ].join("\n")
    );
  } else {
    console.error(`[runtime-check] Failed to execute bun --version: ${check.error.message}`);
  }

  process.exit(1);
}

if (check.status !== 0) {
  console.error(
    [
      `[runtime-check] bun --version exited with status ${check.status}.`,
      check.stderr?.trim() || check.stdout?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  process.exit(1);
}

const detectedVersion = check.stdout.trim();
const parsedDetectedVersion = parseVersion(detectedVersion);

if (!parsedDetectedVersion) {
  console.error(`[runtime-check] Could not parse Bun version: ${detectedVersion}`);
  process.exit(1);
}

if (!isAtLeastVersion(parsedDetectedVersion, minimum)) {
  console.error(
    [
      `[runtime-check] Bun ${detectedVersion} detected, but this repository expects Bun >= ${MIN_BUN_VERSION}.`,
      "[runtime-check] Upgrade Bun: https://bun.sh/docs/installation",
    ].join("\n")
  );
  process.exit(1);
}

console.log(`[runtime-check] Bun ${detectedVersion} detected (>= ${MIN_BUN_VERSION}).`);
