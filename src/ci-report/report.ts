// Turns parsed test results into the request body for the review result
// endpoint, and a human-readable summary of the response.

import type { TestResult } from "./parse.js";

/** Acceptance-criterion codes look like AC-042 (at least three digits). */
const AC_TAG = /\[(AC-[0-9]{3,})\]/g;

/** Codes tagged in a test name as `[AC-042]`, in order, without duplicates. */
export function extractAcCodes(name: string): string[] {
  const codes = new Set<string>();
  for (const m of name.matchAll(AC_TAG)) codes.add(m[1]);
  return [...codes];
}

export interface PerTest {
  name: string;
  ac_codes: string[];
  outcome: "passed" | "failed" | "skipped";
}

export interface ReportPayload {
  outcome: "passed" | "failed";
  test_run_url: string;
  git_sha?: string;
  per_test: PerTest[];
}

/** The server accepts at most this many per-test results in one report. */
export const MAX_PER_TEST = 5000;
const MAX_NAME = 500;

export interface BuiltReport {
  payload: ReportPayload;
  /** Tests in the run, tagged or not. */
  total: number;
  /** Tests that carry at least one AC tag. */
  tagged: number;
  /** Distinct AC codes seen. */
  codes: string[];
}

/**
 * Only tagged tests are sent: an untagged test proves nothing about a
 * criterion. `outcome` is the whole run's verdict (any failed test, tagged or
 * not); the server decides each criterion from its own tests.
 */
export function buildReport(
  results: TestResult[],
  opts: { runUrl: string; sha?: string }
): BuiltReport {
  const per_test: PerTest[] = [];
  const codes = new Set<string>();
  for (const r of results) {
    const ac_codes = extractAcCodes(r.name);
    if (ac_codes.length === 0) continue;
    for (const c of ac_codes) codes.add(c);
    per_test.push({ name: r.name.slice(0, MAX_NAME), ac_codes, outcome: r.outcome });
  }
  if (per_test.length > MAX_PER_TEST) {
    throw new Error(
      `${per_test.length} tagged tests exceed the ${MAX_PER_TEST} a single report can carry`
    );
  }
  const payload: ReportPayload = {
    outcome: results.some((r) => r.outcome === "failed") ? "failed" : "passed",
    test_run_url: opts.runUrl,
    per_test,
  };
  if (opts.sha && opts.sha.length >= 7) payload.git_sha = opts.sha;
  return { payload, total: results.length, tagged: per_test.length, codes: [...codes].sort() };
}

interface ReportResponse {
  resolved?: Array<{ ac_code: string; outcome: string }>;
  ignored?: Array<{ ac_code: string; reason: string; status?: string }>;
}

/** One line per criterion the report touched, plus a count line. */
export function summariseResponse(body: unknown): string[] {
  const b = (body ?? {}) as ReportResponse;
  const resolved = Array.isArray(b.resolved) ? b.resolved : [];
  const ignored = Array.isArray(b.ignored) ? b.ignored : [];
  const lines = [`resolved ${resolved.length}, ignored ${ignored.length}`];
  for (const r of resolved) lines.push(`  ${r.outcome.padEnd(7)} ${r.ac_code}`);
  for (const i of ignored) {
    lines.push(`  ignored ${i.ac_code} (${i.reason}${i.status ? `: ${i.status}` : ""})`);
  }
  return lines;
}
