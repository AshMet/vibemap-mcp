/**
 * Prisma schema reader: `schema.prisma` models to RepoFacts tables.
 *
 * A deliberately small line parser. It covers the parts of the schema language
 * that describe tables: models, scalar fields, optional and list markers,
 * `@id`, `@@id`, `@default`, `@map`, `@@map`, `@db.*` native types, and
 * `@relation(fields, references, onDelete)`. Anything it cannot read on a field
 * line is recorded as a warning.
 */

import type { Database, RepoFactsColumn, RepoFactsForeignKey, RepoFactsTable, RepoFactsWarning } from "./types.js";
import { cmp } from "./sql.js";

const SCALAR_TYPES: Record<string, string> = {
  String: "text",
  Int: "integer",
  BigInt: "bigint",
  Float: "double precision",
  Decimal: "decimal(65,30)",
  Boolean: "boolean",
  DateTime: "timestamp(3)",
  Json: "jsonb",
  Bytes: "bytea",
};

const PROVIDERS: Record<string, Database> = {
  postgresql: "postgres",
  postgres: "postgres",
  cockroachdb: "postgres",
  mysql: "mysql",
  sqlite: "sqlite",
  sqlserver: "sqlserver",
  mongodb: "mongodb",
};

interface Block {
  kind: string;
  name: string;
  body: string;
  line: number;
}

function stripComments(text: string): string {
  // `//` comments only; string literals in a schema never contain `//` in practice
  // except URLs inside env("..."), which sit in datasource blocks we read by regex.
  return text
    .split("\n")
    .map((l) => {
      let inStr = false;
      for (let i = 0; i < l.length - 1; i++) {
        if (l[i] === '"' && l[i - 1] !== "\\") inStr = !inStr;
        if (!inStr && l[i] === "/" && l[i + 1] === "/") return l.slice(0, i);
      }
      return l;
    })
    .join("\n");
}

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const re = /^[ \t]*(model|enum|datasource|generator|view|type)\s+(\w+)\s*\{([\s\S]*?)^[ \t]*\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split("\n").length;
    out.push({ kind: m[1], name: m[2], body: m[3], line });
  }
  return out;
}

/** Arguments inside the first `@name(...)` occurrence, balanced. */
function attrArgs(line: string, attr: string): string | null {
  const idx = line.search(new RegExp(`${attr.replace(/[.@]/g, (c) => `\\${c}`)}\\b(?!\\.)`));
  if (idx === -1) return null;
  let i = idx + attr.length;
  if (line[i] !== "(") return "";
  let depth = 0;
  const start = i + 1;
  for (; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")") {
      depth--;
      if (depth === 0) return line.slice(start, i).trim();
    }
  }
  return null;
}

