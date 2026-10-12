// `vibemap-mcp ci-report`: read a test report, tag results by acceptance
// criterion, and post them so every criterion under review is resolved from its
// own tests.
//
// Exit codes:  0 reported (or nothing to report, see --strict)
//              1 the API rejected the report, or it could not be reached
//              2 bad usage: missing token, project, run URL, or unreadable report
//              3 --strict and the report contained no tagged tests

import { readFileSync } from "node:fs";
import {
  parseJUnit,
  parsePlaywrightJson,
  parseVitestJson,
  type TestResult,
} from "./parse.js";
import { buildReport, summariseResponse } from "./report.js";

export const CI_REPORT_USAGE = `Usage: vibemap-mcp ci-report [options]

Reads test reports, picks out tests tagged with an acceptance criterion code
(for example "[AC-042] rejects an empty title") and posts their results.
A criterion in review is passed when all its tests passed, failed otherwise.

Reports (repeatable, at least one):
  --junit <file>        JUnit XML
  --vitest <file>       Vitest / Jest JSON (--reporter=json)
  --playwright <file>   Playwright JSON (--reporter=json)

Target (one of):
  --project <id>        Project id (or VIBEMAP_PROJECT_ID). Resolves every
                        criterion in review that the report mentions.
  --criterion <id>      Address one criterion; the report still resolves every
                        criterion in that criterion's project.

Options:
  --run-url <url>       Link to the CI run. Defaults to the GitHub Actions run.
  --sha <sha>           Tested commit. Defaults to the pull request head, then
                        GITHUB_SHA.
  --base-url <url>      Server (or VIBEMAP_BASE_URL). Default https://vibemap.ai
  --strict              Exit 3 when no test carries a criterion tag.
  --dry-run             Print the request body and exit without sending it.
  --help                Show this help.

Environment:
  VIBEMAP_CI_TOKEN      A CI-review-scoped token (required).
`;

interface Args {
  junit: string[];
  vitest: string[];
  playwright: string[];
  project?: string;
  criterion?: string;
  runUrl?: string;
  sha?: string;
  baseUrl?: string;
  strict: boolean;
  dryRun: boolean;
  help: boolean;
}

export class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "junit",
  "vitest",
  "playwright",
  "project",
  "criterion",
  "run-url",
  "sha",
  "base-url",
]);
const BOOL_FLAGS = new Set(["strict", "dry-run", "help"]);

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    junit: [],
    vitest: [],
    playwright: [],
    strict: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new UsageError(`Unexpected argument: ${token}`);
    const eq = token.indexOf("=");
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    if (BOOL_FLAGS.has(flag)) {
      if (eq !== -1) throw new UsageError(`--${flag} does not take a value`);
      if (flag === "strict") args.strict = true;
      else if (flag === "dry-run") args.dryRun = true;
      else args.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new UsageError(`Unknown option: --${flag}`);
    const value = eq !== -1 ? token.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "" || (eq === -1 && value.startsWith("--"))) {
      throw new UsageError(`--${flag} needs a value`);
    }
    switch (flag) {
      case "junit":
        args.junit.push(value);
        break;
      case "vitest":
        args.vitest.push(value);
        break;
      case "playwright":
        args.playwright.push(value);
        break;
      case "project":
        args.project = value;
        break;
      case "criterion":
        args.criterion = value;
        break;
      case "run-url":
        args.runUrl = value;
        break;
      case "sha":
        args.sha = value;
        break;
      case "base-url":
        args.baseUrl = value;
        break;
    }
  }
  return args;
}

/** The GitHub Actions run URL, when running inside one. */
export function githubRunUrl(env: NodeJS.ProcessEnv): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : undefined;
}

/** The tested commit: --sha, else a pull request's head, else GITHUB_SHA. */
export function resolveSha(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8")
): string | undefined {
  if (flag) return flag;
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFile(env.GITHUB_EVENT_PATH)) as {
        pull_request?: { head?: { sha?: unknown } };
      };
      const head = event.pull_request?.head?.sha;
      if (typeof head === "string" && head) return head;
    } catch {
      // fall through to GITHUB_SHA
    }
  }
  return env.GITHUB_SHA || undefined;
}

