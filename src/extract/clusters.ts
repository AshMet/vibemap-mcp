/**
 * Feature clusters: route files grouped by their first URL segment, each
 * expanded through a static import walk (depth 2) and tagged with the tables
 * its files reference by name. Deterministic: the same tree always produces the
 * same clusters in the same order.
 */

import * as path from "node:path";
import type { RepoFactsCluster, RepoFactsRoute } from "./types.js";
import { cmp } from "./sql.js";

export const IMPORT_DEPTH = 2;
const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Module specifiers a file imports, re-exports, requires or imports dynamically. */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) out.add(m[1]);
  }
  return [...out];
}

/** tsconfig `paths` aliases, e.g. `@/*` -> `src/*`. Only wildcard aliases. */
export type Aliases = Array<{ prefix: string; target: string }>;

export function readAliases(tsconfigText: string | null): Aliases {
  if (!tsconfigText) return [];
  let cfg: any;
  try {
    // tsconfig allows comments and trailing commas.
    const clean = tsconfigText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    cfg = JSON.parse(clean);
  } catch {
    return [];
  }
  const baseUrl: string = cfg?.compilerOptions?.baseUrl ?? ".";
  const paths: Record<string, string[]> = cfg?.compilerOptions?.paths ?? {};
  const out: Aliases = [];
  for (const [key, targets] of Object.entries(paths)) {
    if (!key.endsWith("/*") || !Array.isArray(targets) || !targets[0]?.endsWith("/*")) continue;
    out.push({
      prefix: key.slice(0, -1),
      target: path.posix.normalize(path.posix.join(baseUrl, targets[0].slice(0, -1))).replace(/^\.\//, ""),
    });
  }
  return out.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function resolveImport(
  fromFile: string,
  spec: string,
  files: Set<string>,
  aliases: Aliases
): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else {
    for (const a of aliases) {
      if (spec.startsWith(a.prefix)) {
        base = path.posix.normalize(path.posix.join(a.target, spec.slice(a.prefix.length)));
        break;
      }
    }
  }
  if (base === null) return null;
  base = base.replace(/^\.\//, "");
  if (files.has(base)) return base;
  for (const ext of RESOLVE_EXTS) if (files.has(base + ext)) return base + ext;
  for (const ext of RESOLVE_EXTS) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

/** First static URL segment, ignoring a leading `api`; `/` is `home`. */
export function clusterIdFor(routePath: string): string {
  const segs = routePath.split("/").filter(Boolean);
  if (segs[0] === "api") segs.shift();
  const first = segs[0];
  if (!first) return "home";
  const id = first
    .replace(/^\[+(\.\.\.)?|\]+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "home";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tables a source file references by name: `.from("t")` query builders, and
 * Prisma client accessors (`prisma.post.findMany`) when `accessors` maps them.
 */
export function referencedTables(
  source: string,
  tableNames: string[],
  accessors: Map<string, string>
): string[] {
  const found = new Set<string>();
  for (const t of tableNames) {
    const bare = t.includes(".") ? t.split(".").pop() as string : t;
    const re = new RegExp(`\\.from\\(\\s*["'\`](?:${escapeRe(t)}|${escapeRe(bare)})["'\`]`);
    if (re.test(source)) found.add(t);
  }
  for (const [accessor, table] of accessors) {
    const re = new RegExp(`\\b\\w+\\.${escapeRe(accessor)}\\s*\\.\\s*(find|create|update|upsert|delete|count|aggregate|groupBy)`);
    if (re.test(source)) found.add(table);
  }
  return [...found].sort();
}

export function buildClusters(opts: {
  routes: RepoFactsRoute[];
  files: Set<string>;
  readFile: (rel: string) => string;
  aliases: Aliases;
  tableNames: string[];
  accessors: Map<string, string>;
}): RepoFactsCluster[] {
  const importCache = new Map<string, string[]>();
  const importsOf = (file: string): string[] => {
    let hit = importCache.get(file);
    if (!hit) {
      hit = importSpecifiers(opts.readFile(file))
        .map((s) => resolveImport(file, s, opts.files, opts.aliases))
        .filter((f): f is string => f !== null);
      importCache.set(file, hit);
    }
    return hit;
  };

  const byId = new Map<string, { files: Set<string>; routes: Set<string> }>();
  for (const route of opts.routes) {
    const id = clusterIdFor(route.path);
    const entry = byId.get(id) ?? { files: new Set<string>(), routes: new Set<string>() };
    entry.routes.add(route.path);
    let frontier = [route.file];
    entry.files.add(route.file);
    for (let depth = 0; depth < IMPORT_DEPTH; depth++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const dep of importsOf(f)) {
          if (!entry.files.has(dep)) {
            entry.files.add(dep);
            next.push(dep);
          }
        }
      }
      frontier = next;
    }
    byId.set(id, entry);
  }

  const tableCache = new Map<string, string[]>();
  const clusters: RepoFactsCluster[] = [];
  for (const [id, entry] of byId) {
    const tables = new Set<string>();
    for (const f of entry.files) {
      let refs = tableCache.get(f);
      if (!refs) {
        refs = referencedTables(opts.readFile(f), opts.tableNames, opts.accessors);
        tableCache.set(f, refs);
      }
      for (const t of refs) tables.add(t);
    }
    clusters.push({
      id,
      files: [...entry.files].sort(),
      route_paths: [...entry.routes].sort(),
      tables: [...tables].sort(),
    });
  }
  return clusters.sort((a, b) => cmp(a.id, b.id));
}
