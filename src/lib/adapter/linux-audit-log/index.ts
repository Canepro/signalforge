import type { ArtifactAdapter } from "../types.js";
import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema.js";
import { stripAnsi } from "./strip-ansi.js";
import { parseSections } from "./sections.js";
import { detectEnvironment } from "./environment.js";
import { classifyNoise } from "./noise-rules.js";
import { extractPreFindings } from "./finding-rules.js";
import { detectIncomplete } from "./incomplete.js";

export class LinuxAuditLogAdapter implements ArtifactAdapter {
  readonly type = "linux-audit-log";

  stripNoise(raw: string): string {
    return stripAnsi(raw);
  }

  parseSections(clean: string): Record<string, string> {
    return parseSections(clean);
  }

  detectEnvironment(sections: Record<string, string>): EnvironmentContext {
    return detectEnvironment(sections);
  }

  classifyNoise(
    sections: Record<string, string>,
    env: EnvironmentContext
  ): NoiseItem[] {
    return classifyNoise(sections, env);
  }

  extractPreFindings(
    sections: Record<string, string>,
    env: EnvironmentContext
  ): PreFinding[] {
    return extractPreFindings(sections, env);
  }

  detectIncomplete(sections: Record<string, string>): {
    incomplete: boolean;
    reason?: string;
  } {
    return detectIncomplete(sections);
  }
}
