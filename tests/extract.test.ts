import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClusters, clusterIdFor, importSpecifiers, readAliases, referencedTables, resolveImport } from "../src/extract/clusters.js";
import { extractRepoFacts, readCommitSha } from "../src/extract/index.js";
import { appRouterRoutes, exportedMethods, pagesRouterRoutes } from "../src/extract/next-routes.js";
import { readPrismaSchema } from "../src/extract/prisma.js";
import {
  applyMigration,
  emptySchemaState,
  finishSchema,
  parseCreatePolicy,
  parseDropPolicy,
  splitSqlStatements,
  stripCheckClauses,
} from "../src/extract/sql.js";
import type { RepoFacts } from "../src/extract/types.js";

const FIXTURES = path.join(__dirname, "fixtures");
const SUPABASE_REPO = path.join(FIXTURES, "repos/next-supabase");
const PRISMA_REPO = path.join(FIXTURES, "repos/next-prisma");
const CONTRACT = path.join(FIXTURES, "repo-facts/contract.json");

function schemaOf(files: Record<string, string>) {
  const state = emptySchemaState();
  for (const [file, text] of Object.entries(files)) applyMigration(state, file, text);
  return { ...finishSchema(state), warnings: state.warnings };
}

// ── Contract ────────────────────────────────────────────────────────────────

describe("RepoFacts contract", () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8")) as RepoFacts;

  it("the next-supabase fixture extracts to exactly the shared contract fixture", () => {
    expect(extractRepoFacts(SUPABASE_REPO)).toEqual(contract);
  });

  it("the contract fixture has exactly the documented keys at every level", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(contract)).toEqual(
      ["clusters", "commit_sha", "policies", "routes", "stack", "tables", "version", "warnings"].sort()
    );
    expect(contract.version).toBe(1);
    const tableKeys = ["columns", "foreign_keys", "name", "primary_key", "source_file"];
    for (const t of contract.tables) {
      expect(keys(t)).toEqual(tableKeys);
      for (const c of t.columns) {
        for (const k of Object.keys(c)) expect(["name", "type", "nullable", "default", "check"]).toContain(k);
      }
      for (const fk of t.foreign_keys) {
        for (const k of Object.keys(fk)) expect(["columns", "references", "on_delete"]).toContain(k);
        expect(keys(fk.references)).toEqual(["columns", "table"]);
      }
    }
    for (const p of contract.policies) {
      for (const k of Object.keys(p)) {
        expect(["table", "name", "command", "roles", "permissive", "using", "with_check", "source_file"]).toContain(k);
      }
      expect(typeof p.permissive).toBe("boolean");
    }
    for (const r of contract.routes) {
      for (const k of Object.keys(r)) {
        expect(["path", "kind", "methods", "file", "dynamic_segments"]).toContain(k);
      }
    }
    for (const c of contract.clusters) expect(keys(c)).toEqual(["files", "id", "route_paths", "tables"]);
  });

  it("is deterministic: two runs are byte-identical", () => {
    const a = JSON.stringify(extractRepoFacts(SUPABASE_REPO));
    const b = JSON.stringify(extractRepoFacts(SUPABASE_REPO));
    expect(a).toBe(b);
  });
});

// ── Fixture repos ───────────────────────────────────────────────────────────

