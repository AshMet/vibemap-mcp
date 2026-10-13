/**
 * Deterministic repository fact extraction.
 *
 * `extractRepoFacts(dir)` reads a checkout from disk and returns its RepoFacts:
 * tables and row-level security policies (from SQL migrations or a Prisma
 * schema), Next.js routes, and route-based file clusters. No network access, no
 * model calls, no shelling out: the same tree always yields the same facts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildClusters, readAliases } from "./clusters.js";
import { appRouterRoutes, pagesRouterRoutes, sortRoutes } from "./next-routes.js";
import { readPrismaSchema } from "./prisma.js";
import { applyMigration, cmp, emptySchemaState, finishSchema } from "./sql.js";
import {
  type Database,
  type Framework,
  REPO_FACTS_VERSION,
  type RepoFacts,
  type RepoFactsTable,
  type RepoFactsWarning,
} from "./types.js";

export * from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
]);

/** Directories whose `.sql` files are read as ordered migrations. */
export const MIGRATION_DIRS = [
  "supabase/migrations",
  "migrations",
  "db/migrations",
  "database/migrations",
  "sql/migrations",
  "prisma/migrations",
];

export const MAX_FILES = 50_000;

/** Every file under `dir`, repo-relative with POSIX separators, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(child);
      } else if (e.isFile()) {
        out.push(child);
      }
    }
  };
  walk("");
  return out.sort();
}

/** HEAD commit of a git checkout, read from `.git` files; null when unavailable. */
export function readCommitSha(dir: string): string | null {
  try {
    let gitDir = path.join(dir, ".git");
    if (fs.statSync(gitDir).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(gitDir, "utf8"));
      if (!m) return null;
      gitDir = path.resolve(dir, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return null;
    // Linked worktrees keep refs in the common dir.
    const common = fs.existsSync(path.join(gitDir, "commondir"))
      ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim())
      : gitDir;
    for (const base of [gitDir, common]) {
      const loose = path.join(base, ref);
      if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim();
    }
    const packed = path.join(common, "packed-refs");
    if (fs.existsSync(packed)) {
      for (const line of fs.readFileSync(packed, "utf8").split("\n")) {
        const [sha, name] = line.trim().split(" ");
        if (name === ref && /^[0-9a-f]{40}$/.test(sha)) return sha;
      }
    }
  } catch {
    // Not a git checkout.
  }
  return null;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hasDep(pkg: any, name: string): boolean {
  return !!(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}

export function extractRepoFacts(dir: string): RepoFacts {
  const root = path.resolve(dir);
  const files = listFiles(root);
  const fileSet = new Set(files);
  const contents = new Map<string, string>();
  const readFile = (rel: string): string => {
    let hit = contents.get(rel);
    if (hit === undefined) {
      try {
        hit = fs.readFileSync(path.join(root, rel), "utf8");
      } catch {
        hit = "";
      }
      contents.set(rel, hit);
    }
    return hit;
  };
  const warnings: RepoFactsWarning[] = [];
  const pkg = readJson(path.join(root, "package.json"));

  // ── Schema ────────────────────────────────────────────────────────────────
  const prismaFiles = files.filter(
    (f) => /(^|\/)schema\.prisma$/.test(f) || /^prisma\/schema\/[^/]+\.prisma$/.test(f)
  );
  let db: Database = "unknown";
  let prismaTables: RepoFactsTable[] = [];
  let accessors = new Map<string, string>();
  for (const f of prismaFiles) {
    const r = readPrismaSchema(readFile(f), f);
    prismaTables = [...prismaTables, ...r.tables];
    accessors = new Map([...accessors, ...r.accessors]);
    warnings.push(...r.warnings);
    if (r.db !== "unknown") db = r.db;
  }
  const usePrisma = prismaFiles.length > 0;

  const migrationFiles = files.filter(
    (f) =>
      f.endsWith(".sql") &&
      MIGRATION_DIRS.some((d) => f.startsWith(`${d}/`)) &&
      // A Prisma schema is the source of truth for its own generated migrations.
      !(usePrisma && f.startsWith("prisma/migrations/"))
  );
  const state = emptySchemaState();
  for (const f of migrationFiles) applyMigration(state, f, readFile(f));
  warnings.push(...state.warnings);
  const sql = finishSchema(state);
  if (migrationFiles.length > 0 && db === "unknown") db = "postgres";
  if (db === "unknown" && (hasDep(pkg, "@supabase/supabase-js") || hasDep(pkg, "pg"))) db = "postgres";

  const prismaNames = new Set(prismaTables.map((t) => t.name));
  const tables = [...prismaTables, ...sql.tables.filter((t) => !prismaNames.has(t.name))].sort(
    (a, b) => cmp(a.name, b.name)
  );

  // ── Routes ────────────────────────────────────────────────────────────────
  const routes = sortRoutes([
    ...["app", "src/app"].flatMap((r) => appRouterRoutes(r, files, readFile)),
    ...["pages", "src/pages"].flatMap((r) => pagesRouterRoutes(r, files)),
  ]);
  let framework: Framework = "unknown";
  if (hasDep(pkg, "next") || files.some((f) => /^next\.config\.(js|mjs|cjs|ts)$/.test(f))) {
    framework = "nextjs";
  }

  // ── Clusters ──────────────────────────────────────────────────────────────
  const tsconfig = fileSet.has("tsconfig.json")
    ? readFile("tsconfig.json")
    : fileSet.has("jsconfig.json")
      ? readFile("jsconfig.json")
      : null;
  const clusters = buildClusters({
    routes,
    files: fileSet,
    readFile,
    aliases: readAliases(tsconfig),
    tableNames: tables.map((t) => t.name),
    accessors,
  });

  const facts: RepoFacts = {
    version: REPO_FACTS_VERSION,
    commit_sha: readCommitSha(root),
    stack: usePrisma ? { framework, db, orm: "prisma" } : { framework, db },
    tables,
    policies: sql.policies,
    routes,
    clusters,
    warnings,
  };
  return facts;
}
