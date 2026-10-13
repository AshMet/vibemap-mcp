/**
 * RepoFacts: a deterministic, structural description of a repository.
 *
 * Produced locally by `extractRepoFacts(dir)` with no network access and no
 * model calls. The VibeMap import API validates exactly this shape, so any change
 * here is a contract change: update `tests/fixtures/repo-facts/contract.json`
 * and the server-side schema together.
 */

export const REPO_FACTS_VERSION = 1 as const;

export type Framework = "nextjs" | "unknown";
export type Database = "postgres" | "mysql" | "sqlite" | "sqlserver" | "mongodb" | "unknown";
export type Orm = "prisma";

export interface RepoFactsColumn {
  name: string;
  /** Lower-case SQL type as written, e.g. `uuid`, `text[]`, `numeric(10,2)`. */
  type: string;
  nullable: boolean;
  /** SQL text of the default expression. */
  default?: string;
  /** SQL text of a column-level CHECK expression. */
  check?: string;
}

export interface RepoFactsForeignKey {
  columns: string[];
  references: { table: string; columns: string[] };
  on_delete?: string;
}

export interface RepoFactsTable {
  /** Unqualified for the `public` schema, `schema.name` otherwise. */
  name: string;
  columns: RepoFactsColumn[];
  primary_key: string[];
  foreign_keys: RepoFactsForeignKey[];
  /** Repo-relative path of the file that created the table. */
  source_file: string;
}

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface RepoFactsPolicy {
  table: string;
  name: string;
  command: PolicyCommand;
  roles: string[];
  /**
   * `false` for `AS RESTRICTIVE`. A restrictive policy only narrows what the
   * permissive policies on the table allow; it never grants access by itself.
   */
  permissive: boolean;
  using?: string;
  with_check?: string;
  source_file: string;
}

export interface RepoFactsRoute {
  /** URL path with dynamic segments kept in bracket form, e.g. `/posts/[id]`. */
  path: string;
  kind: "page" | "api";
  /** HTTP methods exported by an API route, when they can be read statically. */
  methods?: string[];
  /** Repo-relative path of the route file. */
  file: string;
  dynamic_segments: string[];
}

export interface RepoFactsCluster {
  id: string;
  files: string[];
  route_paths: string[];
  tables: string[];
}

export interface RepoFactsWarning {
  file: string;
  error: string;
}

export interface RepoFacts {
  version: typeof REPO_FACTS_VERSION;
  commit_sha: string | null;
  stack: { framework: Framework; db: Database; orm?: Orm };
  tables: RepoFactsTable[];
  policies: RepoFactsPolicy[];
  routes: RepoFactsRoute[];
  clusters: RepoFactsCluster[];
  warnings: RepoFactsWarning[];
}