describe("extractRepoFacts: next-supabase", () => {
  const facts = extractRepoFacts(SUPABASE_REPO);

  it("folds ALTERs into the tables, in filename order", () => {
    const posts = facts.tables.find((t) => t.name === "posts");
    expect(posts?.columns.map((c) => c.name)).toEqual([
      "id",
      "author_id",
      "title",
      "body",
      "status",
      "created_at",
      "published_at",
    ]);
    expect(posts?.columns.find((c) => c.name === "body")?.nullable).toBe(false);
    const profiles = facts.tables.find((t) => t.name === "profiles");
    // RENAME COLUMN also rewrites the CHECK that mentions it.
    expect(profiles?.columns[1]).toEqual({
      name: "name",
      type: "text",
      nullable: false,
      check: "char_length(name) > 0",
    });
  });

  it("reads table-level primary and foreign keys", () => {
    const comments = facts.tables.find((t) => t.name === "comments");
    expect(comments?.primary_key).toEqual(["id"]);
    expect(comments?.foreign_keys).toEqual([
      { columns: ["post_id"], references: { table: "posts", columns: ["id"] }, on_delete: "CASCADE" },
      { columns: ["author_id"], references: { table: "profiles", columns: ["id"] } },
    ]);
  });

  it("reads real policies and applies DROP POLICY", () => {
    expect(facts.policies.map((p) => `${p.table}:${p.name}:${p.command}`)).toEqual([
      "comments:Comment authors insert:INSERT",
      "comments:Only authors delete comments:DELETE",
      "posts:Anyone can read published posts:SELECT",
      "posts:Authors manage their posts:ALL",
    ]);
    expect(facts.policies.map((p) => p.permissive)).toEqual([true, false, true, true]);
    const read = facts.policies.find((p) => p.name === "Anyone can read published posts");
    expect(read?.roles).toEqual(["anon", "authenticated"]);
    expect(read?.using).toBe("status = 'published'");
  });

  it("finds app-router pages and API routes, skipping private folders", () => {
    expect(facts.routes.map((r) => `${r.kind} ${r.path}`)).toEqual([
      "page /",
      "page /about",
      "api /api/posts",
      "api /api/posts/[id]/comments",
      "page /posts",
      "page /posts/[id]",
    ]);
    expect(facts.routes.find((r) => r.path === "/api/posts")?.methods).toEqual(["GET", "POST"]);
    expect(facts.routes.find((r) => r.path === "/api/posts/[id]/comments")?.methods).toEqual(["GET"]);
  });

  it("clusters route files with their imports and referenced tables", () => {
    const posts = facts.clusters.find((c) => c.id === "posts");
    expect(posts?.tables).toEqual(["comments", "posts"]);
    expect(posts?.files).toContain("lib/db.ts");
    expect(facts.stack).toEqual({ framework: "nextjs", db: "postgres" });
    expect(facts.warnings).toEqual([]);
  });
});

describe("extractRepoFacts: next-prisma", () => {
  const facts = extractRepoFacts(PRISMA_REPO);

  it("reads models as tables with mapped names, native types and relations", () => {
    expect(facts.stack).toEqual({ framework: "nextjs", db: "postgres", orm: "prisma" });
    expect(facts.tables.map((t) => t.name)).toEqual(["Post", "taggings", "users"]);
    const post = facts.tables.find((t) => t.name === "Post");
    expect(post?.columns).toEqual([
      { name: "id", type: "integer", nullable: false, default: "autoincrement()" },
      { name: "title", type: "varchar(200)", nullable: false },
      { name: "published", type: "boolean", nullable: false, default: "false" },
      { name: "tags", type: "text[]", nullable: false },
      { name: "author_id", type: "uuid", nullable: false },
    ]);
    expect(post?.foreign_keys).toEqual([
      { columns: ["author_id"], references: { table: "users", columns: ["id"] }, on_delete: "CASCADE" },
    ]);
    const users = facts.tables.find((t) => t.name === "users");
    expect(users?.columns.find((c) => c.name === "created_at")).toEqual({
      name: "created_at",
      type: "timestamp(3)",
      nullable: false,
      default: "now()",
    });
    expect(users?.columns.find((c) => c.name === "name")?.nullable).toBe(true);
    expect(facts.tables.find((t) => t.name === "taggings")?.primary_key).toEqual(["postId", "tag"]);
    expect(facts.policies).toEqual([]);
  });

  it("finds pages-router pages and API routes, skipping _app", () => {
    expect(facts.routes.map((r) => `${r.kind} ${r.path} ${r.file}`)).toEqual([
      "page / pages/index.tsx",
      "api /api/users pages/api/users/index.ts",
      "page /users/[id] pages/users/[id].tsx",
    ]);
  });

  it("links Prisma client accessors to their tables", () => {
    expect(facts.clusters.find((c) => c.id === "users")?.tables).toEqual(["users"]);
  });
});

// ── SQL ─────────────────────────────────────────────────────────────────────

