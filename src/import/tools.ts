/**
 * The import tools: read a repository's structural facts on this machine, send
 * them to a VibeMap project, add the spec the agent writes from them, finish the
 * import, and keep the project in step with later commits.
 *
 * File contents never leave the machine. What is sent is the RepoFacts (table,
 * column, policy and route definitions with their file paths), a structural map
 * built from them (file paths only), and the spec text the agent writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { extractRepoFacts } from "../extract/index.js";
import type { RepoFacts } from "../extract/types.js";
import type { VibeMapClient } from "../vibe-client.js";
import { factsToCodeMap, isFactsDerivedMap } from "./code-map.js";

/** Below the hosting platform's 4.5 MB request body limit. */
export const MAX_FACTS_BYTES = 4_000_000;

/** A clear error before sending, instead of an opaque 413 from the host. */
export function assertFactsFit(facts: RepoFacts): void {
  const bytes = Buffer.byteLength(JSON.stringify(facts), "utf8");
  if (bytes > MAX_FACTS_BYTES) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `The repository's facts are too large to send in one request (${Math.round(bytes / 1e6)} MB, limit ${MAX_FACTS_BYTES / 1e6} MB). ` +
        "Point localPath at the application's own folder rather than a monorepo root."
    );
  }
}

export const IMPORT_TOOL_NAMES = [
  "vibemap_extract_repo_facts",
  "vibemap_import_facts",
  "vibemap_import_semantic",
  "vibemap_finalize_import",
  "vibemap_resync",
  "vibemap_resolve_drift",
  "vibemap_resolve_code_drift_proposal",
] as const;

type ImportClient = Pick<
  VibeMapClient,
  | "importFacts"
  | "importSemantic"
  | "finalizeImport"
  | "resyncImport"
  | "getCodeMap"
  | "submitCodeMap"
  | "reportDriftChanges"
  | "resolveDrift"
  | "resolveCodeDriftProposal"
>;

const LocalPath = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Absolute path to the repository; defaults to the directory the server runs in");
const ProjectId = z.string().min(1, "projectId is required");
const Paths = z.array(z.string().min(1).max(500)).max(2000);

const ExtractSchema = z.object({ localPath: LocalPath });
const ImportFactsSchema = z.object({ projectId: ProjectId, localPath: LocalPath });
// The server validates every item; this only keeps an empty call from leaving.
const ImportSemanticSchema = z.object({
  projectId: ProjectId,
  features: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});
const FinalizeSchema = z.object({ projectId: ProjectId });
const ResyncSchema = z.object({
  projectId: ProjectId,
  localPath: LocalPath,
  changedFiles: Paths.optional(),
  diffExcerpt: z.string().max(20000).optional(),
});
const ResolveDriftSchema = z
  .object({
    projectId: ProjectId,
    files: Paths.optional(),
    nodeIds: z.array(z.string().min(1).max(200)).max(500).optional(),
    criterionIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  })
  .refine(
    (d) => (d.files?.length ?? 0) + (d.nodeIds?.length ?? 0) + (d.criterionIds?.length ?? 0) > 0,
    { message: "name at least one file, nodeId or criterionId to resolve" }
  );
const ResolveProposalSchema = z.object({
  projectId: ProjectId,
  // Any 8-4-4-4-12 hex id, as the server accepts (not only RFC version 1-8).
  proposalId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "proposalId must be a UUID"),
  decision: z.enum(["apply", "dismiss"]),
});

