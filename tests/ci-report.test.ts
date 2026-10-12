import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  decodeXmlEntities,
  parseJUnit,
  parsePlaywrightJson,
  parseVitestJson,
} from "../src/ci-report/parse.js";
import { buildReport, extractAcCodes, MAX_PER_TEST, summariseResponse } from "../src/ci-report/report.js";
import { githubRunUrl, parseArgs, resolveSha, runCiReport } from "../src/ci-report/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", "ci-report", name);
const read = (name: string) => readFileSync(fixture(name), "utf8");

const byName = (rs: Array<{ name: string; outcome: string }>) =>
  Object.fromEntries(rs.map((r) => [r.name, r.outcome]));

// ── parsers ──────────────────────────────────────────────────────────────────

describe("parseJUnit", () => {
  const results = parseJUnit(read("junit.xml"));
  const o = byName(results);

  it("finds every real test case, including self-closing ones", () => {
    expect(results).toHaveLength(9);
  });

  it("decodes entities in names", () => {
    expect(o["title > [AC-042] rejects an empty title"]).toBe("passed");
    expect(o["title > [AC-042] trims & collapses spaces"]).toBe("passed");
    expect(o[`[AC-052] 'quoted' "name" A`]).toBe("passed");
  });

  it("maps failure and error to failed, skipped to skipped", () => {
    expect(o["title > [AC-043] caps length at 80"]).toBe("failed");
    expect(o["[AC-051] throws on bad input"]).toBe("failed");
    expect(o["title > [AC-046] not built yet"]).toBe("skipped");
  });

  it("treats a flaky test that eventually passed as passed", () => {
    expect(o["[AC-050] recovers after a retry"]).toBe("passed");
  });

  it("ignores test-case-looking text inside CDATA, process output and comments", () => {
    const names = results.map((r) => r.name).join("\n");
    expect(names).not.toContain("AC-999");
    expect(names).not.toContain("AC-998");
    expect(names).not.toContain("AC-997");
  });

  it("returns [] for a document with no test cases", () => {
    expect(parseJUnit("<testsuites/>")).toEqual([]);
    expect(parseJUnit("")).toEqual([]);
  });

  it("does not let a failed test be downgraded by a later skipped child", () => {
    const xml = '<testcase name="x"><failure/><skipped/></testcase>';
    expect(parseJUnit(xml)).toEqual([{ name: "x", outcome: "failed" }]);
  });

  it("handles single-quoted attributes and > inside attribute values", () => {
    const xml = `<testcase name='a > b [AC-001]' classname="c"/>`;
    expect(parseJUnit(xml)).toEqual([{ name: "a > b [AC-001]", outcome: "passed" }]);
  });

  it("keeps a test case that is never closed rather than dropping it", () => {
    expect(parseJUnit('<testcase name="open"><failure/>')).toEqual([
      { name: "open", outcome: "failed" },
    ]);
  });
});

describe("decodeXmlEntities", () => {
  it("decodes named, decimal and hex references and leaves unknown ones", () => {
    expect(decodeXmlEntities("&lt;&amp;&#65;&#x42;&nope;")).toBe("<&AB&nope;");
  });
  it("survives an out-of-range code point", () => {
    expect(decodeXmlEntities("&#99999999999;")).toBe("&#99999999999;");
  });
});

describe("parseVitestJson", () => {
  const o = byName(parseVitestJson(JSON.parse(read("vitest.json"))));
  it("maps statuses", () => {
    expect(o["title [AC-042] rejects an empty title"]).toBe("passed");
    expect(o["title [AC-043] caps length at 80"]).toBe("failed");
    expect(o["title untagged"]).toBe("skipped");
  });
  it("builds a name from ancestors and title when fullName is absent", () => {
    expect(o["title [AC-046] not built yet"]).toBe("skipped");
  });
  it("rejects a document that is not a report", () => {
    expect(() => parseVitestJson({})).toThrow(/testResults/);
    expect(() => parseVitestJson(null)).toThrow();
  });
});

describe("parsePlaywrightJson", () => {
  const o = byName(parsePlaywrightJson(JSON.parse(read("playwright.json"))));
  it("names a test from its describe titles, not the file", () => {
    expect(Object.keys(o)).toContain("checkout [AC-060] pays by card");
    expect(Object.keys(o)).toContain("[AC-064] top level");
  });
  it("maps unexpected to failed, flaky to passed, skipped to skipped", () => {
    expect(o["checkout [AC-061] shows the receipt"]).toBe("failed");
    expect(o["checkout [AC-062] retries once"]).toBe("passed");
    expect(o["checkout [AC-063] later"]).toBe("skipped");
  });
  it("rejects a document that is not a report", () => {
    expect(() => parsePlaywrightJson({})).toThrow(/suites/);
  });
});