describe("splitSqlStatements", () => {
  it("does not split inside dollar quotes, strings, identifiers or comments", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM 1; END; $body$ LANGUAGE plpgsql;",
      "INSERT INTO t VALUES ('a;b', \"x;y\"); -- trailing; comment",
      "/* block; /* nested; */ still; */ SELECT 1;",
    ].join("\n");
    const out = splitSqlStatements(sql).map((s) => s.sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("PERFORM 1; END;");
    expect(out[1]).toBe("INSERT INTO t VALUES ('a;b', \"x;y\")");
    expect(out[2]).toBe("SELECT 1");
  });

  it("reports the starting line of each statement", () => {
    expect(splitSqlStatements("\n\nSELECT 1;\n\nSELECT\n2;").map((s) => s.line)).toEqual([3, 5]);
  });
});

describe("policies", () => {
  it("parses commands, roles, permissive markers and both expressions", () => {
    const p = parseCreatePolicy(
      `CREATE POLICY "Owners" ON public.items AS RESTRICTIVE FOR UPDATE TO authenticated, "Service Role" USING ((select auth.uid()) = owner_id) WITH CHECK (owner_id IS NOT NULL)`,
      "m.sql"
    );
    expect(p).toEqual({
      table: "items",
      name: "Owners",
      command: "UPDATE",
      roles: ["authenticated", "Service Role"],
      permissive: false,
      using: "(select auth.uid()) = owner_id",
      with_check: "owner_id IS NOT NULL",
      source_file: "m.sql",
    });
  });

  it("marks AS PERMISSIVE and an unmarked policy permissive", () => {
    expect(parseCreatePolicy("CREATE POLICY p ON t AS PERMISSIVE USING (true)", "m.sql").permissive).toBe(true);
    expect(parseCreatePolicy("CREATE POLICY p ON t USING (true)", "m.sql").permissive).toBe(true);
  });

  it("defaults to ALL commands for the public role", () => {
    const p = parseCreatePolicy("CREATE POLICY p ON s.t USING (true)", "m.sql");
    expect(p).toMatchObject({ table: "s.t", command: "ALL", roles: ["public"], permissive: true, using: "true" });
  });

  it("rejects malformed policies instead of guessing", () => {
    expect(() => parseCreatePolicy("CREATE POLICY p ON t FOR MERGE USING (true)", "m.sql")).toThrow();
    expect(() => parseCreatePolicy("CREATE POLICY p ON t USING (true", "m.sql")).toThrow();
    expect(() => parseCreatePolicy("CREATE POLICY p ON t AS SOMETIMES USING (true)", "m.sql")).toThrow(
      /PERMISSIVE or RESTRICTIVE/
    );
  });

  it("parses DROP POLICY", () => {
    expect(parseDropPolicy('DROP POLICY IF EXISTS "a b" ON public.t CASCADE')).toEqual({
      table: "t",
      name: "a b",
    });
  });

  it("moves policies with a renamed table and drops them with a dropped table", () => {
    const r = schemaOf({
      "1.sql": "CREATE TABLE a (id int); CREATE TABLE b (id int); CREATE POLICY p ON a USING (true); CREATE POLICY q ON b USING (true);",
      "2.sql": "ALTER TABLE a RENAME TO c; DROP TABLE b;",
    });
    expect(r.tables.map((t) => t.name)).toEqual(["c"]);
    expect(r.policies.map((p) => `${p.table}.${p.name}`)).toEqual(["c.p"]);
  });
});

