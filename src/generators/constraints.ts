import { ZodForgeError, formatPath } from "../errors.js";
import type { GenerationContext, SeededRNG } from "../context.js";

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
  datetime?: boolean;
  ip?: boolean;
  emoji?: boolean;
  base64?: boolean;
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
  const users = ["alice", "bob", "carol", "dave", "eve", "frank", "grace", "henry"];
  const domains = ["example.com", "test.org", "mock.io", "fixture.dev", "forge.net"];
  return `${rng.pick(users)}${rng.nextInt(1, 99)}@${rng.pick(domains)}`;
}

function generateUrl(rng: SeededRNG): string {
  const protocols = ["https", "http"];
  const tlds = ["com", "org", "io", "dev", "net"];
  const words = ["example", "test", "mock", "fixture", "forge", "demo"];
  return `${rng.pick(protocols)}://${rng.pick(words)}.${rng.pick(tlds)}`;
}

/**
 * Simple regex generator — supports basic patterns only.
 * Throws REGEX_UNSUPPORTED for complex patterns.
 */
export function generateFromRegex(
  regex: RegExp,
  rng: SeededRNG,
  path: string[],
): string {
  const src = regex.source;

  // Detect unsupported features
  const unsupportedPatterns = [
    /\(\?[=!<]/,          // lookahead / lookbehind
    /\(\?:/,              // non-capturing groups (we support capturing only)
    /\\[bBdDwWsS]/,       // word boundaries, \d \w \s classes
    /[+*?]\?/,            // lazy quantifiers
    /\{[^}]*,[^}]*\}/,    // complex range {n,m} — we handle simple {n} and {n,m} with basic ranges
    /\[\^/,               // negated character classes
    /\./,                 // dot (any char) — too broad
    /\|(?![^(]*\))/,      // top-level alternation outside parens
  ];

  // Allow simple patterns through
  const isSimple =
    /^(\^)?([a-zA-Z0-9\[\]\-\+\*\?\{\},\(\)\|]|\\.)*(\$)?$/.test(src) &&
    !unsupportedPatterns.some((p) => p.test(src));

  if (!isSimple) {
    throw new ZodForgeError(
      `Regex at ${formatPath(path)} contains unsupported pattern: /${src}/. ` +
        `zod-forge supports only simple patterns (character classes, quantifiers, fixed alternation). See README for details.`,
      "REGEX_UNSUPPORTED",
    );
  }

  return generateSimpleRegex(src, rng, path);
}

function generateSimpleRegex(
  src: string,
  rng: SeededRNG,
  path: string[],
): string {
  let result = "";
  let i = src.startsWith("^") ? 1 : 0;
  const end = src.endsWith("$") ? src.length - 1 : src.length;

  while (i < end) {
    const ch = src[i]!;

    // Character class [...]
    if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close === -1) {
        throw new ZodForgeError(
          `Unclosed character class in regex at ${formatPath(path)}`,
          "REGEX_UNSUPPORTED",
        );
      }
      const classContent = src.slice(i + 1, close);
      const chars = expandCharClass(classContent);
      i = close + 1;
      const quantifier = parseQuantifier(src, i);
      const count = resolveQuantifier(quantifier, rng);
      i += quantifier.raw.length;
      for (let k = 0; k < count; k++) {
        result += rng.pick(chars);
      }
      continue;
    }

    // Alternation group (foo|bar|baz)
    if (ch === "(") {
      const close = findMatchingParen(src, i);
      if (close === -1) {
        throw new ZodForgeError(
          `Unclosed group in regex at ${formatPath(path)}`,
          "REGEX_UNSUPPORTED",
        );
      }
      const inner = src.slice(i + 1, close);
      const alts = inner.split("|");
      const chosen = rng.pick(alts);
      result += generateSimpleRegex(chosen, rng, path);
      i = close + 1;
      continue;
    }

    // Literal character
    if (ch === "\\") {
      // Escaped literal
      const next = src[i + 1];
      if (next === undefined) {
        throw new ZodForgeError(
          `Trailing backslash in regex at ${formatPath(path)}`,
          "REGEX_UNSUPPORTED",
        );
      }
      const literal = next;
      i += 2;
      const quantifier = parseQuantifier(src, i);
      const count = resolveQuantifier(quantifier, rng);
      i += quantifier.raw.length;
      for (let k = 0; k < count; k++) result += literal;
      continue;
    }

    // Regular literal
    i++;
    const quantifier = parseQuantifier(src, i);
    const count = resolveQuantifier(quantifier, rng);
    i += quantifier.raw.length;
    for (let k = 0; k < count; k++) result += ch;
  }

  return result;
}

