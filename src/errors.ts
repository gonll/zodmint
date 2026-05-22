export type ZodForgeErrorCode =
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_MODE"
  | "INVALID_OVERRIDE"
  | "REGEX_UNSUPPORTED"
  | "MAX_DEPTH_EXCEEDED"
  | "GENERATION_FAILED";

export class ZodForgeError extends Error {
  constructor(
    message: string,
    public readonly code: ZodForgeErrorCode,
  ) {
    super(message);
    this.name = "ZodForgeError";
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZodForgeError);
    }
  }
}

export function formatPath(path: string[]): string {
  return path.length > 0 ? `"${path.join(".")}"` : "<root>";
}
