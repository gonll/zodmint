import { ZodForgeError, formatPath } from "../errors.js";
import type { GenerationContext, SeededRNG } from "../context.js";

/** Fixed deterministic anchor date for seeded generation (2024-01-01T00:00:00.000Z) */
const ANCHOR_MS = 1704067200000;

// ---------------------------------------------------------------------------
// String constraints
// ---------------------------------------------------------------------------

export interface StringConstraints {
  min?: number;
  max?: number;
  email?: boolean;
  url?: boolean;
  uuid?: boolean;
  regex?: RegExp;
  startsWith?: string;
  endsWith?: string;
  includes?: string;
  length?: number;
  cuid?: boolean;
  cuid2?: boolean;
  ulid?: boolean;
  nanoid?: boolean;
  jwt?: boolean;
  datetime?: boolean;
  dateOnly?: boolean;
  timeOnly?: boolean;
  duration?: boolean;
  ip?: boolean;
  ipv4?: boolean;
  ipv6?: boolean;
  cidr?: boolean;
  cidrv6?: boolean;
  emoji?: boolean;
  base64?: boolean;
  base64url?: boolean;
}

export function validateStringConstraints(
  c: StringConstraints,
  path: string[],
): void {
  const effectiveMin = c.min ?? 0;
  const effectiveMax = c.max ?? Infinity;
  if (effectiveMin > effectiveMax) {
    throw new ZodForgeError(
      `Unsatisfiable string constraint at ${formatPath(path)}: min(${effectiveMin}) > max(${effectiveMax})`,
      "GENERATION_FAILED",
    );
  }
  // email + max(5) is unsatisfiable
  if (c.email && c.max !== undefined && c.max < 6) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: email with max(${c.max}) is too short for a valid email`,
      "GENERATION_FAILED",
    );
  }
  if (c.url && c.max !== undefined && c.max < 10) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: url with max(${c.max}) is too short for a valid URL`,
      "GENERATION_FAILED",
    );
  }
  if (c.uuid && c.max !== undefined && c.max < 36) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: uuid with max(${c.max}) cannot fit a UUID v4 (36 chars)`,
      "GENERATION_FAILED",
    );
  }
  if (c.uuid && c.min !== undefined && c.min > 36) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: uuid with min(${c.min}) cannot fit a UUID v4 (36 chars)`,
      "GENERATION_FAILED",
    );
  }
}

const CHARS_LOWER = "abcdefghijklmnopqrstuvwxyz";
const CHARS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARS_DIGIT = "0123456789";
const CHARS_ALPHA = CHARS_LOWER + CHARS_UPPER;
const CHARS_ALNUM = CHARS_ALPHA + CHARS_DIGIT;
const CHARS_HEX = "0123456789abcdef";

function randomString(rng: SeededRNG, len: number, charset = CHARS_ALNUM): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += charset[rng.nextInt(0, charset.length - 1)];
  }
  return s;
}

function uuidV4(rng: SeededRNG): string {
  const hex = () => randomString(rng, 1, CHARS_HEX);
  const seg = (n: number) => Array.from({ length: n }, hex).join("");
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${rng.pick(["8", "9", "a", "b"])}${seg(3)}-${seg(12)}`;
}

function generateEmail(rng: SeededRNG): string {
  const user = rng.pick(FIRST_NAMES).toLowerCase();
  const domains = ["example.com", "test.org", "mock.io", "fixture.dev", "forge.net", "demo.co", "sample.net"];
  return `${user}${rng.nextInt(1, 99)}@${rng.pick(domains)}`;
}

function generateUrl(rng: SeededRNG): string {
  const protocols = ["https", "http"];
  const tlds = ["com", "org", "io", "dev", "net"];
  const words = ["example", "test", "mock", "fixture", "forge", "demo"];
  return `${rng.pick(protocols)}://${rng.pick(words)}.${rng.pick(tlds)}`;
}

// ---------------------------------------------------------------------------
// Regex generation — expanded subset
// ---------------------------------------------------------------------------

// Printable ASCII 33 ('!') – 126 ('~'), no space/control/newline
const PRINTABLE_ASCII = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
const CHARS_WORD = CHARS_ALNUM + "_";
const CHARS_NONWORD = [" ", "-", ".", ",", "!", "@", "#", "%"];
const CHARS_WHITESPACE = [" ", "\t"];

/**
 * Expands a shorthand escape sequence to a char pool.
 * Returns null for zero-width assertions (\b, \B) — they produce no characters.
 */
function expandEscape(ch: string): string[] | null {
  switch (ch) {
    case "d": return CHARS_DIGIT.split("");
    case "D": return CHARS_ALPHA.split("");       // non-digit: letters are always safe
    case "w": return CHARS_WORD.split("");
    case "W": return CHARS_NONWORD;
    case "s": return CHARS_WHITESPACE;
    case "S": return CHARS_ALNUM.split("");
    case "b": return null;                         // zero-width word boundary
    case "B": return null;                         // zero-width non-word boundary
    case "n": return ["\n"];
    case "r": return ["\r"];
    case "t": return ["\t"];
    default:  return [ch];                         // escaped literal (\-, \+, \(, \.  …)
  }
}

/**
 * Splits `src` on top-level `|` — ignores `|` inside [...] or (...).
 */
function splitTopLevelAlts(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\") { i++; continue; }            // skip escaped char
    if (c === "[" && !inClass) { inClass = true; continue; }
    if (c === "]" && inClass) { inClass = false; continue; }
    if (inClass) continue;
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth--; continue; }
    if (c === "|" && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
}

/**
 * Returns a description of genuinely unsupported features, or null if supported.
 * We now support: literals, [...], [^...], \d \w \s \D \W \S \b, ., |,
 * (?:...), (...), {n}, {n,m}, ?, *, +, lazy modifiers, anchors ^ $.
 */