/** Resolves and checks the repository directory; never reads outside it. */
export function resolveRepoDir(localPath: string | undefined, cwd = process.cwd()): string {
  const dir = path.resolve(cwd, localPath ?? ".");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `localPath does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new McpError(ErrorCode.InvalidParams, `localPath is not a directory: ${dir}`);
  }
  return dir;
}

/** What the agent needs to write the spec, without the full SQL of every policy. */
export function summarizeFacts(dir: string, facts: RepoFacts) {
  return {
    localPath: dir,
    commitSha: facts.commit_sha,
    stack: facts.stack,
    counts: {
      tables: facts.tables.length,
      policies: facts.policies.length,
      routes: facts.routes.length,
      clusters: facts.clusters.length,
      warnings: facts.warnings.length,
    },
    clusters: facts.clusters.map((c) => ({
      id: c.id,
      routePaths: c.route_paths,
      tables: c.tables,
      files: c.files,
    })),
    tables: facts.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => c.name),
      sourceFile: t.source_file,
    })),
    routes: facts.routes.map((r) => ({
      path: r.path,
      kind: r.kind,
      methods: r.methods,
      file: r.file,
    })),
    warnings: facts.warnings.slice(0, 20),
  };
}

/**
 * Give the project a structural map when it has none, so changed files can be
 * tracked against it later. A project that already has a map keeps it: the
 * user may have curated it.
 */
export async function ensureCodeMap(
  client: ImportClient,
  projectId: string,
  facts: RepoFacts,
  opts: { refresh?: boolean } = {}
): Promise<{ status: "created" | "refreshed" | "exists" | "skipped" | "failed"; error?: string }> {
  try {
    const current = (await client.getCodeMap(projectId)) as { codeMap?: { map?: unknown } | null };
    const map = factsToCodeMap(facts);
    if (current?.codeMap) {
      // Only a map built from facts is rebuilt; a hand-built one is the user's.
      const stale =
        opts.refresh &&
        map &&
        isFactsDerivedMap(current.codeMap.map) &&
        JSON.stringify({ n: (current.codeMap.map as { nodes?: unknown }).nodes, e: (current.codeMap.map as { edges?: unknown }).edges }) !==
          JSON.stringify({ n: map.nodes, e: map.edges });
      if (!stale) return { status: "exists" };
    }
    if (!map) return { status: "skipped" };
    await client.submitCodeMap(projectId, map as unknown as Record<string, unknown>, {
      ...(facts.commit_sha ? { commitSha: facts.commit_sha } : {}),
      scannedAt: new Date().toISOString(),
    });
    return { status: current?.codeMap ? "refreshed" : "created" };
  } catch (err) {
    // The import itself already landed; a missing map only delays drift tracking.
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export async function handleImportTool(
  name: string,
  args: unknown,
  getClient: () => ImportClient
): Promise<ReturnType<typeof text> | null> {
  switch (name) {
    case "vibemap_extract_repo_facts": {
      const { localPath } = ExtractSchema.parse(args ?? {});
      const dir = resolveRepoDir(localPath);
      return text({
        ...summarizeFacts(dir, extractRepoFacts(dir)),
        sent: "nothing (this tool runs only on your machine)",
      });
    }

    case "vibemap_import_facts": {
      const { projectId, localPath } = ImportFactsSchema.parse(args);
      const dir = resolveRepoDir(localPath);
      const facts = extractRepoFacts(dir);
      assertFactsFit(facts);
      const client = getClient();
      const result = await client.importFacts(projectId, facts);
      const codeMap = await ensureCodeMap(client, projectId, facts);
      return text({ ...result, codeMap });
    }

    case "vibemap_import_semantic": {
      const { projectId, features } = ImportSemanticSchema.parse(args);
      return text(await getClient().importSemantic(projectId, features));
    }

    case "vibemap_finalize_import": {
      const { projectId } = FinalizeSchema.parse(args);
      return text(await getClient().finalizeImport(projectId));
    }

    case "vibemap_resync": {
      const { projectId, localPath, changedFiles, diffExcerpt } = ResyncSchema.parse(args);
      const dir = resolveRepoDir(localPath);
      const facts = extractRepoFacts(dir);
      assertFactsFit(facts);
      const client = getClient();
      const resync = (await client.resyncImport(projectId, facts)) as {
        changed_files?: string[];
      };
      const codeMap = await ensureCodeMap(client, projectId, facts, { refresh: true });
      const files = [...new Set([...(resync.changed_files ?? []), ...(changedFiles ?? [])])]
        .sort()
        .slice(0, 2000);
      // Drift is reported against the project's map; without one the call would
      // fail after the resync above already landed, losing its result.
      const hasMap = codeMap.status !== "failed" && codeMap.status !== "skipped";
      const drift = !hasMap
        ? { skipped: `No code map to report drift against (${codeMap.error ?? "nothing to map"})` }
        : files.length > 0
          ? await client.reportDriftChanges(
              projectId,
              files,
              facts.commit_sha ?? undefined,
              diffExcerpt
            )
          : null;
      return text({ resync, codeMap, reportedFiles: files.length, drift });
    }

    case "vibemap_resolve_drift": {
      const { projectId, files, nodeIds, criterionIds } = ResolveDriftSchema.parse(args);
      return text(await getClient().resolveDrift(projectId, { files, nodeIds, criterionIds }));
    }

    case "vibemap_resolve_code_drift_proposal": {
      const { projectId, proposalId, decision } = ResolveProposalSchema.parse(args);
      return text(await getClient().resolveCodeDriftProposal(projectId, proposalId, decision));
    }

    default:
      return null;
  }
}