// ── tags and payload ─────────────────────────────────────────────────────────

describe("extractAcCodes", () => {
  it("reads one or several bracketed codes", () => {
    expect(extractAcCodes("[AC-042] rejects")).toEqual(["AC-042"]);
    expect(extractAcCodes("[AC-042] [AC-1000] both")).toEqual(["AC-042", "AC-1000"]);
  });
  it("de-duplicates", () => {
    expect(extractAcCodes("[AC-042] and again [AC-042]")).toEqual(["AC-042"]);
  });
  it("ignores anything that is not a well-formed code", () => {
    expect(extractAcCodes("AC-042 no brackets")).toEqual([]);
    expect(extractAcCodes("[AC-42] too short")).toEqual([]);
    expect(extractAcCodes("[ac-042] lowercase")).toEqual([]);
    expect(extractAcCodes("[AC-04X] letters")).toEqual([]);
    expect(extractAcCodes("[XAC-042] prefix")).toEqual([]);
  });
  it("is stateless across calls (global regex)", () => {
    expect(extractAcCodes("[AC-001]")).toEqual(["AC-001"]);
    expect(extractAcCodes("[AC-001]")).toEqual(["AC-001"]);
  });
});

describe("buildReport", () => {
  const results = parseJUnit(read("junit.xml"));
  const built = buildReport(results, {
    runUrl: "https://ci.example.com/runs/1",
    sha: "abc1234def",
  });

  it("sends only tagged tests", () => {
    expect(built.total).toBe(9);
    expect(built.tagged).toBe(8);
    expect(built.payload.per_test.map((t) => t.name)).not.toContain("title > untagged helper test");
  });

  it("collects the distinct codes, sorted", () => {
    expect(built.codes).toEqual([
      "AC-042", "AC-043", "AC-044", "AC-045", "AC-046", "AC-050", "AC-051", "AC-052",
    ]);
  });

  it("tags a multi-code test with every code", () => {
    const t = built.payload.per_test.find((p) => p.name.includes("shared helper"));
    expect(t?.ac_codes).toEqual(["AC-044", "AC-045"]);
  });

  it("marks the run failed when any test failed", () => {
    expect(built.payload.outcome).toBe("failed");
    expect(
      buildReport([{ name: "[AC-001] ok", outcome: "passed" }], { runUrl: "https://x.test/r" })
        .payload.outcome
    ).toBe("passed");
  });

  it("carries the run URL and sha, and omits a too-short sha", () => {
    expect(built.payload.test_run_url).toBe("https://ci.example.com/runs/1");
    expect(built.payload.git_sha).toBe("abc1234def");
    const noSha = buildReport([], { runUrl: "https://x.test/r", sha: "abc" });
    expect("git_sha" in noSha.payload).toBe(false);
  });

  it("truncates a very long name to what the server accepts", () => {
    const b = buildReport([{ name: `[AC-001] ${"x".repeat(900)}`, outcome: "passed" }], {
      runUrl: "https://x.test/r",
    });
    expect(b.payload.per_test[0].name).toHaveLength(500);
  });

  it("refuses a report larger than one request can carry", () => {
    const many = Array.from({ length: MAX_PER_TEST + 1 }, (_, i) => ({
      name: `[AC-001] t${i}`,
      outcome: "passed" as const,
    }));
    expect(() => buildReport(many, { runUrl: "https://x.test/r" })).toThrow(/exceed/);
  });
});

describe("summariseResponse", () => {
  it("lists resolved and ignored criteria", () => {
    expect(
      summariseResponse({
        resolved: [{ ac_code: "AC-001", outcome: "passed" }],
        ignored: [{ ac_code: "AC-002", reason: "not_in_review", status: "ready" }],
      })
    ).toEqual([
      "resolved 1, ignored 1",
      "  passed  AC-001",
      "  ignored AC-002 (not_in_review: ready)",
    ]);
  });
  it("tolerates an empty or odd body", () => {
    expect(summariseResponse(undefined)).toEqual(["resolved 0, ignored 0"]);
    expect(summariseResponse({ resolved: "x" })).toEqual(["resolved 0, ignored 0"]);
  });
});

// ── environment helpers ──────────────────────────────────────────────────────