function expandCharClass(content: string): string[] {
  const chars: string[] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;
    if (content[i + 1] === "-" && content[i + 2] !== undefined) {
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
  if (ch === "?") return { raw: "?", min: 0, max: 1 };
  if (ch === "*") return { raw: "*", min: 0, max: 5 };
  if (ch === "+") return { raw: "+", min: 1, max: 5 };
  if (ch === "{") {
    const close = src.indexOf("}", pos);
    if (close !== -1) {
      const inner = src.slice(pos + 1, close);
      const parts = inner.split(",");
      if (parts.length === 1) {
        const n = parseInt(parts[0]!, 10);
        if (!isNaN(n)) return { raw: src.slice(pos, close + 1), min: n, max: n };
      } else if (parts.length === 2) {
        const mn = parseInt(parts[0]!, 10);
        const mx = parts[1]!.trim() === "" ? mn + 5 : parseInt(parts[1]!, 10);
        if (!isNaN(mn) && !isNaN(mx)) return { raw: src.slice(pos, close + 1), min: mn, max: mx };
      }
    }
  }
  return { raw: "", min: 1, max: 1 };
}

function resolveQuantifier(q: Quantifier, rng: SeededRNG): number {
  return rng.nextInt(q.min, q.max);
}

function findMatchingParen(src: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
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
  if (c.datetime) return new Date(Date.now() - rng.nextInt(0, 365 * 24 * 3600 * 1000)).toISOString();
  if (c.cuid) return `c${randomString(rng, 24, CHARS_LOWER + CHARS_DIGIT)}`;
  if (c.cuid2) return randomString(rng, 24, CHARS_LOWER + CHARS_DIGIT);
  if (c.ulid) {
    const time = randomString(rng, 10, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    const rand = randomString(rng, 16, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    return time + rand;
  }
  if (c.ip) {
    return `${rng.nextInt(1, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(0, 254)}.${rng.nextInt(1, 254)}`;
  }
  if (c.base64) {
    const raw = randomString(rng, rng.nextInt(8, 20), CHARS_ALNUM);
    return btoa(raw);
  }
  if (c.emoji) return rng.pick(["😀", "😂", "🎉", "🔥", "✨", "🎯", "🚀", "💡"]);

  if (c.regex) {
    const generated = generateFromRegex(c.regex, rng, path);
    // Validate regex result against constraints — fall back if it can't satisfy them
    if (c.min !== undefined && generated.length < c.min) {
      // Can't satisfy both regex + min, fall through to generic
    } else if (c.max !== undefined && generated.length > c.max) {
      // Can't satisfy both regex + max, fall through to generic
    } else {
      return generated;
    }
  }

  // Semantic inference — only if it satisfies constraints
  if (semantic) {
    const semanticValue = applyStringSemantic(semantic, rng);
    if (semanticValue !== null) {
      const len = semanticValue.length;
      const minOk = c.min === undefined || len >= c.min;
      const maxOk = c.max === undefined || len <= c.max;
      const swOk = !c.startsWith || semanticValue.startsWith(c.startsWith);
      const ewOk = !c.endsWith || semanticValue.endsWith(c.endsWith);
      if (minOk && maxOk && swOk && ewOk) return semanticValue;
    }
  }

  // Generic length-constrained string
  return generateConstrainedString(c, rng);
}

function applyStringSemantic(key: string, rng: SeededRNG): string | null {
  const k = key.toLowerCase();

  if (/email/.test(k)) return generateEmail(rng);
  if (/firstname|first_name/.test(k)) return rng.pick(FIRST_NAMES);
  if (/lastname|last_name/.test(k)) return rng.pick(LAST_NAMES);
  if (/\bname\b/.test(k)) return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  if (/phone|phonenumber/.test(k)) return `+1-${rng.nextInt(200, 999)}-${rng.nextInt(100, 999)}-${rng.nextInt(1000, 9999)}`;
  if (/\burl\b|website/.test(k)) return generateUrl(rng);
  if (/avatar|avatarurl/.test(k)) return `https://avatars.example.com/${uuidV4(rng)}.png`;
  if (/\baddress\b/.test(k)) return `${rng.nextInt(1, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_TYPES)}`;
  if (/\bcity\b/.test(k)) return rng.pick(CITIES);
  if (/\bcountry\b/.test(k)) return rng.pick(COUNTRIES);
  if (/zipcode|zip\b|postalcode/.test(k)) return `${rng.nextInt(10000, 99999)}`;
  if (/\bcompany\b/.test(k)) return `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_SUFFIXES)}`;
  if (/description|bio/.test(k)) return rng.pick(LOREM_SENTENCES);
  if (/\bid\b|uuid/.test(k)) return uuidV4(rng);
  if (/username/.test(k)) return `${rng.pick(FIRST_NAMES).toLowerCase()}${rng.nextInt(1, 999)}`;
  if (/password/.test(k)) return randomString(rng, 12, CHARS_ALNUM + "!@#$%");
  if (/\btoken\b/.test(k)) return randomString(rng, 32, CHARS_HEX);
  if (/\btitle\b/.test(k)) return rng.pick(TITLES);
  if (/\bdate\b|createdat|updatedat/.test(k)) return new Date(Date.now() - rng.nextInt(0, 365 * 24 * 3600 * 1000)).toISOString().split("T")[0]!;

  return null;
}

export { applyStringSemantic };

function generateConstrainedString(c: StringConstraints, rng: SeededRNG): string {
  const prefix = c.startsWith ?? "";
  const suffix = c.endsWith ?? "";
  const fixed = c.length;
  const minLen = fixed ?? Math.max(c.min ?? 0, prefix.length + suffix.length);
  const maxLen = fixed ?? Math.max(c.max ?? Math.max(minLen + 8, 12), minLen);
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
    return rng.nextInt(lo, hi) * m;
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

  const clamp = (v: number) => {
    const lo = resolveNumberMin(c);
    const hi = resolveNumberMax(c);
    return Math.min(Math.max(v, lo), hi);
  };

  if (/\bage\b/.test(k)) {
    const v = rng.nextInt(18, 80);
    return clamp(v);
  }
  if (/price|amount|cost/.test(k)) {
    const v = parseFloat(rng.nextFloat(0.01, 9999.99).toFixed(2));
    return clamp(isInt ? Math.round(v) : v);
  }
  if (/count|quantity/.test(k)) {
    return clamp(rng.nextInt(1, 100));
  }
  if (/rating|score/.test(k)) {
    const v = parseFloat(rng.nextFloat(0, 5).toFixed(1));
    return clamp(v);
  }
  if (/percentage|percent/.test(k)) {
    const v = parseFloat(rng.nextFloat(0, 100).toFixed(2));
    return clamp(isInt ? Math.round(v) : v);
  }

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
    const lo = min / m + (min % m !== 0n && min > 0n ? 1n : 0n);
    const hi = max / m - (max % m !== 0n && max < 0n ? 1n : 0n);
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
  const now = Date.now();
  const maxMs = c.max?.getTime() ?? now;
  const minMs = c.min?.getTime() ?? (maxMs - 365 * 24 * 3600 * 1000);

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

const FIRST_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Henry", "Iris", "Jack"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Moore"];
const STREET_NAMES = ["Oak", "Maple", "Pine", "Elm", "Cedar", "Main", "Park", "Lake", "Hill", "River"];
const STREET_TYPES = ["St", "Ave", "Blvd", "Dr", "Ln", "Rd", "Way", "Ct"];
const CITIES = ["Springfield", "Shelbyville", "Riverdale", "Lakewood", "Hillcrest", "Maplewood", "Fairview"];
const COUNTRIES = ["United States", "Canada", "United Kingdom", "Australia", "Germany", "France", "Japan"];
const COMPANY_PREFIXES = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli"];
const COMPANY_SUFFIXES = ["Corp", "Inc", "LLC", "Industries", "Technologies", "Solutions", "Systems"];
const LOREM_SENTENCES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse.",
  "Excepteur sint occaecat cupidatat non proident sunt in culpa.",
];
const TITLES = ["Introduction to Testing", "Advanced TypeScript", "The Art of Mocking", "Schema-Driven Development"];