describe("applyMigration", () => {
  it("records a parse failure as a warning with file and line, never silently", () => {
    const r = schemaOf({
      "001.sql": "CREATE TABLE ok (id int);\n\nCREATE TABLE broken (id int,,);\nCREATE POLICY p ON ok FOR NOPE USING (true);",
    });
    expect(r.tables.map((t) => t.name)).toEqual(["ok"]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0].file).toBe("001.sql");
    expect(r.warnings[0].error).toMatch(/^line 3: /);
    expect(r.warnings[1].error).toMatch(/unknown policy command/);
  });

  it("warns about ALTER on a table it never saw, unless IF EXISTS", () => {
    const r = schemaOf({ "1.sql": "ALTER TABLE ghost ADD COLUMN x int; ALTER TABLE IF EXISTS ghost2 ADD COLUMN x int;" });
    expect(r.warnings.map((w) => w.error)).toEqual(['ALTER TABLE on unknown table "ghost"']);
  });

  it("keeps a table whose CHECK the parser cannot read, and says so", () => {
    const r = schemaOf({
      "1.sql": "CREATE TABLE r (id uuid PRIMARY KEY, parent uuid, CONSTRAINT not_own CHECK (parent IS DISTINCT FROM id));",
    });
    expect(r.tables.map((t) => t.name)).toEqual(["r"]);
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(["id", "parent"]);
    expect(r.warnings[0].error).toMatch(/CHECK constraints not read/);
  });

  it("ignores temporary tables, RLS toggles, triggers and unrelated statements", () => {
    const r = schemaOf({
      "1.sql": [
        "CREATE TABLE t (id int)",
        "CREATE TEMP TABLE tmp (x int) ON COMMIT DROP",
        "ALTER TABLE t ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE t DISABLE TRIGGER trg",
        "CREATE INDEX i ON t(id)",
        "GRANT SELECT ON t TO anon",
      ].join(";\n"),
    });
    expect(r.tables.map((t) => t.name)).toEqual(["t"]);
    expect(r.warnings).toEqual([]);
  });

  it("applies column changes: drop, type, default, nullability, constraints", () => {
    const r = schemaOf({
      "1.sql": "CREATE TABLE t (id int, a text DEFAULT 'x', b int, c int REFERENCES u(id));",
      "2.sql": [
        "ALTER TABLE t ALTER COLUMN a DROP DEFAULT, ALTER COLUMN a SET NOT NULL",
        "ALTER TABLE t ALTER COLUMN b TYPE bigint",
        "ALTER TABLE t DROP COLUMN c",
        "ALTER TABLE t ADD PRIMARY KEY (id)",
        "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (b) REFERENCES v(id) ON DELETE SET NULL",
      ].join(";\n"),
    });
    expect(r.tables[0]).toEqual({
      name: "t",
      columns: [
        { name: "id", type: "int", nullable: false },
        { name: "a", type: "text", nullable: false },
        { name: "b", type: "bigint", nullable: true },
      ],
      primary_key: ["id"],
      foreign_keys: [{ columns: ["b"], references: { table: "v", columns: ["id"] }, on_delete: "SET NULL" }],
      source_file: "1.sql",
    });
  });

  it("stripCheckClauses removes table- and column-level checks", () => {
    expect(stripCheckClauses("CREATE TABLE t (a int CHECK (a > (0)), b int, CONSTRAINT c CHECK (b IS DISTINCT FROM a))")).toBe(
      "CREATE TABLE t (a int , b int)"
    );
  });
});

// ── Prisma ──────────────────────────────────────────────────────────────────

