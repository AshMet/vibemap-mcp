/**
 * Postgres migration reader.
 *
 * Applies `.sql` migration files in filename order and folds every ALTER into
 * the table it changes, so the result is the schema as it stands after the last
 * migration. Pure: it takes file contents and returns facts.
 *
 * Table DDL (CREATE TABLE, ALTER TABLE, DROP TABLE) is parsed with
 * `pgsql-ast-parser`. Row-level security policies are not covered by that
 * parser, so CREATE POLICY / DROP POLICY use the small dedicated reader below.
 * Every other statement (functions, triggers, grants, indexes, ...) carries no
 * table or policy facts and is skipped on purpose. A table or policy statement
 * that fails to parse is recorded in `warnings`, never dropped silently.
 */

import { parse } from "pgsql-ast-parser";
import type {
  PolicyCommand,
  RepoFactsColumn,
  RepoFactsForeignKey,
  RepoFactsPolicy,
  RepoFactsTable,
  RepoFactsWarning,
} from "./types.js";

/** Code-unit order: identical on every machine, unlike localeCompare. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface SqlStatement {
  sql: string;
  /** 1-based line of the statement's first character. */
  line: number;
}

/**
 * Split SQL text into statements on top-level semicolons. Aware of single
 * quotes, double-quoted identifiers, dollar quoting (`$$`, `$tag$`), line
 * comments and nested block comments. Comment text is dropped.
 */
