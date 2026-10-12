// Test-report parsers for `ci-report`. Each turns one report format into a flat
// list of { name, outcome }. Hand-written on purpose: the formats are small and
// stable, and this package ships no XML dependency.

export type TestOutcome = "passed" | "failed" | "skipped";

export interface TestResult {
  name: string;
  outcome: TestOutcome;
}

// ─── JUnit XML ───────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return safeFromCodePoint(Number.parseInt(body.slice(2), 16), whole);
    if (body.startsWith("#")) return safeFromCodePoint(Number.parseInt(body.slice(1), 10), whole);
    return ENTITIES[body] ?? whole;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  const raw = m ? (m[1] ?? m[2]) : undefined;
  return raw === undefined ? undefined : decodeXmlEntities(raw);
}

/**
 * JUnit XML (the format Vitest, Jest, pytest, Playwright, Maven, ... emit).
 * A testcase is `failed` when it has a <failure> or <error> child, `skipped`
 * with a <skipped> child, otherwise `passed`. <flakyFailure> (a retry that then
 * passed) and <rerun*> children never change the verdict.
 */
export function parseJUnit(xml: string): TestResult[] {
  // Drop everything that can contain angle brackets as text, so only real
  // elements are left to tokenise: comments, CDATA, and process output.
  const cleaned = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<(system-out|system-err)\b[^>]*?>[\s\S]*?<\/\1>/g, "")
    .replace(/<(system-out|system-err)\b[^>]*?\/>/g, "");

  const tag = /<(\/?)(testcase|failure|error|skipped)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const results: TestResult[] = [];
  let current: TestResult | null = null;

  for (let m = tag.exec(cleaned); m; m = tag.exec(cleaned)) {
    const [, closing, name, attrs, selfClosing] = m;
    if (name === "testcase") {
      if (closing) {
        if (current) results.push(current);
        current = null;
        continue;
      }
      // A new <testcase> while one is open means the previous was malformed;
      // keep what we have rather than dropping it.
      if (current) results.push(current);
      const testName = attr(attrs, "name") ?? "";
      current = { name: testName, outcome: "passed" };
      if (selfClosing) {
        results.push(current);
        current = null;
      }
      continue;
    }
    if (!current || closing) continue;
    if (name === "failure" || name === "error") current.outcome = "failed";
    else if (name === "skipped" && current.outcome !== "failed") current.outcome = "skipped";
  }
  if (current) results.push(current);
  return results.filter((r) => r.name.length > 0);
}

// ─── Vitest JSON (--reporter=json) ───────────────────────────────────────────

const VITEST_SKIPPED = new Set(["skipped", "pending", "todo", "disabled"]);

export function parseVitestJson(input: unknown): TestResult[] {
  const results: TestResult[] = [];
  const files = (input as { testResults?: unknown })?.testResults;
  if (!Array.isArray(files)) {
    throw new Error("not a Vitest/Jest JSON report: missing testResults[]");
  }
  for (const file of files) {
    const assertions = (file as { assertionResults?: unknown })?.assertionResults;
    if (!Array.isArray(assertions)) continue;
    for (const a of assertions) {
      const t = a as {
        fullName?: unknown;
        title?: unknown;
        ancestorTitles?: unknown;
        status?: unknown;
      };
      const ancestors = Array.isArray(t.ancestorTitles)
        ? t.ancestorTitles.filter((x): x is string => typeof x === "string")
        : [];
      const name =
        typeof t.fullName === "string" && t.fullName
          ? t.fullName
          : [...ancestors, typeof t.title === "string" ? t.title : ""].join(" ").trim();
      if (!name) continue;
      const status = typeof t.status === "string" ? t.status : "";
      results.push({
        name,
        outcome: status === "passed" ? "passed" : VITEST_SKIPPED.has(status) ? "skipped" : "failed",
      });
    }
  }
  return results;
}

// ─── Playwright JSON (--reporter=json) ───────────────────────────────────────

interface PwSuite {
  title?: string;
  suites?: PwSuite[];
  specs?: Array<{
    title?: string;
    tests?: Array<{ status?: string; results?: Array<{ status?: string }> }>;
  }>;
}

export function parsePlaywrightJson(input: unknown): TestResult[] {
  const suites = (input as { suites?: unknown })?.suites;
  if (!Array.isArray(suites)) throw new Error("not a Playwright JSON report: missing suites[]");
  const results: TestResult[] = [];

  const walk = (suite: PwSuite, titles: string[]) => {
    // The top-level suite of each file is titled with the file path: not part
    // of the test's name.
    for (const spec of suite.specs ?? []) {
      const name = [...titles, spec.title ?? ""].filter(Boolean).join(" ");
      if (!name) continue;
      const statuses = (spec.tests ?? []).map((t) => t.status ?? "");
      // A spec with no test entries did not run (filtered out by a project or
      // grep); it proves nothing, so it is skipped rather than passed.
      const outcome: TestOutcome = statuses.includes("unexpected")
        ? "failed"
        : statuses.length === 0 || statuses.every((s) => s === "skipped")
          ? "skipped"
          : "passed";
      results.push({ name, outcome });
    }
    for (const child of suite.suites ?? []) {
      walk(child, child.title ? [...titles, child.title] : titles);
    }
  };
  for (const top of suites as PwSuite[]) walk(top, []);
  return results;
}