describe("readPrismaSchema", () => {
  it("records unreadable field lines as warnings", () => {
    const r = readPrismaSchema("model A {\n  id Int @id\n  ??? broken\n}\n", "schema.prisma");
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(["id"]);
    expect(r.warnings).toEqual([{ file: "schema.prisma", error: 'line 3: unreadable field "??? broken"' }]);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

describe("Next.js routes", () => {
  it("handles groups, parallel slots, catch-alls, private and intercepting folders", () => {
    const files = [
      "app/(shop)/cart/page.tsx",
      "app/@modal/login/page.tsx",
      "app/docs/[...slug]/page.mdx",
      "app/blog/[[...slug]]/page.tsx",
      "app/_lib/page.tsx",
      "app/feed/(.)photo/page.tsx",
      "app/layout.tsx",
      "app/api/hook/route.ts",
    ];
    const routes = appRouterRoutes("app", files, () => "export async function POST() {}");
    expect(routes.map((r) => [r.path, r.dynamic_segments])).toEqual([
      ["/cart", []],
      ["/login", []],
      ["/docs/[...slug]", ["slug"]],
      ["/blog/[[...slug]]", ["slug"]],
      ["/api/hook", []],
    ]);
    expect(routes[4]).toMatchObject({ kind: "api", methods: ["POST"] });
  });

  it("reads exported methods in all three export styles", () => {
    expect(exportedMethods("export function GET() {}\nexport const DELETE = h;\nexport { a as PATCH, b }")).toEqual([
      "GET",
      "PATCH",
      "DELETE",
    ]);
  });

  it("maps pages-router index files and skips special files", () => {
    const r = pagesRouterRoutes("src/pages", [
      "src/pages/index.tsx",
      "src/pages/blog/index.tsx",
      "src/pages/_document.tsx",
      "src/pages/api/[id].ts",
    ]);
    expect(r.map((x) => `${x.kind} ${x.path}`)).toEqual(["page /", "page /blog", "api /api/[id]"]);
  });
});

// ── Clusters ────────────────────────────────────────────────────────────────

describe("clusters", () => {
  it("reads every import form", () => {
    expect(
      importSpecifiers(
        `import a from "./a";\nimport type { B } from '../b';\nimport "./side";\nexport * from "./c";\nexport { d } from "./d";\nconst e = require("./e");\nconst f = await import("./f");`
      ).sort()
    ).toEqual(["../b", "./a", "./c", "./d", "./e", "./f", "./side"]);
  });

  it("resolves relative and aliased imports, with extensions and index files", () => {
    const files = new Set(["src/lib/x.ts", "src/ui/index.tsx", "app/page.tsx"]);
    const aliases = readAliases('{ "compilerOptions": { "paths": { "@/*": ["./src/*"] }, } } // c');
    expect(aliases).toEqual([{ prefix: "@/", target: "src/" }]);
    expect(resolveImport("app/page.tsx", "@/lib/x", files, aliases)).toBe("src/lib/x.ts");
    expect(resolveImport("app/page.tsx", "../src/ui", files, aliases)).toBe("src/ui/index.tsx");
    expect(resolveImport("app/page.tsx", "react", files, aliases)).toBeNull();
  });

  it("walks imports to depth 2 and no further", () => {
    const src: Record<string, string> = {
      "app/a/page.tsx": 'import "../../l1";',
      "l1.ts": 'import "./l2";',
      "l2.ts": 'import "./l3";',
      "l3.ts": "",
    };
    const clusters = buildClusters({
      routes: [{ path: "/a", kind: "page", file: "app/a/page.tsx", dynamic_segments: [] }],
      files: new Set(Object.keys(src)),
      readFile: (f) => src[f] ?? "",
      aliases: [],
      tableNames: [],
      accessors: new Map(),
    });
    expect(clusters[0].files).toEqual(["app/a/page.tsx", "l1.ts", "l2.ts"]);
  });

  it("derives cluster ids from the first static segment", () => {
    expect(clusterIdFor("/")).toBe("home");
    expect(clusterIdFor("/api/posts/[id]")).toBe("posts");
    expect(clusterIdFor("/[locale]/x")).toBe("locale");
    expect(clusterIdFor("/Team_Settings")).toBe("team-settings");
  });

  it("detects referenced tables by query-builder name, not by substring", () => {
    expect(referencedTables('db.from("posts"); db.from(`public.tags`)', ["posts", "public.tags", "post"], new Map())).toEqual([
      "posts",
      "public.tags",
    ]);
  });
});

describe("readCommitSha", () => {
  it("follows a symbolic ref to a loose or packed ref, and returns null outside git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facts-git-"));
    try {
      expect(readCommitSha(dir)).toBeNull();
      fs.mkdirSync(path.join(dir, ".git/refs/heads"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".git/HEAD"), "ref: refs/heads/main\n");
      fs.writeFileSync(path.join(dir, ".git/packed-refs"), `# pack\n${"b".repeat(40)} refs/heads/main\n`);
      expect(readCommitSha(dir)).toBe("b".repeat(40));
      fs.writeFileSync(path.join(dir, ".git/refs/heads/main"), `${"a".repeat(40)}\n`);
      expect(readCommitSha(dir)).toBe("a".repeat(40));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
