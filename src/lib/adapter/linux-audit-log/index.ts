import type { ArtifactAdapter } from "../types";
import type { EnvironmentContext, NoiseItem, PreFinding } from "../../analyzer/schema";
import { stripAnsi } from "./strip-ansi";
import { parseSections } from "./sections";
import { detectEnvironment } from "./environment";
import { classifyNoise } from "./noise-rules";
import { extractPreFindings } from "./finding-rules";
import { detectIncomplete } from "./incomplete";

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