function quoted(s: string | null): string | null {
  if (!s) return null;
  const m = /^"([^"]*)"/.exec(s.trim()) ?? /name:\s*"([^"]*)"/.exec(s);
  return m ? m[1] : null;
}

function listArg(args: string, key: string): string[] {
  const m = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderDefault(args: string): string {
  const s = args.trim();
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (str) return `'${str[1].replace(/'/g, "''")}'`;
  return s;
}

export function readPrismaSchema(
  text: string,
  file: string
): {
  tables: RepoFactsTable[];
  db: Database;
  warnings: RepoFactsWarning[];
  /** Prisma client accessor (`post` for model `Post`) to table name. */
  accessors: Map<string, string>;
} {
  const src = stripComments(text);
  const all = blocks(src);
  const warnings: RepoFactsWarning[] = [];

  let db: Database = "unknown";
  for (const b of all.filter((x) => x.kind === "datasource")) {
    const p = /provider\s*=\s*"([^"]+)"/.exec(b.body);
    if (p) db = PROVIDERS[p[1]] ?? "unknown";
  }

  const enums = new Set(all.filter((b) => b.kind === "enum").map((b) => b.name));
  const models = all.filter((b) => b.kind === "model");
  const modelNames = new Set(models.map((b) => b.name));

  // Pass 1: table and column names, so relations can resolve @map'd names.
  const tableName = new Map<string, string>();
  const columnName = new Map<string, Map<string, string>>();
  for (const m of models) {
    tableName.set(m.name, quoted(attrArgs(m.body, "@@map")) ?? m.name);
    const cols = new Map<string, string>();
    for (const raw of m.body.split("\n")) {
      const line = raw.trim();
      const f = /^(\w+)\s+/.exec(line);
      if (!f || line.startsWith("@@")) continue;
      cols.set(f[1], quoted(attrArgs(line, "@map")) ?? f[1]);
    }
    columnName.set(m.name, cols);
  }

  const tables: RepoFactsTable[] = [];
  for (const m of models) {
    const cols = columnName.get(m.name) as Map<string, string>;
    const columns: RepoFactsColumn[] = [];
    let primaryKey: string[] = [];
    const foreignKeys: RepoFactsForeignKey[] = [];
    const bodyLines = m.body.split("\n");

    for (let li = 0; li < bodyLines.length; li++) {
      const line = bodyLines[li].trim();
      if (!line) continue;
      if (line.startsWith("@@")) {
        const id = attrArgs(line, "@@id");
        if (id !== null) {
          // `@@id([a, b])` or `@@id(fields: [a, b])`.
          const names = listArg(id.startsWith("[") ? `fields: ${id}` : id, "fields");
          primaryKey = names.map((n) => cols.get(n) ?? n);
        }
        continue;
      }
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(\s|$)/.exec(line);
      if (!f) {
        warnings.push({ file, error: `line ${m.line + li}: unreadable field "${line}"` });
        continue;
      }
      const [, fieldName, typeName, list, optional] = f;

      if (modelNames.has(typeName)) {
        // A relation field: not a column. The owning side carries the FK.
        const rel = attrArgs(line, "@relation");
        if (rel) {
          const fields = listArg(rel, "fields");
          const refs = listArg(rel, "references");
          if (fields.length > 0) {
            const target = columnName.get(typeName);
            const fk: RepoFactsForeignKey = {
              columns: fields.map((n) => cols.get(n) ?? n),
              references: {
                table: tableName.get(typeName) ?? typeName,
                columns: refs.map((n) => target?.get(n) ?? n),
              },
            };
            const onDelete = /onDelete\s*:\s*(\w+)/.exec(rel);
            if (onDelete) {
              fk.on_delete = onDelete[1].replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
            }
            foreignKeys.push(fk);
          }
        }
        continue;
      }

      let type: string;
      const native = /@db\.(\w+)(\(([^)]*)\))?/.exec(line);
      if (native) {
        type = native[1].toLowerCase() + (native[3] ? `(${native[3].replace(/\s+/g, "")})` : "");
      } else if (SCALAR_TYPES[typeName]) {
        type = SCALAR_TYPES[typeName];
      } else if (enums.has(typeName)) {
        type = typeName;
      } else {
        type = typeName.toLowerCase();
      }
      if (list) type = `${type}[]`;

      const column: RepoFactsColumn = {
        name: cols.get(fieldName) ?? fieldName,
        type,
        nullable: !!optional,
      };
      const def = attrArgs(line, "@default");
      if (def) column.default = renderDefault(def);
      if (/@id\b/.test(line)) {
        primaryKey = [column.name];
        column.nullable = false;
      }
      columns.push(column);
    }

    for (const c of columns) if (primaryKey.includes(c.name)) c.nullable = false;
    tables.push({
      name: tableName.get(m.name) ?? m.name,
      columns,
      primary_key: primaryKey,
      foreign_keys: foreignKeys,
      source_file: file,
    });
  }

  tables.sort((a, b) => cmp(a.name, b.name));
  const accessors = new Map<string, string>();
  for (const m of models) {
    accessors.set(m.name[0].toLowerCase() + m.name.slice(1), tableName.get(m.name) ?? m.name);
  }
  return { tables, db, warnings, accessors };
}
