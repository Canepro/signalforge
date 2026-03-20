import { readFileSync } from "fs";
import { analyzeArtifact } from "./index.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: bun run src/lib/analyzer/cli.ts <path-to-audit-log>");
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  console.log(`Analyzing: ${filePath} (${content.split("\n").length} lines)`);

  const result = await analyzeArtifact(content);

  if (result.analysis_error) {
    console.warn(`\nLLM call failed: ${result.analysis_error}`);
    console.warn("Showing deterministic fallback report.\n");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