function detectUnsupportedRegex(src: string): string | null {
  if (/\(\?[=!]/.test(src))    return "lookahead/lookbehind (?=...) or (?!...)";
  if (/\(\?<[=!]/.test(src))   return "lookbehind (?<=...) or (?<!...)";
  if (/\\[1-9]/.test(src))     return "backreferences \\1...\\9";
  if (/\(\?<\w/.test(src))     return "named capture groups (?<name>...)";
  if (/\\[pP]\{/.test(src))    return "unicode properties \\p{...}";
  if (/[+*?]\+/.test(src))     return "possessive quantifiers ++, *+, ?+";
  return null;
}

export function generateFromRegex(
  regex: RegExp,
  rng: SeededRNG,
  path: string[],
): string {
  const src = regex.source;
  const unsupported = detectUnsupportedRegex(src);
  if (unsupported) {
    throw new ZodForgeError(
      `Regex at ${formatPath(path)} uses unsupported feature: ${unsupported}. ` +
        `Supported: literals, [...], [^...], \\d \\w \\s and inverses, ., |, (?:...), {n}, {n,m}, ?, *, +.`,
      "REGEX_UNSUPPORTED",
    );
  }
  return generateSimpleRegex(src, rng, path);
}

function generateSimpleRegex(src: string, rng: SeededRNG, path: string[]): string {
  // Strip anchors
  let s = src;
  if (s.startsWith("^")) s = s.slice(1);
  if (s.endsWith("$")) s = s.slice(0, -1);

  // Top-level alternation: pick one branch
  const alts = splitTopLevelAlts(s);
  if (alts.length > 1) return generateSimpleRegex(rng.pick(alts), rng, path);

  let result = "";
  let i = 0;

  while (i < s.length) {
    const ch = s[i]!;

    // --- Character class [...] (including negated [^...])
    if (ch === "[") {
      const close = findCharClassClose(s, i + 1);
      if (close === -1) throw new ZodForgeError(`Unclosed [...] in regex at ${formatPath(path)}`, "REGEX_UNSUPPORTED");
      const classContent = s.slice(i + 1, close);
      const negated = classContent.startsWith("^");
      const content = negated ? classContent.slice(1) : classContent;
      const included = expandCharClass(content);
      let chars: string[];
      if (negated) {
        const excluded = new Set(included);
        chars = CHARS_ALNUM.split("").filter((c) => !excluded.has(c));
        if (chars.length === 0) chars = [" "];
      } else {
        chars = included;
      }
      i = close + 1;
      const q = parseQuantifier(s, i);
      const count = resolveQuantifier(q, rng);
      i += q.raw.length;
      for (let k = 0; k < count; k++) result += rng.pick(chars);
      continue;
    }

    // --- Groups: (...) and (?:...)
    if (ch === "(") {
      const close = findMatchingParen(s, i);
      if (close === -1) throw new ZodForgeError(`Unclosed group in regex at ${formatPath(path)}`, "REGEX_UNSUPPORTED");
      let inner = s.slice(i + 1, close);
      if (inner.startsWith("?:")) inner = inner.slice(2); // strip non-capturing marker
      const groupVal = generateSimpleRegex(inner, rng, path);
      i = close + 1;
      const q = parseQuantifier(s, i);
      const count = resolveQuantifier(q, rng);
      i += q.raw.length;
      for (let k = 0; k < count; k++) result += groupVal;
      continue;
    }

    // --- Dot — any printable non-newline char
    if (ch === ".") {
      i++;
      const q = parseQuantifier(s, i);
      const count = resolveQuantifier(q, rng);
      i += q.raw.length;
      for (let k = 0; k < count; k++) result += rng.pick(PRINTABLE_ASCII);
      continue;
    }

    // --- Escape sequences
    if (ch === "\\") {
      const next = s[i + 1];
      if (next === undefined) throw new ZodForgeError(`Trailing backslash in regex at ${formatPath(path)}`, "REGEX_UNSUPPORTED");
      i += 2;
      const expansion = expandEscape(next);
      if (expansion === null) continue; // zero-width assertion — no output
      const q = parseQuantifier(s, i);
      const count = resolveQuantifier(q, rng);
      i += q.raw.length;
      for (let k = 0; k < count; k++) result += rng.pick(expansion);
      continue;
    }

    // --- Regular literal
    i++;
    const q = parseQuantifier(s, i);
    const count = resolveQuantifier(q, rng);
    i += q.raw.length;
    for (let k = 0; k < count; k++) result += ch;
  }

  return result;
}

function expandCharClass(content: string): string[] {
  const chars: string[] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;
    // Handle escaped chars inside class (e.g. [\d\w] or [a\-z])
    if (ch === "\\") {
      const next = content[i + 1];
      if (next !== undefined) {
        const expansion = expandEscape(next);
        if (expansion) chars.push(...expansion);
        i += 2;
        continue;
      }
    }
    if (content[i + 1] === "-" && content[i + 2] !== undefined && content[i + 2] !== "]") {
      const from = ch.charCodeAt(0);
      const to = content[i + 2]!.charCodeAt(0);
      for (let c = from; c <= to; c++) chars.push(String.fromCharCode(c));
      i += 3;
    } else {
      chars.push(ch);
      i++;
    }
  }
  return chars;
}

interface Quantifier {
  raw: string;
  min: number;
  max: number;
}

function parseQuantifier(src: string, pos: number): Quantifier {
  const ch = src[pos];
  let q: Quantifier | undefined;
  if (ch === "?") q = { raw: "?", min: 0, max: 1 };
  else if (ch === "*") q = { raw: "*", min: 0, max: 5 };
  else if (ch === "+") q = { raw: "+", min: 1, max: 5 };
  else if (ch === "{") {
    const close = src.indexOf("}", pos);
    if (close !== -1) {
      const inner = src.slice(pos + 1, close);
      const parts = inner.split(",");
      if (parts.length === 1) {
        const n = parseInt(parts[0]!, 10);
        if (!isNaN(n)) q = { raw: src.slice(pos, close + 1), min: n, max: n };
      } else if (parts.length === 2) {
        const mn = parseInt(parts[0]!, 10);
        const mx = parts[1]!.trim() === "" ? mn + 5 : parseInt(parts[1]!, 10);
        if (!isNaN(mn) && !isNaN(mx)) q = { raw: src.slice(pos, close + 1), min: mn, max: mx };
      }
    }
  }
  if (!q) return { raw: "", min: 1, max: 1 };
  // Consume optional lazy modifier '?' (treat as greedy — we always generate valid values)
  if (src[pos + q.raw.length] === "?") q = { ...q, raw: q.raw + "?" };
  return q;
}

function resolveQuantifier(q: Quantifier, rng: SeededRNG): number {
  return rng.nextInt(q.min, q.max);
}

/** Finds closing ] of a char class, respecting escapes. */
function findCharClassClose(src: string, start: number): number {
  for (let i = start; i < src.length; i++) {
    if (src[i] === "\\") { i++; continue; }
    if (src[i] === "]") return i;
  }
  return -1;
}

function findMatchingParen(src: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < src.length; i++) {
    if (src[i] === "\\") { i++; continue; }
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Edge-mode generators
// ---------------------------------------------------------------------------

/**
 * Generates a boundary string value.
 * Format constraints take priority (shortest valid canonical form).
 * Plain strings use "" (or min-length) vs max-length, picked randomly.
 */
export function generateEdgeString(c: StringConstraints, rng: SeededRNG): string {
  // Format constraints — return the shortest/simplest valid canonical value
  if (c.uuid) return "00000000-0000-4000-8000-000000000000";
  if (c.email) return "a@b.co";
  if (c.url) return "http://a.co";
  if (c.datetime) return "1970-01-01T00:00:00.000Z";
  if (c.dateOnly) return "1970-01-01";
  if (c.timeOnly) return "00:00:00";
  if (c.duration) return "P0Y0M0DT0H0M0S";
  if (c.cuid) return "c" + "a".repeat(24);
  if (c.cuid2) return "a".repeat(24);
  if (c.ulid) return "00000000000000000000000000";
  if (c.nanoid) return "a".repeat(21);
  if (c.jwt) return "eyJhbGciOiJIUzI1NiJ9.e30.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  if (c.ipv4 || c.ip) return "0.0.0.0";
  if (c.ipv6) return "0000:0000:0000:0000:0000:0000:0000:0000";
  if (c.cidr) return "0.0.0.0/0";
  if (c.cidrv6) return "0000::/0";
  if (c.base64) return btoa("a");
  if (c.base64url) return "YQ";
  if (c.emoji) return "😀";

  // startsWith/endsWith/includes anchors — handle combined case first
  if (c.startsWith && c.endsWith) {
    const fixed = c.startsWith + c.endsWith;
    const minLen = Math.max(fixed.length, c.min ?? 0);
    const padding = Math.max(0, minLen - fixed.length);
    return c.startsWith + "a".repeat(padding) + c.endsWith;
  }
  if (c.startsWith) {
    const minLen = Math.max(c.startsWith.length, c.min ?? 0);
    return c.startsWith + "a".repeat(Math.max(0, minLen - c.startsWith.length));
  }
  if (c.endsWith) {
    const minLen = Math.max(c.endsWith.length, c.min ?? 0);
    return "a".repeat(Math.max(0, minLen - c.endsWith.length)) + c.endsWith;
  }
  if (c.includes) {
    const minLen = Math.max(c.includes.length, c.min ?? 0);
    return "a".repeat(Math.max(0, minLen - c.includes.length)) + c.includes;
  }

  // Pick between shortest valid and longest valid
  const lo = c.min ?? 0;
  // Only pick the high boundary if there's an explicit max
  const len = c.max !== undefined ? (rng.bool() ? lo : c.max) : lo;
  return "a".repeat(len);
}

/**
 * Generates a boundary number value.
 * Picks from [min, max, 0, -1, 1, MAX_SAFE_INTEGER] filtering to values
 * that satisfy all active constraints. Falls back to 0 if nothing fits.
 */
export function generateEdgeNumber(c: NumberConstraints): number {
  const lo = resolveNumberMin(c);
  const hi = resolveNumberMax(c);

  const candidates = [lo, hi, 0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]
    .filter(v => {
      if (v < lo || v > hi) return false;
      if (c.gt !== undefined && v <= c.gt) return false;
      if (c.lt !== undefined && v >= c.lt) return false;
      if (c.int && !Number.isInteger(v)) return false;
      if (c.multipleOf !== undefined) {
        const m = c.multipleOf;
        const remainder = v % m;
        // For fractional multipleOf, round remainder to m's precision before comparing
        if (Number.isInteger(m)) {
          if (remainder !== 0) return false;
        } else {
          const precision = (m.toString().split(".")[1] ?? "").length;
          if (parseFloat(remainder.toFixed(precision)) !== 0) return false;
        }
      }
      return true;
    });

  if (candidates.length === 0) return lo;
  // Return the lowest valid boundary value (candidates[0] is always lo after filtering)
  return candidates[0]!;
}

/**
 * Generates a boundary bigint value.
 */
export function generateEdgeBigInt(c: BigIntConstraints): bigint {
  if (c.gte !== undefined) return c.gte;
  if (c.gt !== undefined) return c.gt + 1n;
  if (c.min !== undefined) return c.min;
  if (c.positive) return 1n;
  if (c.nonnegative) return 0n;
  if (c.negative) return -1n;
  return 0n;
}

/**
 * Generates a boundary date value (epoch or min/max date).
 */
export function generateEdgeDate(c: DateConstraints): Date {
  if (c.min) return new Date(c.min);
  if (c.max) return new Date(c.max);
  return new Date(0); // Unix epoch — the canonical edge date
}

export function generateString(
  c: StringConstraints,
  rng: SeededRNG,
  path: string[],
  semantic?: string | null,
): string {
  validateStringConstraints(c, path);

  // Priority: explicit format constraint > semantic > random
  if (c.uuid) return uuidV4(rng);
  if (c.email) return generateEmail(rng);
  if (c.url) return generateUrl(rng);
  if (c.datetime) return new Date(ANCHOR_MS - rng.nextInt(0, 365 * 24 * 3600 * 1000)).toISOString();
  if (c.dateOnly) {
    const d = new Date(ANCHOR_MS - rng.nextInt(0, 5 * 365 * 24 * 3600 * 1000));
    return d.toISOString().split("T")[0]!;
  }
  if (c.timeOnly) {
    const h = String(rng.nextInt(0, 23)).padStart(2, "0");
    const m = String(rng.nextInt(0, 59)).padStart(2, "0");
    const s = String(rng.nextInt(0, 59)).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  if (c.duration) {
    const years = rng.nextInt(0, 3);
    const months = rng.nextInt(0, 11);
    const days = rng.nextInt(0, 30);
    const hours = rng.nextInt(0, 23);
    const mins = rng.nextInt(0, 59);
    const secs = rng.nextInt(0, 59);
    return `P${years}Y${months}M${days}DT${hours}H${mins}M${secs}S`;
  }
  if (c.cuid) return `c${randomString(rng, 24, CHARS_LOWER + CHARS_DIGIT)}`;
  if (c.cuid2) return randomString(rng, 24, CHARS_LOWER + CHARS_DIGIT);
  if (c.ulid) {
    const time = randomString(rng, 10, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    const rand = randomString(rng, 16, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    return time + rand;
  }
  if (c.nanoid) return randomString(rng, 21, CHARS_ALNUM + "_-");
  if (c.jwt) {
    // Structurally valid JWT (header.payload.signature in base64url)
    const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ sub: uuidV4(rng), iat: Math.floor(ANCHOR_MS / 1000) }));
    const sig = randomString(rng, 43, CHARS_ALNUM + "_-");
    return `${header}.${payload}.${sig}`;
  }
  if (c.ipv4 || c.ip) {
    return `${rng.nextInt(1, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(1, 254)}`;
  }
  if (c.ipv6) {
    const seg = () => randomString(rng, 4, CHARS_HEX);
    return `${seg()}:${seg()}:${seg()}:${seg()}:${seg()}:${seg()}:${seg()}:${seg()}`;
  }
  if (c.cidr) {
    const prefix = rng.nextInt(8, 30);
    const host = `${rng.nextInt(1, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(0, 254)}.0`;
    return `${host}/${prefix}`;
  }
  if (c.cidrv6) {
    const seg = () => randomString(rng, 4, CHARS_HEX);
    const prefix = rng.nextInt(32, 64);
    return `${seg()}:${seg()}:${seg()}::/${prefix}`;
  }
  if (c.base64) {
    const raw = randomString(rng, rng.nextInt(8, 20), CHARS_ALNUM);
    return btoa(raw);
  }
  if (c.base64url) {
    const raw = randomString(rng, rng.nextInt(8, 20), CHARS_ALNUM);
    return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  if (c.emoji) return rng.pick(["😀", "😂", "🎉", "🔥", "✨", "🎯", "🚀", "💡"]);

  if (c.regex) {
    const generated = generateFromRegex(c.regex, rng, path);
    // Validate regex result against length constraints — throw if irreconcilable
    if (c.min !== undefined && generated.length < c.min) {
      throw new ZodForgeError(
        `Cannot satisfy both regex /${c.regex.source}/ and min(${c.min}) constraints at ${formatPath(path)}: ` +
          `regex produced a string of length ${generated.length} which is shorter than min(${c.min})`,
        "GENERATION_FAILED",
      );
    }
    if (c.max !== undefined && generated.length > c.max) {
      throw new ZodForgeError(
        `Cannot satisfy both regex /${c.regex.source}/ and max(${c.max}) constraints at ${formatPath(path)}: ` +
          `regex produced a string of length ${generated.length} which is longer than max(${c.max})`,
        "GENERATION_FAILED",
      );
    }
    return generated;
  }

  // Semantic inference — only if it satisfies constraints
  if (semantic) {
    const semanticValue = applyStringSemantic(semantic, rng);
    if (semanticValue !== null) {
      const len = semanticValue.length;
      const minOk = c.min === undefined || len >= c.min;
      const maxOk = c.max === undefined || len <= c.max;
      // c.length is an exact-length constraint (.length(n)) — must also match
      const exactOk = c.length === undefined || len === c.length;
      const swOk = !c.startsWith || semanticValue.startsWith(c.startsWith);
      const ewOk = !c.endsWith || semanticValue.endsWith(c.endsWith);
      const inclOk = !c.includes || semanticValue.includes(c.includes);
      if (minOk && maxOk && exactOk && swOk && ewOk && inclOk) return semanticValue;
    }
  }

  // Generic length-constrained string
  return generateConstrainedString(c, rng);
}

function applyStringSemantic(key: string, rng: SeededRNG): string | null {
  const k = key.toLowerCase();

  // Identity / email
  if (/email/.test(k)) return generateEmail(rng);

  // Names
  if (/firstname|first_name/.test(k)) return rng.pick(FIRST_NAMES);
  if (/middlename|middle_name/.test(k)) return rng.pick(FIRST_NAMES);
  if (/lastname|last_name|surname|familyname|family_name/.test(k)) return rng.pick(LAST_NAMES);
  if (/fullname|full_name|displayname|display_name/.test(k)) return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  if (/\bname\b/.test(k)) return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  if (/nickname|handle/.test(k)) return `${rng.pick(FIRST_NAMES).toLowerCase()}${rng.nextInt(1, 99)}`;
  if (/username|login/.test(k)) return `${rng.pick(FIRST_NAMES).toLowerCase()}${rng.nextInt(1, 999)}`;
  if (/password|passphrase/.test(k)) return randomString(rng, 12, CHARS_ALNUM + "!@#$%");

  // Contact
  if (/phone|phonenumber|phone_number|mobile|cellphone/.test(k)) return `+1-${rng.nextInt(200, 999)}-${rng.nextInt(100, 999)}-${rng.nextInt(1000, 9999)}`;

  // URLs & images
  if (/\burl\b|website|homepage|site/.test(k)) return generateUrl(rng);
  if (/avatar|avatarurl|avatar_url/.test(k)) return `https://avatars.example.com/${uuidV4(rng)}.png`;
  if (/imageurl|image_url|photo|thumbnail|thumbnailurl|thumbnail_url|coverurl|cover_url/.test(k)) return `https://images.example.com/${randomString(rng, 8, CHARS_ALNUM)}.jpg`;
  if (/logourl|logo_url|logo/.test(k)) return `https://logos.example.com/${randomString(rng, 8, CHARS_ALNUM)}.svg`;

  // Address fields
  if (/\baddress\b/.test(k)) return `${rng.nextInt(1, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_TYPES)}`;
  if (/\bstreet\b/.test(k)) return `${rng.nextInt(1, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_TYPES)}`;
  if (/\bcity\b|town/.test(k)) return rng.pick(CITIES);
  if (/\bstate\b|province|region/.test(k)) return rng.pick(STATES);
  if (/\bcountry\b/.test(k)) return rng.pick(COUNTRIES);
  if (/countrycode|country_code/.test(k)) return rng.pick(COUNTRY_CODES);
  if (/zipcode|zip\b|postalcode|postal_code/.test(k)) return `${rng.nextInt(10000, 99999)}`;

  // Company / organization
  if (/\bcompany\b|organization|organisation|employer/.test(k)) return rng.pick(COMPANIES);
  if (/department|team\b/.test(k)) return rng.pick(DEPARTMENTS);
  if (/jobtitle|job_title|role\b|position\b/.test(k)) return rng.pick(JOB_TITLES);

  // Content
  if (/description|bio\b|summary|about|overview/.test(k)) return rng.pick(DESCRIPTIONS);
  if (/\bcontent\b|body\b|message\b|note\b|notes\b|text\b/.test(k)) return rng.pick(DESCRIPTIONS);
  if (/\btitle\b/.test(k)) return rng.pick(TITLES);
  if (/subject\b/.test(k)) return rng.pick(EMAIL_SUBJECTS);
  if (/\btag\b|tags\b|label\b|labels\b|category\b|categories\b/.test(k)) return rng.pick(TAGS);
  if (/\bslug\b/.test(k)) return rng.pick(TITLES).toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // IDs and tokens
  if (/\bid\b|uuid/.test(k)) return uuidV4(rng);
  if (/\btoken\b|accesstoken|access_token|refreshtoken|refresh_token/.test(k)) return randomString(rng, 32, CHARS_HEX);
  if (/apikey|api_key|secretkey|secret_key|secret\b/.test(k)) return randomString(rng, 40, CHARS_HEX);
  if (/\bcode\b|otp\b|verificationcode|verification_code/.test(k)) return String(rng.nextInt(100000, 999999));
  if (/\bsku\b|barcode|ean\b/.test(k)) return `SKU-${randomString(rng, 6, CHARS_ALNUM).toUpperCase()}`;

  // Locale / internationalization
  if (/\blocale\b|lang\b|language\b/.test(k)) return rng.pick(LOCALES);
  if (/timezone|time_zone/.test(k)) return rng.pick(TIMEZONES);
  if (/currencycode|currency_code/.test(k)) return rng.pick(CURRENCY_CODES);
  if (/\bcurrency\b/.test(k)) return rng.pick(CURRENCY_CODES);

  // Appearance
  if (/\bcolor\b|colour\b|hexcolor|hex_color/.test(k)) {
    const hex = () => randomString(rng, 2, CHARS_HEX);
    return `#${hex()}${hex()}${hex()}`;
  }

  // Status / type
  if (/\bstatus\b/.test(k)) return rng.pick(["active", "inactive", "pending", "suspended", "archived"]);
  if (/\btype\b|kind\b/.test(k)) return rng.pick(["primary", "secondary", "admin", "user", "guest"]);
  if (/\bgender\b|sex\b/.test(k)) return rng.pick(["male", "female", "non-binary", "prefer not to say"]);

  // File / MIME
  if (/filename|file_name|filepath|file_path/.test(k)) return `${randomString(rng, 8, CHARS_ALNUM)}.${rng.pick(["pdf", "png", "jpg", "csv", "json"])}`;
  if (/mimetype|mime_type|contenttype|content_type/.test(k)) return rng.pick(MIME_TYPES);
  if (/\bextension\b/.test(k)) return rng.pick(["pdf", "png", "jpg", "csv", "json", "xml", "zip"]);

  // Network
  if (/ipaddress|ip_address/.test(k)) return `${rng.nextInt(1, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(1, 254)}`;
  if (/\bhost\b|hostname/.test(k)) return `${rng.pick(["api", "app", "cdn", "mail", "dev"])}.example.com`;

  // Dates (as strings, not Date objects)
  if (/\bdate\b|createdat|created_at|updatedat|updated_at|deletedat|deleted_at|publishedat|published_at/.test(k)) {
    return new Date(ANCHOR_MS - rng.nextInt(0, 365 * 24 * 3600 * 1000)).toISOString().split("T")[0]!;
  }
  if (/birthdate|birth_date|dob\b|dateofbirth|date_of_birth/.test(k)) {
    const year = rng.nextInt(1960, 2000);
    const month = String(rng.nextInt(1, 12)).padStart(2, "0");
    const day = String(rng.nextInt(1, 28)).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Version
  if (/\bversion\b/.test(k)) return `${rng.nextInt(0, 5)}.${rng.nextInt(0, 20)}.${rng.nextInt(0, 99)}`;

  return null;
}

export { applyStringSemantic };

function generateConstrainedString(c: StringConstraints, rng: SeededRNG): string {
  const prefix = c.startsWith ?? "";
  const suffix = c.endsWith ?? "";
  const needle = c.includes ?? "";
  const fixed = c.length;
  // Compute minimum structural length: prefix + needle (embedded) + suffix
  const structuralMin = prefix.length + needle.length + suffix.length;
  const minLen = fixed ?? Math.max(c.min ?? 0, structuralMin);
  const maxLen = fixed ?? Math.max(c.max ?? Math.max(minLen + 8, 12), minLen);

  if (needle) {
    // Generate random padding before and after the embedded needle
    const available = Math.max(0, rng.nextInt(
      Math.max(0, minLen - structuralMin),
      Math.max(0, maxLen - structuralMin),
    ));
    const beforeLen = rng.nextInt(0, available);
    const afterLen = available - beforeLen;
    return prefix + randomString(rng, beforeLen) + needle + randomString(rng, afterLen) + suffix;
  }

  const middleLen = rng.nextInt(
    Math.max(0, minLen - prefix.length - suffix.length),
    Math.max(0, maxLen - prefix.length - suffix.length),
  );
  return prefix + randomString(rng, middleLen) + suffix;
}

// ---------------------------------------------------------------------------
// Number constraints
// ---------------------------------------------------------------------------

export interface NumberConstraints {
  min?: number;
  max?: number;
  int?: boolean;
  positive?: boolean;
  negative?: boolean;
  nonpositive?: boolean;
  nonnegative?: boolean;
  multipleOf?: number;
  finite?: boolean;
  safe?: boolean;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export function validateNumberConstraints(
  c: NumberConstraints,
  path: string[],
): void {
  const hasPositive = c.positive || c.gt !== undefined && c.gt >= 0 || c.gte !== undefined && c.gte > 0;
  const hasNegative = c.negative || c.lt !== undefined && c.lt <= 0 || c.lte !== undefined && c.lte < 0;
  if (hasPositive && hasNegative) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: number cannot be both positive and negative`,
      "GENERATION_FAILED",
    );
  }
  const effectiveMin = resolveNumberMin(c);
  const effectiveMax = resolveNumberMax(c);
  if (effectiveMin > effectiveMax) {
    throw new ZodForgeError(
      `Unsatisfiable constraint at ${formatPath(path)}: min(${effectiveMin}) > max(${effectiveMax})`,
      "GENERATION_FAILED",
    );
  }
}

function resolveNumberMin(c: NumberConstraints): number {
  let min = -Infinity;
  if (c.min !== undefined) min = Math.max(min, c.min);
  if (c.gte !== undefined) min = Math.max(min, c.gte);
  if (c.gt !== undefined) min = Math.max(min, c.gt + (c.int ? 1 : Number.EPSILON));
  if (c.positive) min = Math.max(min, c.int ? 1 : Number.EPSILON);
  if (c.nonnegative) min = Math.max(min, 0);
  return min === -Infinity ? (c.negative ? -1000 : 0) : min;
}

function resolveNumberMax(c: NumberConstraints): number {
  let max = Infinity;
  if (c.max !== undefined) max = Math.min(max, c.max);
  if (c.lte !== undefined) max = Math.min(max, c.lte);
  if (c.lt !== undefined) max = Math.min(max, c.lt - (c.int ? 1 : Number.EPSILON));
  if (c.negative) max = Math.min(max, c.int ? -1 : -Number.EPSILON);
  if (c.nonpositive) max = Math.min(max, 0);
  return max === Infinity ? (c.positive ? 1000 : 100) : max;
}

export function generateNumber(
  c: NumberConstraints,
  rng: SeededRNG,
  path: string[],
  semantic?: string | null,
): number {
  validateNumberConstraints(c, path);

  // Semantic inference
  if (semantic) {
    const sv = applyNumericSemantic(semantic, rng, c);
    if (sv !== null) return sv;
  }

  const min = resolveNumberMin(c);
  const max = resolveNumberMax(c);

  if (c.multipleOf !== undefined) {
    const m = c.multipleOf;
    const lo = Math.ceil(min / m);
    const hi = Math.floor(max / m);
    if (lo > hi) {
      throw new ZodForgeError(
        `Unsatisfiable multipleOf(${m}) constraint at ${formatPath(path)}: no multiple in [${min}, ${max}]`,
        "GENERATION_FAILED",
      );
    }
    const raw = rng.nextInt(lo, hi) * m;
    // Round to the precision of m to fix floating-point drift (e.g. 3 * 0.1 === 0.30000000000000004)
    if (!Number.isInteger(m)) {
      const precision = (m.toString().split(".")[1] ?? "").length;
      return parseFloat(raw.toFixed(precision));
    }
    return raw;
  }

  if (c.int) {
    return rng.nextInt(Math.ceil(min), Math.floor(max));
  }

  return parseFloat(rng.nextFloat(min, max).toFixed(4));
}

function applyNumericSemantic(
  key: string,
  rng: SeededRNG,
  c: NumberConstraints,
): number | null {
  const k = key.toLowerCase();
  const isInt = c.int ?? false;

  // Only intersect against explicit user-set constraints, not the synthetic defaults.
  const hasExplicit =
    c.min !== undefined || c.max !== undefined ||
    c.gte !== undefined || c.lte !== undefined ||
    c.gt !== undefined || c.lt !== undefined ||
    c.positive || c.negative || c.nonnegative || c.nonpositive;

  const constraintLo = hasExplicit ? resolveNumberMin(c) : -Infinity;
  const constraintHi = hasExplicit ? resolveNumberMax(c) : Infinity;

  /**
   * Generates a value within the intersection of [semMin, semMax] and the
   * constraint range. Returns null if the ranges don't overlap so the caller
   * can fall through to the generic generator.
   */
  const int = (semMin: number, semMax: number): number | null => {
    if (!hasExplicit) return rng.nextInt(semMin, semMax);
    // Check overlap
    if (semMax < constraintLo || semMin > constraintHi) return null;
    const effectiveMin = Math.ceil(Math.max(semMin, constraintLo));
    const effectiveMax = Math.floor(Math.min(semMax, constraintHi));
    if (effectiveMin > effectiveMax) return null;
    return rng.nextInt(effectiveMin, effectiveMax);
  };
  const float = (semMin: number, semMax: number, decimals = 2): number | null => {
    if (!hasExplicit) {
      return isInt
        ? rng.nextInt(Math.ceil(semMin), Math.floor(semMax))
        : parseFloat(rng.nextFloat(semMin, semMax).toFixed(decimals));
    }
    // Check overlap
    if (semMax < constraintLo || semMin > constraintHi) return null;
    const effectiveMin = Math.max(semMin, constraintLo);
    const effectiveMax = Math.min(semMax, constraintHi);
    if (effectiveMin > effectiveMax) return null;
    return isInt
      ? rng.nextInt(Math.ceil(effectiveMin), Math.floor(effectiveMax))
      : parseFloat(rng.nextFloat(effectiveMin, effectiveMax).toFixed(decimals));
  };

  // Human attributes
  if (/\bage\b/.test(k)) return int(18, 80);

  // Money
  if (/price|amount|cost|total\b|subtotal|balance|salary|budget|revenue/.test(k)) return float(0.01, 9999.99);
  if (/discount|tax|fee/.test(k)) return float(0, 500, 2);

  // Counts
  if (/\bcount\b|quantity|qty\b/.test(k)) return int(1, 100);
  if (/total(?:count|items|records|results)|totalcount/.test(k)) return int(0, 10000);
  if (/\bsize\b/.test(k)) return int(1, 500);
  if (/\blimit\b|pagesize|page_size|perpage|per_page/.test(k)) return int(10, 100);
  if (/\boffset\b|skip\b/.test(k)) return int(0, 1000);
  if (/\bpage\b|pagenumber|page_number/.test(k)) return int(1, 100);
  if (/\bindex\b|\border\b|position\b|rank\b/.test(k)) return int(0, 999);

  // Ratings / scores
  if (/rating\b|score\b/.test(k)) return float(0, 5, 1);
  if (/priority\b|importance\b/.test(k)) return int(1, 10);
  if (/\blevel\b/.test(k)) return int(1, 10);

  // Percentages
  if (/percentage|percent\b/.test(k)) return float(0, 100, 2);

  // Dimensions
  if (/\bwidth\b/.test(k)) return int(100, 3840);
  if (/\bheight\b/.test(k)) return int(100, 2160);
  if (/\bweight\b/.test(k)) return float(0.1, 200, 2);

  // Geo
  if (/latitude|lat\b/.test(k)) return float(-90, 90, 6);
  if (/longitude|lng\b|lon\b/.test(k)) return float(-180, 180, 6);

  // Date parts
  if (/\byear\b/.test(k)) return int(2000, 2030);
  if (/\bmonth\b/.test(k)) return int(1, 12);
  if (/\bday\b/.test(k)) return int(1, 28);
  if (/\bhour\b/.test(k)) return int(0, 23);
  if (/\bminute\b/.test(k)) return int(0, 59);
  if (/\bsecond\b/.test(k)) return int(0, 59);

  // Time spans
  if (/duration\b/.test(k)) return int(1, 3600);
  if (/timeout\b/.test(k)) return int(100, 30000);
  if (/interval\b/.test(k)) return int(1, 60);

  // Network
  if (/\bport\b/.test(k)) return int(1024, 65535);

  // Version
  if (/\bversion\b|major\b|minor\b|patch\b/.test(k)) return int(0, 99);

  return null;
}

// ---------------------------------------------------------------------------
// BigInt constraints
// ---------------------------------------------------------------------------

export interface BigIntConstraints {
  min?: bigint;
  max?: bigint;
  multipleOf?: bigint;
  positive?: boolean;
  negative?: boolean;
  nonpositive?: boolean;
  nonnegative?: boolean;
  gt?: bigint;
  gte?: bigint;
  lt?: bigint;
  lte?: bigint;
}

export function generateBigInt(
  c: BigIntConstraints,
  rng: SeededRNG,
  path: string[],
): bigint {
  // Compute bounds correctly
  let min = -1000n;
  let max = 1000n;

  if (c.min !== undefined) min = c.min > min ? c.min : min;
  if (c.gte !== undefined) min = c.gte > min ? c.gte : min;
  if (c.gt !== undefined) min = c.gt + 1n > min ? c.gt + 1n : min;
  if (c.positive) min = min > 1n ? min : 1n;
  if (c.nonnegative) min = min > 0n ? min : 0n;

  if (c.max !== undefined) max = c.max < max ? c.max : max;
  if (c.lte !== undefined) max = c.lte < max ? c.lte : max;
  if (c.lt !== undefined) max = c.lt - 1n < max ? c.lt - 1n : max;
  if (c.negative) max = max < -1n ? max : -1n;
  if (c.nonpositive) max = max < 0n ? max : 0n;

  if (min > max) {
    throw new ZodForgeError(
      `Unsatisfiable bigint constraint at ${formatPath(path)}: min(${min}) > max(${max})`,
      "GENERATION_FAILED",
    );
  }

  if (c.multipleOf !== undefined) {
    const m = c.multipleOf;
    if (m === 0n) {
      throw new ZodForgeError(
        `Invalid multipleOf(0) at ${formatPath(path)}`,
        "GENERATION_FAILED",
      );
    }
    // Ceiling division: smallest k such that k*m >= min
    const lo = min % m === 0n ? min / m : min > 0n ? min / m + 1n : min / m;
    // Floor division: largest k such that k*m <= max
    const hi = max % m === 0n ? max / m : max < 0n ? max / m - 1n : max / m;
    const range = Number(hi - lo);
    if (range < 0) {
      throw new ZodForgeError(
        `Unsatisfiable multipleOf(${m}) for bigint at ${formatPath(path)}`,
        "GENERATION_FAILED",
      );
    }
    return (lo + BigInt(rng.nextInt(0, range))) * m;
  }

  const range = Number(max - min);
  return min + BigInt(rng.nextInt(0, Math.min(range, 2 ** 31 - 1)));
}

// ---------------------------------------------------------------------------
// Date constraints
// ---------------------------------------------------------------------------

export interface DateConstraints {
  min?: Date;
  max?: Date;
}

export function generateDate(c: DateConstraints, rng: SeededRNG, path: string[]): Date {
  // When min is provided but max is not, derive max from min instead of the
  // fixed ANCHOR_MS — otherwise any min after 2024-01-01 triggers "min > max".
  const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;
  const maxMs = c.max?.getTime() ?? (c.min ? c.min.getTime() + ONE_YEAR_MS : ANCHOR_MS);
  const minMs = c.min?.getTime() ?? (maxMs - ONE_YEAR_MS);

  if (minMs > maxMs) {
    throw new ZodForgeError(
      `Unsatisfiable date constraint at ${formatPath(path)}: min > max`,
      "GENERATION_FAILED",
    );
  }

  return new Date(minMs + rng.nextFloat(0, maxMs - minMs));
}

// ---------------------------------------------------------------------------
// Fixtures / word lists
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  // English
  "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Henry", "Iris", "Jack",
  "Karen", "Leo", "Maya", "Noah", "Olivia", "Paul", "Quinn", "Rachel", "Sam", "Tina",
  "Uma", "Victor", "Wendy", "Xander", "Yara", "Zoe", "Aaron", "Beth", "Diana", "Ethan",
  "Fiona", "George", "Hannah", "Ian", "Julia", "Kevin", "Laura", "Mike", "Nora", "Oscar",
  "Penny", "Ryan", "Sarah", "Tom", "Ursula", "Violet", "Will", "Ximena", "Yvonne", "Zach",
  // Spanish / Latin American
  "Carlos", "Maria", "Jose", "Ana", "Luis", "Carmen", "Miguel", "Sofia", "Jorge", "Lucia",
  "Alejandro", "Valentina", "Diego", "Isabella", "Sebastian", "Camila", "Andres", "Gabriela",
  // French
  "Antoine", "Camille", "Julien", "Manon", "Nicolas", "Claire", "Pierre", "Margot",
  // German
  "Felix", "Lena", "Maximilian", "Sophie", "Johannes", "Anna", "Lukas", "Emma",
  // Asian
  "Wei", "Mei", "Yuki", "Kenji", "Priya", "Arjun", "Sana", "Haruto", "Aiko", "Riya",
  "Jin", "Min", "Hana", "Takeshi", "Ananya", "Vikram", "Yuna", "Joon", "Sakura", "Ryo",
  // African / Middle Eastern
  "Amara", "Kofi", "Fatima", "Omar", "Aisha", "Ibrahim", "Zara", "Kwame", "Nadia", "Hassan",
];
const LAST_NAMES = [
  // Common English
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Moore", "Taylor",
  "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Young", "Hall", "Walker",
  "Allen", "King", "Wright", "Scott", "Hill", "Adams", "Baker", "Nelson", "Carter", "Mitchell",
  "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris",
  // Hispanic
  "Garcia", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Perez", "Sanchez", "Torres", "Flores",
  "Rivera", "Ramirez", "Cruz", "Reyes", "Morales", "Jimenez", "Ortiz", "Gutierrez", "Chavez", "Vargas",
  // Asian
  "Nguyen", "Lee", "Kim", "Chen", "Wang", "Liu", "Zhang", "Tanaka", "Suzuki", "Yamamoto",
  "Park", "Patel", "Singh", "Kumar", "Sharma", "Gupta", "Nakamura", "Kobayashi", "Ito", "Watanabe",
  // Other
  "Müller", "Weber", "Fischer", "Dubois", "Leroy", "Moreau", "Andersson", "Lindgren", "Johansson",
  "Cohen", "Levy", "Ahmed", "Hassan", "Ali", "Okafor", "Mensah", "Diallo", "Tremblay", "Bouchard",
];
const STREET_NAMES = [
  "Oak", "Maple", "Pine", "Elm", "Cedar", "Main", "Park", "Lake", "Hill", "River",
  "Sunset", "Willow", "Highland", "Meadow", "Forest", "Spring", "Valley", "Ridge", "Birch", "Ash",
  "Washington", "Lincoln", "Jefferson", "Madison", "Adams", "Jackson", "Franklin", "Grant", "Monroe", "Harrison",
  "Orchard", "Cherry", "Walnut", "Chestnut", "Poplar", "Sycamore", "Magnolia", "Hawthorn", "Rosewood", "Laurel",
  "Broad", "High", "Church", "School", "Mill", "Bridge", "Station", "Market", "Harbor", "Cliff",
];
const STREET_TYPES = ["St", "Ave", "Blvd", "Dr", "Ln", "Rd", "Way", "Ct", "Pl", "Terrace", "Circle", "Trail", "Path", "Loop", "Run"];
const CITIES = [
  // USA
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego",
  "Dallas", "San Jose", "Austin", "Jacksonville", "San Francisco", "Seattle", "Denver", "Nashville",
  "Portland", "Las Vegas", "Memphis", "Louisville", "Baltimore", "Milwaukee", "Albuquerque", "Tucson",
  // Canada
  "Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Winnipeg", "Quebec City",
  // Europe
  "London", "Paris", "Berlin", "Madrid", "Rome", "Amsterdam", "Brussels", "Vienna", "Zurich", "Stockholm",
  "Oslo", "Copenhagen", "Helsinki", "Lisbon", "Athens", "Warsaw", "Prague", "Budapest", "Bucharest",
  // Asia-Pacific
  "Tokyo", "Beijing", "Shanghai", "Seoul", "Mumbai", "Delhi", "Singapore", "Sydney", "Melbourne", "Auckland",
  "Osaka", "Taipei", "Hong Kong", "Bangkok", "Kuala Lumpur", "Jakarta", "Manila", "Karachi", "Dhaka",
  // Americas / Other
  "São Paulo", "Buenos Aires", "Bogotá", "Lima", "Santiago", "Mexico City", "Guadalajara",
  "Cairo", "Lagos", "Nairobi", "Johannesburg", "Casablanca", "Dubai", "Tel Aviv", "Istanbul",
];
const STATES = [
  // USA
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
  "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
  // Canada
  "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan",
  "Nova Scotia", "New Brunswick", "Newfoundland and Labrador",
  // Europe / Other
  "Bavaria", "Baden-Württemberg", "North Rhine-Westphalia", "Île-de-France", "Catalonia",
  "Lombardy", "Andalusia", "New South Wales", "Victoria", "Queensland",
];
const COUNTRIES = [
  "United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Japan",
  "Spain", "Italy", "Brazil", "India", "Mexico", "Netherlands", "Sweden", "South Korea",
  "Singapore", "New Zealand", "Switzerland", "Norway", "Denmark", "Finland", "Portugal",
  "Austria", "Belgium", "Poland", "Argentina", "Chile", "Colombia", "South Africa", "Nigeria",
  "Egypt", "Turkey", "Israel", "Saudi Arabia", "United Arab Emirates", "Thailand", "Indonesia",
  "Malaysia", "Philippines", "Vietnam", "China", "Taiwan", "Hong Kong", "Ireland", "Greece",
];
const COUNTRY_CODES = [
  "US", "CA", "GB", "AU", "DE", "FR", "JP", "ES", "IT", "BR", "IN", "MX", "NL", "SE", "KR",
  "SG", "NZ", "CH", "NO", "DK", "FI", "PT", "AT", "BE", "PL", "AR", "CL", "CO", "ZA", "NG",
  "EG", "TR", "IL", "SA", "AE", "TH", "ID", "MY", "PH", "VN", "CN", "TW", "HK", "IE", "GR",
];
const COMPANIES = [
  // Tech
  "Meridian Software", "Apex Systems", "Crestline Technologies", "Vantage Digital", "Ironclad Labs",
  "Brightpath Solutions", "Silverline Tech", "Northstar Engineering", "Cascade Software", "Pinnacle Systems",
  "Redwood Technologies", "Clearwater Digital", "Granite Systems", "Riverstone Labs", "Summit Tech",
  "Fieldstone Software", "Harborview Technologies", "Lakeland Systems", "Stonegate Digital", "Ridgeline Labs",
  // Finance
  "Compass Capital", "Keystone Financial", "Bridgewater Advisors", "Crestwood Partners", "Landmark Equity",
  "Springdale Ventures", "Oakridge Capital", "Elmwood Investment Group", "Cedarwood Asset Management",
  // Healthcare
  "Greenfield Health", "Clearfield Medical", "Valleyview Healthcare", "Hillside Diagnostics",
  // Retail / Consumer
  "Harborside Goods", "Meadowbrook Retail", "Cornerstone Market", "Sunridge Commerce",
  // Consulting
  "Broadview Consulting", "Highpoint Advisory", "Milestone Group", "Waypoint Strategy",
];
const DEPARTMENTS = [
  "Engineering", "Product", "Design", "Marketing", "Sales", "Finance", "Accounting",
  "Human Resources", "Legal", "Operations", "Customer Success", "Support", "Security",
  "Data Science", "Research", "Infrastructure", "DevOps", "Quality Assurance", "Analytics",
  "Business Development", "Partnerships", "Communications", "Procurement", "Compliance",
];
const JOB_TITLES = [
  // Engineering
  "Software Engineer", "Senior Software Engineer", "Staff Engineer", "Principal Engineer",
  "Frontend Developer", "Backend Developer", "Full Stack Engineer", "Mobile Developer",
  "DevOps Engineer", "Site Reliability Engineer", "Platform Engineer", "Security Engineer",
  "Data Engineer", "Machine Learning Engineer", "Engineering Manager", "Director of Engineering",
  "VP of Engineering", "Chief Technology Officer",
  // Product / Design
  "Product Manager", "Senior Product Manager", "Director of Product", "VP of Product",
  "UX Designer", "Product Designer", "UI Designer", "Design Lead", "Head of Design",
  // Data
  "Data Scientist", "Data Analyst", "Business Intelligence Analyst", "Analytics Engineer",
  // Marketing / Sales
  "Marketing Manager", "Content Strategist", "Growth Manager", "SEO Specialist",
  "Sales Representative", "Account Executive", "Account Manager", "Sales Manager",
  "Customer Success Manager", "Solutions Engineer",
  // Operations / Finance
  "Operations Manager", "Project Manager", "Program Manager", "Scrum Master",
  "Financial Analyst", "Controller", "CFO", "HR Manager", "Recruiter", "Office Manager",
  // Other
  "Technical Writer", "QA Engineer", "Support Engineer", "Developer Advocate",
];
const DESCRIPTIONS = [
  // Generic product/feature
  "Streamlines the onboarding process for new users with a guided setup experience.",
  "Provides real-time visibility into system performance and operational metrics.",
  "Enables teams to collaborate on documents with version history and inline comments.",
  "Automates repetitive tasks to reduce manual effort and minimize human error.",
  "Integrates with existing tools in your workflow via a flexible REST API.",
  "Delivers personalized recommendations based on user behavior and preferences.",
  "Ensures data consistency across distributed systems with conflict-free merging.",
  "Scales horizontally to handle traffic spikes without manual intervention.",
  "Supports multi-tenant architecture with strict data isolation between organizations.",
  "Offers fine-grained access control with role-based permissions and audit logs.",
  // User bio / about
  "Passionate about building products that make a real difference in people's lives.",
  "Over ten years of experience shipping software at high-growth startups and enterprise companies.",
  "Focused on creating accessible, performant interfaces that users actually enjoy using.",
  "Strong believer in developer experience and the power of well-designed abstractions.",
  "Enjoys mentoring junior engineers and fostering a culture of continuous learning.",
  "Writes about technology, product management, and distributed systems on occasion.",
  "Based in San Francisco. Previously at three Y Combinator companies.",
  "Open source contributor and occasional conference speaker.",
  "Obsessed with data quality and making analytics trustworthy at scale.",
  "Combines a background in statistics with a love for clean, maintainable code.",
];
const TITLES = [
  // Tech / Dev
  "Getting Started with TypeScript", "Advanced React Patterns", "Building Reliable APIs",
  "Microservices in Practice", "The Art of Code Review", "Database Design for Scale",
  "CI/CD Best Practices", "Security Fundamentals for Engineers", "Observability Deep Dive",
  "GraphQL vs REST: A Practical Comparison",
  // Product / Business
  "Product Roadmap Q3 2025", "Launch Plan: Phase One", "Competitive Analysis Report",
  "Customer Research Summary", "OKRs for the Engineering Team", "Quarterly Business Review",
  "Go-to-Market Strategy", "Post-Mortem: Incident #4821", "Team Retrospective Notes",
  "Design System Documentation",
  // General
  "Introduction to Machine Learning", "A Guide to Remote Work", "Hiring Manager Handbook",
  "Onboarding Checklist", "Performance Review Template", "Meeting Notes: Weekly Sync",
  "Project Proposal: Platform Migration", "Architecture Decision Record #12",
];
const EMAIL_SUBJECTS = [
  "Action required: review your recent account activity",
  "Your order has shipped — track your package",
  "Welcome to the platform — let's get you started",
  "Reset your password",
  "Your weekly digest is ready",
  "Someone commented on your post",
  "You've been invited to collaborate",
  "Reminder: meeting tomorrow at 10am",
  "Your trial ends in 3 days",
  "New message from your team",
  "Invoice #4821 is ready for review",
  "Your export is ready to download",
  "Security alert: new sign-in detected",
  "We've updated our terms of service",
  "Your subscription has been renewed",
];
const TAGS = [
  // Tech
  "javascript", "typescript", "python", "rust", "go", "react", "vue", "angular", "svelte",
  "node", "deno", "bun", "api", "rest", "graphql", "grpc", "websockets",
  "frontend", "backend", "fullstack", "devops", "infrastructure", "cloud", "serverless",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform",
  "testing", "ci-cd", "performance", "security", "accessibility", "seo",
  "database", "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
  "machine-learning", "ai", "data-science", "analytics",
  // Product / Business
  "design", "ux", "product", "mobile", "ios", "android",
  "startup", "open-source", "saas", "b2b", "b2c",
];
const LOCALES = [
  "en-US", "en-GB", "en-AU", "en-CA", "en-NZ",
  "fr-FR", "fr-CA", "fr-BE",
  "de-DE", "de-AT", "de-CH",
  "es-ES", "es-MX", "es-AR", "es-CO",
  "pt-BR", "pt-PT",
  "it-IT", "nl-NL", "sv-SE", "no-NO", "da-DK", "fi-FI", "pl-PL",
  "ja-JP", "ko-KR", "zh-CN", "zh-TW", "zh-HK",
  "ar-SA", "he-IL", "tr-TR", "ru-RU",
];
const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
  "Europe/Amsterdam", "Europe/Stockholm", "Europe/Zurich", "Europe/Warsaw", "Europe/Istanbul",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Mumbai",
  "Asia/Kolkata", "Asia/Bangkok", "Asia/Dubai", "Asia/Jerusalem",
  "Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland",
];
const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "HKD", "NZD",
  "SEK", "NOK", "DKK", "SGD", "INR", "BRL", "MXN", "KRW", "ZAR", "TRY",
  "PLN", "CZK", "HUF", "ILS", "SAR", "AED", "THB", "MYR", "IDR", "PHP",
];
const MIME_TYPES = [
  "application/json", "application/ld+json", "application/pdf", "application/zip",
  "application/gzip", "application/x-tar", "application/octet-stream",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html", "text/plain", "text/csv", "text/xml", "text/markdown",
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif",
  "audio/mpeg", "audio/ogg", "audio/wav",
  "video/mp4", "video/webm", "video/ogg",
  "font/woff", "font/woff2",
];