describe("githubRunUrl / resolveSha", () => {
  it("builds the Actions run URL only when all three variables exist", () => {
    expect(
      githubRunUrl({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "77",
      })
    ).toBe("https://github.com/o/r/actions/runs/77");
    expect(githubRunUrl({ GITHUB_SERVER_URL: "https://github.com" })).toBeUndefined();
  });

  it("prefers the flag, then the pull request head, then GITHUB_SHA", () => {
    const readEvent = () => JSON.stringify({ pull_request: { head: { sha: "headsha1234" } } });
    const env = { GITHUB_EVENT_PATH: "/e.json", GITHUB_SHA: "mergesha123" };
    expect(resolveSha("flagsha1234", env, readEvent)).toBe("flagsha1234");
    expect(resolveSha(undefined, env, readEvent)).toBe("headsha1234");
    expect(resolveSha(undefined, env, () => "{}")).toBe("mergesha123");
    expect(
      resolveSha(undefined, env, () => {
        throw new Error("nope");
      })
    ).toBe("mergesha123");
    expect(resolveSha(undefined, {}, readEvent)).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("accepts both --flag value and --flag=value, repeatable report flags", () => {
    const a = parseArgs(["--junit", "a.xml", "--junit=b.xml", "--project=p", "--strict"]);
    expect(a.junit).toEqual(["a.xml", "b.xml"]);
    expect(a.project).toBe("p");
    expect(a.strict).toBe(true);
  });
  it("rejects unknown options, stray arguments and missing values", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["stray"])).toThrow(/Unexpected/);
    expect(() => parseArgs(["--junit"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--junit", "--project", "p"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--strict=yes"])).toThrow(/does not take a value/);
  });
});

// ── the command ──────────────────────────────────────────────────────────────

const PROJECT = "11111111-1111-4111-8111-111111111111";
const baseEnv = {
  VIBEMAP_CI_TOKEN: "ci-secret-token",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/app",
  GITHUB_RUN_ID: "4242",
  GITHUB_SHA: "deadbeefcafe",
  VIBEMAP_BASE_URL: "https://vibemap.test",
};

function harness(env: Record<string, string> = baseEnv, response?: Response | Error) {
  const out: string[] = [];
  const errLines: string[] = [];
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return (
      response ??
      new Response(
        JSON.stringify({
          resolved: [{ ac_code: "AC-042", outcome: "passed" }],
          ignored: [{ ac_code: "AC-043", reason: "not_in_review", status: "ready" }],
        }),
        { status: 200 }
      )
    );
  });
  const run = (argv: string[]) =>
    runCiReport(argv, {
      env: env as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      out: (l) => out.push(l),
      err: (l) => errLines.push(l),
    });
  return { run, out, errLines, fetchImpl };
}

