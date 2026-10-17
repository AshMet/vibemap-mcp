/**
 * A structural code map built from RepoFacts alone: one node per route file and
 * one per table, and a `reads` edge from each route to the tables in its
 * cluster. Deterministic (the same facts give the same map), file paths only.
 *
 * VibeMap tracks code drift against the project's code map, so an imported
 * project needs one before changed files can be reported. The shape and limits
 * match `vibemap_submit_code_map`.
 */

import type { RepoFacts } from "../extract/types.js";

export const MAX_MAP_NODES = 500;
export const MAX_MAP_EDGES = 2000;

export interface FactsMapNode {
  id: string;
  label: string;
  kind: "page" | "api" | "model";
  path: string;
  layer: "ui" | "api" | "data";
  summary?: string;
}

export interface FactsMapEdge {
  source: string;
  target: string;
  kind: "reads";
}

export interface FactsCodeMap {
  nodes: FactsMapNode[];
  edges: FactsMapEdge[];
  stats: { totalFiles: number };
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

export const tableNodeId = (sourceFile: string, table: string) => `${sourceFile}#${table}`;

/** Null when the facts hold no route and no table (a map needs one node). */
export function factsToCodeMap(facts: RepoFacts): FactsCodeMap | null {
  const nodes: FactsMapNode[] = [];
  const ids = new Set<string>();
  const push = (n: FactsMapNode) => {
    if (ids.has(n.id) || nodes.length >= MAX_MAP_NODES) return;
    ids.add(n.id);
    nodes.push(n);
  };

  // Routes first: they are what a person recognises, and they carry the edges.
  for (const r of facts.routes) {
    const methods = r.methods?.length ? ` (${r.methods.join(", ")})` : "";
    push({
      id: clip(r.file, 300),
      label: clip(r.path, 120),
      kind: r.kind === "api" ? "api" : "page",
      path: r.file,
      layer: r.kind === "api" ? "api" : "ui",
      summary: clip(`${r.kind === "api" ? "API route" : "Page"} ${r.path}${methods}`, 500),
    });
  }
  const tableIds = new Map<string, string>();
  for (const t of facts.tables) {
    const id = clip(tableNodeId(t.source_file, t.name), 300);
    tableIds.set(t.name, id);
    push({
      id,
      label: clip(t.name, 120),
      kind: "model",
      path: t.source_file,
      layer: "data",
      summary: clip(`Table ${t.name}, ${t.columns.length} columns`, 500),
    });
  }
  if (nodes.length === 0) return null;

  const routeFile = new Map(facts.routes.map((r) => [r.path, r.file]));
  const edges: FactsMapEdge[] = [];
  const seen = new Set<string>();
  for (const c of facts.clusters) {
    for (const p of c.route_paths) {
      const source = routeFile.get(p);
      if (!source || !ids.has(source)) continue;
      for (const table of c.tables) {
        const target = tableIds.get(table);
        if (!target || !ids.has(target)) continue;
        const key = `${source}\u0000${target}`;
        if (seen.has(key) || edges.length >= MAX_MAP_EDGES) continue;
        seen.add(key);
        edges.push({ source, target, kind: "reads" });
      }
    }
  }

  return { nodes, edges, stats: { totalFiles: factsFiles(facts).size } };
}

/** Every repo-relative path the facts mention: the files `sourceFiles` may cite. */
export function factsFiles(facts: RepoFacts): Set<string> {
  const out = new Set<string>();
  for (const t of facts.tables) out.add(t.source_file);
  for (const p of facts.policies) out.add(p.source_file);
  for (const r of facts.routes) out.add(r.file);
  for (const c of facts.clusters) for (const f of c.files) out.add(f);
  return out;
}
