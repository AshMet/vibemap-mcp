/**
 * Next.js route discovery for both routers.
 *
 * App router (`app/` or `src/app/`): `page.*` files are pages, `route.*` files
 * are API routes. Route groups `(name)` and parallel-route slots `@name` do not
 * add a URL segment; private folders `_name` are not routable; intercepting
 * routes (`(.)name`) are skipped because they render an existing URL.
 *
 * Pages router (`pages/` or `src/pages/`): every module is a page, `pages/api/**`
 * are API routes, `_app` / `_document` / `_error` / `_middleware` are not routes.
 */

import type { RepoFactsRoute } from "./types.js";
import { cmp } from "./sql.js";

const PAGE_EXT = /\.(tsx|ts|jsx|js|mdx|md)$/;
const MODULE_EXT = /\.(tsx|ts|jsx|js)$/;
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export function dynamicSegmentName(segment: string): string | null {
  const m = /^\[\[?(?:\.\.\.)?([^\]]+)\]\]?$/.exec(segment);
  return m ? m[1] : null;
}

/** HTTP methods an App-router route module exports, read statically. */
export function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  for (const m of HTTP_METHODS) {
    const fn = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`);
    const cnst = new RegExp(`export\\s+(?:const|let|var)\\s+${m}\\b`);
    const named = new RegExp(`export\\s*\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${m}\\b[^}]*\\}`);
    if (fn.test(source) || cnst.test(source) || named.test(source)) found.add(m);
  }
  return HTTP_METHODS.filter((m) => found.has(m));
}

function toRoute(
  segments: string[],
  kind: "page" | "api",
  file: string,
  methods?: string[]
): RepoFactsRoute {
  const path = `/${segments.join("/")}`;
  const route: RepoFactsRoute = {
    path: path === "/" ? "/" : path.replace(/\/$/, ""),
    kind,
    file,
    dynamic_segments: segments.map(dynamicSegmentName).filter((s): s is string => s !== null),
  };
  if (methods) route.methods = methods;
  return route;
}

/**
 * @param files repo-relative POSIX paths of every file under the router root
 * @param readFile reads a repo-relative file (used for API method detection)
 */
export function appRouterRoutes(
  root: string,
  files: string[],
  readFile: (rel: string) => string
): RepoFactsRoute[] {
  const routes: RepoFactsRoute[] = [];
  for (const file of files) {
    if (!file.startsWith(`${root}/`)) continue;
    const parts = file.slice(root.length + 1).split("/");
    const base = parts.pop() as string;
    const isPage = /^page\./.test(base) && PAGE_EXT.test(base);
    const isRoute = /^route\./.test(base) && MODULE_EXT.test(base);
    if (!isPage && !isRoute) continue;
    if (parts.some((p) => p.startsWith("_") || /^\(\.{1,3}\)/.test(p))) continue;
    const segments = parts.filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("@"));
    routes.push(
      isPage
        ? toRoute(segments, "page", file)
        : toRoute(segments, "api", file, exportedMethods(readFile(file)))
    );
  }
  return routes;
}

export function pagesRouterRoutes(root: string, files: string[]): RepoFactsRoute[] {
  const routes: RepoFactsRoute[] = [];
  for (const file of files) {
    if (!file.startsWith(`${root}/`)) continue;
    if (!PAGE_EXT.test(file)) continue;
    const rel = file.slice(root.length + 1).replace(PAGE_EXT, "");
    const parts = rel.split("/");
    if (parts.some((p) => p.startsWith("_"))) continue;
    if (parts[parts.length - 1] === "index") parts.pop();
    const kind = parts[0] === "api" ? "api" : "page";
    routes.push(toRoute(parts, kind, file));
  }
  return routes;
}

export function sortRoutes(routes: RepoFactsRoute[]): RepoFactsRoute[] {
  return [...routes].sort(
    (a, b) => cmp(a.path, b.path) || cmp(a.kind, b.kind) || cmp(a.file, b.file)
  );
}