describe("runCiReport", () => {
  const junit = fixture("junit.xml");

  it("posts the tagged results to the project endpoint with the CI token", async () => {
    const h = harness();
    const code = await h.run(["--junit", junit, "--project", PROJECT]);
    expect(code).toBe(0);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://vibemap.test/api/mcp/kanban/projects/${PROJECT}/ci-result`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ci-secret-token");
    const body = JSON.parse(init.body as string);
    expect(body.test_run_url).toBe("https://github.com/acme/app/actions/runs/4242");
    expect(body.git_sha).toBe("deadbeefcafe");
    expect(body.per_test).toHaveLength(8);
    expect(h.out.join("\n")).toContain("resolved 1, ignored 1");
  });

  it("never prints the token", async () => {
    const h = harness();
    await h.run(["--junit", junit, "--project", PROJECT]);
    expect([...h.out, ...h.errLines].join("\n")).not.toContain("ci-secret-token");
  });

  it("addresses one criterion when --criterion is given", async () => {
    const h = harness();
    await h.run(["--junit", junit, "--criterion", "22222222-2222-4222-8222-222222222222"]);
    expect((h.fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://vibemap.test/api/mcp/kanban/criterion/22222222-2222-4222-8222-222222222222/ci-result"
    );
  });

  it("reads the project from VIBEMAP_PROJECT_ID and the run URL from --run-url", async () => {
    const h = harness({ VIBEMAP_CI_TOKEN: "t", VIBEMAP_PROJECT_ID: PROJECT });
    const code = await h.run(["--junit", junit, "--run-url", "https://ci.example.com/9"]);
    expect(code).toBe(0);
    const [url, init] = h.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://vibemap.ai/api/mcp/kanban/projects/${PROJECT}/ci-result`);
    expect(JSON.parse(init.body as string).test_run_url).toBe("https://ci.example.com/9");
  });

  it("merges several report files and formats", async () => {
    const h = harness();
    await h.run([
      "--junit", junit,
      "--vitest", fixture("vitest.json"),
      "--playwright", fixture("playwright.json"),
      "--project", PROJECT,
    ]);
    const body = JSON.parse((h.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const codes = new Set(body.per_test.flatMap((t: { ac_codes: string[] }) => t.ac_codes));
    expect(codes.has("AC-042")).toBe(true);
    expect(codes.has("AC-060")).toBe(true);
    expect(codes.has("AC-064")).toBe(true);
  });

  it("exits non-zero when the API rejects the report", async () => {
    const h = harness(
      baseEnv,
      new Response(JSON.stringify({ error: "agents_cannot_self_resolve" }), { status: 403 })
    );
    expect(await h.run(["--junit", junit, "--project", PROJECT])).toBe(1);
    expect(h.errLines.join("\n")).toContain("HTTP 403");
    expect(h.errLines.join("\n")).toContain("agents_cannot_self_resolve");
  });

  it("shows validation detail on a 422", async () => {
    const h = harness(
      baseEnv,
      new Response(
        JSON.stringify({
          error: "invalid_payload",
          issues: [{ path: ["per_test", 0, "ac_codes", 0], message: "expected an AC code" }],
        }),
        { status: 422 }
      )
    );
    expect(await h.run(["--junit", junit, "--project", PROJECT])).toBe(1);
    expect(h.errLines.join("\n")).toContain("per_test.0.ac_codes.0: expected an AC code");
  });

  it("exits non-zero on a non-JSON error body (a proxy page)", async () => {
    const h = harness(baseEnv, new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await h.run(["--junit", junit, "--project", PROJECT])).toBe(1);
  });

  it("exits non-zero when the server cannot be reached", async () => {
    const h = harness(baseEnv, new Error("ECONNREFUSED"));
    expect(await h.run(["--junit", junit, "--project", PROJECT])).toBe(1);
    expect(h.errLines.join("\n")).toContain("ECONNREFUSED");
  });

  it("exits 2 without calling the API when the token, report, target or run URL is missing", async () => {
    const noToken = harness({ ...baseEnv, VIBEMAP_CI_TOKEN: "" });
    expect(await noToken.run(["--junit", junit, "--project", PROJECT])).toBe(2);
    expect(noToken.errLines.join("\n")).toContain("VIBEMAP_CI_TOKEN");

    const noReport = harness();
    expect(await noReport.run(["--project", PROJECT])).toBe(2);

    const noTarget = harness();
    expect(await noTarget.run(["--junit", junit])).toBe(2);

    const noRun = harness({ VIBEMAP_CI_TOKEN: "t" });
    expect(await noRun.run(["--junit", junit, "--project", PROJECT])).toBe(2);

    for (const h of [noToken, noReport, noTarget, noRun]) {
      expect(h.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("exits 2 for an unreadable or malformed report", async () => {
    const h = harness();
    expect(await h.run(["--junit", "/nonexistent/report.xml", "--project", PROJECT])).toBe(2);
    expect(await h.run(["--vitest", junit, "--project", PROJECT])).toBe(2); // XML given as JSON
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("exits 2 for bad options", async () => {
    const h = harness();
    expect(await h.run(["--bogus"])).toBe(2);
  });

  it("reports nothing and exits 0 when no test is tagged; --strict makes it 3", async () => {
    const h = harness();
    const run = (extra: string[]) =>
      runCiReport(["--junit", "u.xml", "--project", PROJECT, ...extra], {
        env: baseEnv as NodeJS.ProcessEnv,
        readFile: () => '<testcase name="plain test"/>',
        fetchImpl: h.fetchImpl as unknown as typeof fetch,
        out: () => undefined,
        err: (l) => h.errLines.push(l),
      });
    expect(await run([])).toBe(0);
    expect(await run(["--strict"])).toBe(3);
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.errLines.join("\n")).toContain("[AC-042]");
  });

  it("--dry-run prints the body, sends nothing, and needs no token", async () => {
    const h = harness({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "a/b", GITHUB_RUN_ID: "1" });
    expect(await h.run(["--junit", junit, "--project", PROJECT, "--dry-run"])).toBe(0);
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.out.join("\n")).toContain('"per_test"');
  });

  it("--help prints usage and exits 0", async () => {
    const h = harness();
    expect(await h.run(["--help"])).toBe(0);
    expect(h.out.join("\n")).toContain("Usage: vibemap-mcp ci-report");
  });
});
