import type { GenerationMode } from "./context.js";

export interface FieldMatcher {
  /** Regex pattern tested against the leaf key of ctx.path */
  pattern: RegExp;
  /** Generator function — receives no args, returns a value */
  generate: () => unknown;
}

export interface GlobalConfig {
  maxDepth: number;
  useDefaults: boolean;
  matchers: FieldMatcher[];
}

export interface MockOptions {
  overrides?: Record<string, unknown>;
  seed?: number;
  maxDepth?: number;
  mode?: GenerationMode;
  useDefaults?: boolean;
}

const DEFAULT_CONFIG: GlobalConfig = {
  maxDepth: 2,
  useDefaults: false,
  matchers: [],
};

let globalConfig: GlobalConfig = { ...DEFAULT_CONFIG, matchers: [] };

/** Returns an immutable snapshot of the current global config */
export function snapshotConfig(): Readonly<GlobalConfig> {
  return {
    maxDepth: globalConfig.maxDepth,
    useDefaults: globalConfig.useDefaults,
    matchers: [...globalConfig.matchers],
  };
}

export function configure(options: Partial<GlobalConfig>): void {
  globalConfig = {
    ...globalConfig,
    ...options,
    matchers: options.matchers ?? globalConfig.matchers,
  };
}

export function resetConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG, matchers: [] };
}