export function splitSqlStatements(text: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let buf = "";
  let line = 1;
  let startLine = 1;
  let i = 0;
  const n = text.length;

  const push = () => {
    const sql = buf.trim();
    if (sql) out.push({ sql, line: startLine });
    buf = "";
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (buf.trim() === "" && ch !== "\n" && !/\s/.test(ch)) startLine = line;

    if (ch === "-" && next === "-") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "\n") line++;
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      buf += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      buf += ch;
      i++;
      while (i < n) {
        const c = text[i];
        if (c === "\n") line++;
        buf += c;
        i++;
        if (c === quote) {
          if (text[i] === quote) {
            buf += text[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        const chunk = text.slice(i, stop);
        line += (chunk.match(/\n/g) ?? []).length;
        buf += chunk;
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      push();
      i++;
      continue;
    }
    if (ch === "\n") line++;
    buf += ch;
    i++;
  }
  push();
  return out;
}

interface Name {
  name: string;
  schema?: string;
}

/** `public` is the default schema, so its tables are named without it. */
export function qualifiedName(n: Name): string {
  return n.schema && n.schema !== "public" ? `${n.schema}.${n.name}` : n.name;
}

function renderType(dt: any): string {
  if (!dt) return "unknown";
  if (dt.kind === "array") return `${renderType(dt.arrayOf)}[]`;
  const base = dt.schema && dt.schema !== "pg_catalog" ? `${dt.schema}.${dt.name}` : dt.name;
  const cfg = Array.isArray(dt.config) && dt.config.length > 0 ? `(${dt.config.join(",")})` : "";
  return `${String(base).toLowerCase()}${cfg}`;
}

function sliceExpr(sql: string, expr: any): string | undefined {
  const loc = expr?._location;
  if (!loc || typeof loc.start !== "number") return undefined;
  return sql.slice(loc.start, loc.end).trim();
}

interface TableState {
  name: string;
  columns: RepoFactsColumn[];
  primary_key: string[];
  foreign_keys: Array<RepoFactsForeignKey & { constraint?: string }>;
  source_file: string;
}

export interface SchemaState {
  tables: Map<string, TableState>;
  policies: Map<string, RepoFactsPolicy>;
  warnings: RepoFactsWarning[];
}

export function emptySchemaState(): SchemaState {
  return { tables: new Map(), policies: new Map(), warnings: [] };
}

const policyKey = (table: string, name: string) => `${table}\u0000${name}`;

function fkFromColumnRef(colName: string, c: any): RepoFactsForeignKey & { constraint?: string } {
  const fk: RepoFactsForeignKey & { constraint?: string } = {
    columns: [colName],
    references: {
      table: qualifiedName(c.foreignTable),
      columns: (c.foreignColumns ?? []).map((x: Name) => x.name),
    },
  };
  if (fk.references.columns.length === 0) fk.references.columns = ["id"];
  if (c.onDelete) fk.on_delete = String(c.onDelete).toUpperCase();
  if (c.constraintName?.name) fk.constraint = c.constraintName.name;
  return fk;
}

function buildColumn(
  table: TableState,
  def: any,
  sql: string
): { column: RepoFactsColumn; pk: boolean } {
  const column: RepoFactsColumn = {
    name: def.name.name,
    type: renderType(def.dataType),
    nullable: true,
  };
  let pk = false;
  for (const c of def.constraints ?? []) {
    switch (c.type) {
      case "not null":
        column.nullable = false;
        break;
      case "primary key":
        pk = true;
        column.nullable = false;
        break;
      case "default": {
        const text = sliceExpr(sql, c.default);
        if (text) column.default = text;
        break;
      }
      case "check": {
        const text = sliceExpr(sql, c.expr);
        if (text) column.check = text;
        break;
      }
      case "reference":
        table.foreign_keys.push(fkFromColumnRef(column.name, c));
        break;
      case "add generated":
        // Identity columns are NOT NULL by definition.
        column.nullable = false;
        break;
      default:
        break;
    }
  }
  return { column, pk };
}

function applyTableConstraint(table: TableState, c: any): void {
  if (c.type === "primary key") {
    table.primary_key = (c.columns ?? []).map((x: Name) => x.name);
    for (const col of table.columns) {
      if (table.primary_key.includes(col.name)) col.nullable = false;
    }
  } else if (c.type === "foreign key") {
    const fk: RepoFactsForeignKey & { constraint?: string } = {
      columns: (c.localColumns ?? []).map((x: Name) => x.name),
      references: {
        table: qualifiedName(c.foreignTable),
        columns: (c.foreignColumns ?? []).map((x: Name) => x.name),
      },
    };
    if (fk.references.columns.length === 0) fk.references.columns = ["id"];
    if (c.onDelete) fk.on_delete = String(c.onDelete).toUpperCase();
    if (c.constraintName?.name) fk.constraint = c.constraintName.name;
    table.foreign_keys.push(fk);
  }
}

function createTable(state: SchemaState, ast: any, sql: string, file: string): void {
  const name = qualifiedName(ast.name);
  if (ast.ifNotExists && state.tables.has(name)) return;
  const table: TableState = {
    name,
    columns: [],
    primary_key: [],
    foreign_keys: [],
    source_file: file,
  };
  for (const def of ast.columns ?? []) {
    if (def.kind !== "column") continue;
    const { column, pk } = buildColumn(table, def, sql);
    table.columns.push(column);
    if (pk) table.primary_key = [column.name];
  }
  for (const c of ast.constraints ?? []) applyTableConstraint(table, c);
  state.tables.set(name, table);
}

function alterTable(state: SchemaState, ast: any, sql: string, file: string): void {
  const name = qualifiedName(ast.table);
  const table = state.tables.get(name);
  if (!table) {
    if (!ast.ifExists) {
      state.warnings.push({ file, error: `ALTER TABLE on unknown table "${name}"` });
    }
    return;
  }
  for (const ch of ast.changes ?? []) {
    switch (ch.type) {
      case "add column": {
        const colName = ch.column.name.name;
        if (table.columns.some((c) => c.name === colName)) {
          if (!ch.ifNotExists) {
            state.warnings.push({ file, error: `ADD COLUMN "${colName}" already exists on "${name}"` });
          }
          break;
        }
        const { column, pk } = buildColumn(table, ch.column, sql);
        table.columns.push(column);
        if (pk) table.primary_key = [column.name];
        break;
      }
      case "drop column": {
        const colName = ch.column.name;
        table.columns = table.columns.filter((c) => c.name !== colName);
        table.primary_key = table.primary_key.filter((c) => c !== colName);
        table.foreign_keys = table.foreign_keys.filter((fk) => !fk.columns.includes(colName));
        break;
      }
      case "rename column": {
        const from = ch.column.name;
        const to = ch.to.name;
        const ref = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
        for (const c of table.columns) {
          if (c.name === from) c.name = to;
          // Postgres rewrites expressions that mention a renamed column.
          if (c.check) c.check = c.check.replace(ref, to);
          if (c.default) c.default = c.default.replace(ref, to);
        }
        table.primary_key = table.primary_key.map((c) => (c === from ? to : c));
        for (const fk of table.foreign_keys) fk.columns = fk.columns.map((c) => (c === from ? to : c));
        break;
      }
      case "rename": {
        const to = qualifiedName({ name: ch.to.name, schema: ast.table.schema });
        state.tables.delete(name);
        table.name = to;
        state.tables.set(to, table);
        for (const p of [...state.policies.values()]) {
          if (p.table === name) {
            state.policies.delete(policyKey(name, p.name));
            p.table = to;
            state.policies.set(policyKey(to, p.name), p);
          }
        }
        break;
      }
      case "alter column": {
        const col = table.columns.find((c) => c.name === ch.column.name);
        if (!col) {
          state.warnings.push({
            file,
            error: `ALTER COLUMN on unknown column "${name}.${ch.column.name}"`,
          });
          break;
        }
        const a = ch.alter;
        if (a.type === "set not null") col.nullable = false;
        else if (a.type === "drop not null") col.nullable = true;
        else if (a.type === "set default") {
          const text = sliceExpr(sql, a.default);
          if (text) col.default = text;
        } else if (a.type === "drop default") delete col.default;
        else if (a.type === "set type") col.type = renderType(a.dataType);
        break;
      }
      case "add constraint":
        applyTableConstraint(table, ch.constraint);
        break;
      case "drop constraint": {
        const cname = ch.constraint?.name;
        table.foreign_keys = table.foreign_keys.filter((fk) => fk.constraint !== cname);
        break;
      }
      default:
        break;
    }
  }
}

function dropTables(state: SchemaState, ast: any): void {
  for (const n of ast.names ?? []) {
    const name = qualifiedName(n);
    state.tables.delete(name);
    for (const p of [...state.policies.values()]) {
      if (p.table === name) state.policies.delete(policyKey(name, p.name));
    }
  }
}

// ── Policies ────────────────────────────────────────────────────────────────

type Tok = { kind: "word" | "ident" | "punct" | "string"; text: string; start: number; end: number };

function tokenize(sql: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          text += '"';
          j += 2;
        } else if (sql[j] === '"') break;
        else text += sql[j++];
      }
      toks.push({ kind: "ident", text, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      toks.push({ kind: "string", text: sql.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      toks.push({ kind: "word", text: sql.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    toks.push({ kind: "punct", text: ch, start: i, end: i + 1 });
    i++;
  }
  return toks;
}

class PolicyParseError extends Error {}

function isWord(t: Tok | undefined, w: string): boolean {
  return !!t && t.kind === "word" && t.text.toUpperCase() === w;
}

/** Reads `name` or `schema.name`; unquoted identifiers fold to lower case. */
function readName(toks: Tok[], i: number): { name: Name; next: number } {
  const ident = (t: Tok | undefined) => {
    if (!t || (t.kind !== "word" && t.kind !== "ident")) {
      throw new PolicyParseError(`expected a name at "${t?.text ?? "end of statement"}"`);
    }
    return t.kind === "word" ? t.text.toLowerCase() : t.text;
  };
  const first = ident(toks[i]);
  if (toks[i + 1]?.text === ".") {
    return { name: { schema: first, name: ident(toks[i + 2]) }, next: i + 3 };
  }
  return { name: { name: first }, next: i + 1 };
}

/** Reads a parenthesised expression; returns its inner source text. */
function readParenExpr(sql: string, toks: Tok[], i: number): { text: string; next: number } {
  if (toks[i]?.text !== "(") throw new PolicyParseError("expected ( after USING / WITH CHECK");
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].text === "(") depth++;
    else if (toks[j].text === ")") {
      depth--;
      if (depth === 0) {
        return { text: sql.slice(toks[i].end, toks[j].start).trim(), next: j + 1 };
      }
    }
  }
  throw new PolicyParseError("unbalanced parentheses");
}

/**
 * CREATE POLICY name ON table [AS PERMISSIVE|RESTRICTIVE] [FOR cmd]
 *   [TO role [, ...]] [USING (expr)] [WITH CHECK (expr)]
 */
export function parseCreatePolicy(sql: string, file: string): RepoFactsPolicy {
  const toks = tokenize(sql);
  if (!isWord(toks[0], "CREATE") || !isWord(toks[1], "POLICY")) {
    throw new PolicyParseError("not a CREATE POLICY statement");
  }
  let i = 2;
  const policyName = readName(toks, i);
  i = policyName.next;
  if (!isWord(toks[i], "ON")) throw new PolicyParseError("expected ON");
  const table = readName(toks, i + 1);
  i = table.next;

  let command: PolicyCommand = "ALL";
  let roles: string[] = ["public"];
  let using: string | undefined;
  let withCheck: string | undefined;

  while (i < toks.length) {
    const t = toks[i];
    if (isWord(t, "AS")) {
      i += 2; // PERMISSIVE | RESTRICTIVE
    } else if (isWord(t, "FOR")) {
      const cmd = toks[i + 1]?.text.toUpperCase();
      if (!["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(cmd ?? "")) {
        throw new PolicyParseError(`unknown policy command "${toks[i + 1]?.text}"`);
      }
      command = cmd as PolicyCommand;
      i += 2;
    } else if (isWord(t, "TO")) {
      roles = [];
      i++;
      while (i < toks.length) {
        const r = toks[i];
        if (r.kind !== "word" && r.kind !== "ident") break;
        if (isWord(r, "USING") || isWord(r, "WITH")) break;
        roles.push(r.kind === "word" ? r.text.toLowerCase() : r.text);
        i++;
        if (toks[i]?.text === ",") i++;
        else break;
      }
      if (roles.length === 0) throw new PolicyParseError("expected a role after TO");
    } else if (isWord(t, "USING")) {
      const e = readParenExpr(sql, toks, i + 1);
      using = e.text;
      i = e.next;
    } else if (isWord(t, "WITH") && isWord(toks[i + 1], "CHECK")) {
      const e = readParenExpr(sql, toks, i + 2);
      withCheck = e.text;
      i = e.next;
    } else {
      throw new PolicyParseError(`unexpected "${t.text}"`);
    }
  }

  const policy: RepoFactsPolicy = {
    table: qualifiedName(table.name),
    name: policyName.name.name,
    command,
    roles,
    source_file: file,
  };
  if (using !== undefined) policy.using = using;
  if (withCheck !== undefined) policy.with_check = withCheck;
  return policy;
}

/** DROP POLICY [IF EXISTS] name ON table [CASCADE|RESTRICT] */
export function parseDropPolicy(sql: string): { table: string; name: string } {
  const toks = tokenize(sql);
  let i = 2;
  if (isWord(toks[i], "IF") && isWord(toks[i + 1], "EXISTS")) i += 2;
  const policyName = readName(toks, i);
  i = policyName.next;
  if (!isWord(toks[i], "ON")) throw new PolicyParseError("expected ON");
  const table = readName(toks, i + 1);
  return { table: qualifiedName(table.name), name: policyName.name.name };
}

// ── Statement dispatch ──────────────────────────────────────────────────────

type Kind = "create table" | "alter table" | "drop table" | "create policy" | "drop policy" | "rls" | null;

function classify(sql: string): Kind {
  const head = sql.slice(0, 200).replace(/\s+/g, " ").toUpperCase();
  if (/^CREATE (OR REPLACE )?POLICY /.test(head)) return "create policy";
  if (/^DROP POLICY /.test(head)) return "drop policy";
  // Temporary tables live for one session (data fixes); they are not schema.
  if (/^CREATE (GLOBAL |LOCAL )?(TEMP|TEMPORARY) TABLE /.test(head)) return null;
  if (/^CREATE (UNLOGGED )?TABLE /.test(head)) return "create table";
  if (/^DROP TABLE /.test(head)) return "drop table";
  if (/^ALTER TABLE /.test(head)) {
    // RLS toggles, ownership and replica identity carry no structural facts.
    if (/ (ENABLE|DISABLE|FORCE|NO FORCE) ROW LEVEL SECURITY$/.test(head)) return "rls";
    if (/ OWNER TO /.test(head) || / REPLICA IDENTITY /.test(head)) return "rls";
    if (/ (ENABLE|DISABLE) (ALWAYS |REPLICA )?TRIGGER /.test(head)) return "rls";
    return "alter table";
  }
  return null;
}

/** Remove every `[CONSTRAINT name] CHECK (...)` clause, parentheses balanced. */
export function stripCheckClauses(sql: string): string {
  const re = /(,\s*)?(CONSTRAINT\s+("[^"]+"|\w+)\s+)?CHECK\s*\(/gi;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < sql.length && depth > 0; j++) {
      if (sql[j] === "(") depth++;
      else if (sql[j] === ")") depth--;
    }
    // A table-level clause takes its leading comma with it (a column-level CHECK
    // never follows a comma).
    out += sql.slice(last, m.index);
    last = j;
    re.lastIndex = j;
  }
  return out + sql.slice(last);
}

function firstLine(message: string): string {
  return message.split("\n")[0].trim();
}

/** Apply one migration file's statements to `state` (mutates it). */
export function applyMigration(state: SchemaState, file: string, text: string): void {
  for (const stmt of splitSqlStatements(text)) {
    const kind = classify(stmt.sql);
    if (!kind || kind === "rls") continue;
    try {
      if (kind === "create policy") {
        const p = parseCreatePolicy(stmt.sql.replace(/^CREATE\s+OR\s+REPLACE/i, "CREATE"), file);
        state.policies.set(policyKey(p.table, p.name), p);
      } else if (kind === "drop policy") {
        const d = parseDropPolicy(stmt.sql);
        state.policies.delete(policyKey(d.table, d.name));
      } else {
        let sql = stmt.sql;
        let asts: any[];
        try {
          asts = parse(sql, { locationTracking: true });
        } catch (err) {
          if (kind !== "create table") throw err;
          // The parser rejects some CHECK expressions (e.g. IS DISTINCT FROM).
          // Keep the table: drop its CHECK clauses and say so.
          sql = stripCheckClauses(sql);
          asts = parse(sql, { locationTracking: true });
          state.warnings.push({
            file,
            error: `line ${stmt.line}: CHECK constraints not read (${firstLine(err instanceof Error ? err.message : String(err))})`,
          });
        }
        for (const ast of asts) {
          if (ast.type === "create table") createTable(state, ast, sql, file);
          else if (ast.type === "alter table") alterTable(state, ast, sql, file);
          else if (ast.type === "drop table") dropTables(state, ast);
        }
      }
    } catch (err) {
      state.warnings.push({
        file,
        error: `line ${stmt.line}: ${firstLine(err instanceof Error ? err.message : String(err))}`,
      });
    }
  }
}

/** Final, sorted, de-internalised tables and policies. */
export function finishSchema(state: SchemaState): {
  tables: RepoFactsTable[];
  policies: RepoFactsPolicy[];
} {
  const tables = [...state.tables.values()]
    .map(
      (t): RepoFactsTable => ({
        name: t.name,
        columns: t.columns.map((c) => ({ ...c })),
        primary_key: [...t.primary_key],
        foreign_keys: t.foreign_keys.map(({ constraint: _c, ...fk }) => fk),
        source_file: t.source_file,
      })
    )
    .sort((a, b) => cmp(a.name, b.name));
  const policies = [...state.policies.values()].sort(
    (a, b) => cmp(a.table, b.table) || cmp(a.name, b.name)
  );
  return { tables, policies };
}