function readReports(args: Args, readFile: (path: string) => string): TestResult[] {
  const results: TestResult[] = [];
  const load = (file: string, parse: (text: string) => TestResult[]) => {
    let text: string;
    try {
      text = readFile(file);
    } catch (e) {
      throw new UsageError(`Cannot read ${file}: ${(e as Error).message}`);
    }
    try {
      results.push(...parse(text));
    } catch (e) {
      throw new UsageError(`Cannot parse ${file}: ${(e as Error).message}`);
    }
  };
  for (const f of args.junit) load(f, parseJUnit);
  for (const f of args.vitest) load(f, (t) => parseVitestJson(JSON.parse(t)));
  for (const f of args.playwright) load(f, (t) => parsePlaywrightJson(JSON.parse(t)));
  return results;
}

export interface RunDeps {
  env: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export async function runCiReport(argv: string[], deps: RunDeps): Promise<number> {
  const out = deps.out ?? ((l) => process.stdout.write(`${l}\n`));
  const err = deps.err ?? ((l) => process.stderr.write(`${l}\n`));
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const doFetch = deps.fetchImpl ?? fetch;
  const env = deps.env;

  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`ci-report: ${(e as Error).message}\n\n${CI_REPORT_USAGE}`);
    return 2;
  }
  if (args.help) {
    out(CI_REPORT_USAGE);
    return 0;
  }

  const token = env.VIBEMAP_CI_TOKEN?.trim();
  const projectId = args.project ?? env.VIBEMAP_PROJECT_ID?.trim();
  const runUrl = args.runUrl ?? githubRunUrl(env);
  const reportCount = args.junit.length + args.vitest.length + args.playwright.length;

  const problems: string[] = [];
  if (!args.dryRun && !token) problems.push("VIBEMAP_CI_TOKEN is not set");
  if (reportCount === 0) problems.push("give at least one of --junit, --vitest, --playwright");
  if (!projectId && !args.criterion) {
    problems.push("give --project (or VIBEMAP_PROJECT_ID), or --criterion");
  }
  if (!runUrl) problems.push("no run URL: pass --run-url (it is automatic on GitHub Actions)");
  if (problems.length > 0) {
    err(`ci-report: ${problems.join("; ")}\n\n${CI_REPORT_USAGE}`);
    return 2;
  }

  let results: TestResult[];
  try {
    results = readReports(args, readFile);
  } catch (e) {
    err(`ci-report: ${(e as Error).message}`);
    return 2;
  }

  let built: ReturnType<typeof buildReport>;
  try {
    built = buildReport(results, {
      runUrl: runUrl as string,
      sha: resolveSha(args.sha, env, readFile),
    });
  } catch (e) {
    err(`ci-report: ${(e as Error).message}`);
    return 2;
  }
  out(
    `ci-report: ${results.length} tests, ${built.tagged} tagged, ` +
      `${built.codes.length} criteria (${built.payload.outcome})`
  );

  if (built.tagged === 0) {
    err(
      "ci-report: no test name carries a criterion tag like [AC-042]; nothing to report. " +
        "Start each test name with the criterion it proves."
    );
    return args.strict ? 3 : 0;
  }

  if (args.dryRun) {
    out(JSON.stringify(built.payload, null, 2));
    return 0;
  }

  const base = (args.baseUrl ?? env.VIBEMAP_BASE_URL ?? "https://vibemap.ai").replace(/\/+$/, "");
  const url = args.criterion
    ? `${base}/api/mcp/kanban/criterion/${encodeURIComponent(args.criterion)}/ci-result`
    : `${base}/api/mcp/kanban/projects/${encodeURIComponent(projectId as string)}/ci-result`;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(built.payload),
    });
  } catch (e) {
    err(`ci-report: could not reach ${base}: ${(e as Error).message}`);
    return 1;
  }

  let body: unknown;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; issues?: Array<{ path?: unknown[]; message?: string }> };
    const issues = Array.isArray(b.issues)
      ? ` (${b.issues
          .slice(0, 5)
          .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message ?? ""}`)
          .join("; ")})`
      : "";
    err(`ci-report: rejected with HTTP ${res.status}: ${b.error ?? (text.slice(0, 200) || "no detail")}${issues}`);
    return 1;
  }

  for (const line of summariseResponse(body)) out(line);
  return 0;
}
