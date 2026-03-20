import type { EnvironmentContext, NoiseItem, PreFinding } from "../analyzer/schema.js";

export interface ArtifactAdapter {
  readonly type: string;
  stripNoise(raw: string): string;
  parseSections(clean: string): Record<string, string>;
  detectEnvironment(sections: Record<string, string>): EnvironmentContext;
  classifyNoise(
    sections: Record<string, string>,
    env: EnvironmentContext
  ): NoiseItem[];
  extractPreFindings(
    sections: Record<string, string>,
    env: EnvironmentContext
  ): PreFinding[];
  detectIncomplete(sections: Record<string, string>): {
    incomplete: boolean;
    reason?: string;
  };
}
