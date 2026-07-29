import * as fs from "fs/promises";
import * as path from "path";

// Directories and files to always ignore
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
]);

const IGNORE_EXTENSIONS = new Set([".lock", ".log", ".map", ".min.js", ".min.css"]);

// Extensions whose contents are worth reading for code analysis
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".env.example",
  ".md",
  ".sql",
  ".prisma",
  ".graphql",
]);

// Key filenames to always attempt to read (regardless of extension match)
const KEY_FILENAMES = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "README.md",
  "README.txt",
  "schema.prisma",
  "docker-compose.yml",
  "Dockerfile",
  ".env.example",
]);

const MAX_FILE_READ_BYTES = 4000; // ~1k tokens per file
const MAX_DIGEST_FILES = 20;

// ─── Case conversion ──────────────────────────────────────────────────────────
//
// Repo convention: the MCP tool surface is uniformly camelCase (projectId,
// givenCondition, userRole, …) while the `/api/crud/*` endpoints expect
// snake_case bodies. Scalar tools map field-by-field in the handler; nested
// payloads (personas) use `camelToSnakeDeep` so the calling agent never has to
// mix camelCase and snake_case in a single object. This is the single
// conversion point between the two boundaries.

/** Convert one camelCase key to snake_case ("primaryObjectives" → "primary_objectives"). */
export function camelToSnake(key: string): string {
  return key.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Recursively convert every object KEY from camelCase to snake_case. Values are
 * preserved verbatim — primitives (including the strings inside a `values:
 * string[]`) are untouched, and array elements are only recursed into when they
 * are themselves objects. Used to translate camelCase MCP tool args into the
 * snake_case body shape the CRUD API and DB columns expect.
 */
export function camelToSnakeDeep<T = unknown>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((v) => camelToSnakeDeep(v)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[camelToSnake(k)] = camelToSnakeDeep(v);
    }
    return out as unknown as T;
  }
  return input;
}

export interface FileEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
  ext?: string;
}

/**
 * Walk a directory and return a formatted tree string.
 * Ignores common non-essential directories.
 */
export async function walkDir(dir: string, maxDepth: number, currentDepth = 0): Promise<string> {
  if (currentDepth >= maxDepth) return "";

  let result = "";

  let files: import("fs").Dirent[];
  try {
    files = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return `[Error reading directory: ${dir}]\n`;
  }

  // Sort: directories first, then files
  files.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const file of files) {
    if (IGNORE_DIRS.has(file.name)) continue;
    const ext = path.extname(file.name);
    if (IGNORE_EXTENSIONS.has(ext)) continue;

    const indent = "  ".repeat(currentDepth);
    const prefix = file.isDirectory() ? "📁 " : "  ";
    result += `${indent}${prefix}${file.name}\n`;

    if (file.isDirectory()) {
      result += await walkDir(path.join(dir, file.name), maxDepth, currentDepth + 1);
    }
  }

  return result;
}

/**
 * Build a structured list of all files in a directory tree.
 */
async function collectFiles(
  dir: string,
  maxDepth: number,
  currentDepth = 0,
  collected: FileEntry[] = []
): Promise<FileEntry[]> {
  if (currentDepth >= maxDepth) return collected;

  let files: import("fs").Dirent[];
  try {
    files = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const file of files) {
    if (IGNORE_DIRS.has(file.name)) continue;

    const fullPath = path.join(dir, file.name);
    const ext = path.extname(file.name);

    if (IGNORE_EXTENSIONS.has(ext)) continue;

    if (file.isDirectory()) {
      collected.push({ path: fullPath, type: "dir" });
      await collectFiles(fullPath, maxDepth, currentDepth + 1, collected);
    } else {
      let size: number | undefined;
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        // ignore
      }
      collected.push({ path: fullPath, type: "file", size, ext });
    }
  }

  return collected;
}

/**
 * Read a file up to a byte limit, returning a truncated string if needed.
 */
async function readFileSample(filePath: string, maxBytes = MAX_FILE_READ_BYTES): Promise<string> {
  try {
    const buf = Buffer.alloc(maxBytes);
    const fd = await fs.open(filePath, "r");
    try {
      const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
      const content = buf.subarray(0, bytesRead).toString("utf-8");
      const stat = await fd.stat();
      if (stat.size > maxBytes) {
        return `${content}\n... [truncated — ${stat.size} bytes total]`;
      }
      return content;
    } finally {
      await fd.close();
    }
  } catch {
    return "[could not read file]";
  }
}

/**
 * Score a file's importance for analysis (higher = more important to read).
 */
function scoreFile(entry: FileEntry): number {
  const name = path.basename(entry.path);
  const ext = entry.ext ?? "";

  if (KEY_FILENAMES.has(name)) return 100;

  // Entrypoints
  if (["index.ts", "index.js", "main.ts", "main.py", "app.ts", "server.ts"].includes(name))
    return 90;

  // Schema / config
  if ([".prisma", ".graphql", ".sql"].includes(ext)) return 80;
  if ([".yml", ".yaml", ".toml"].includes(ext)) return 60;

  // Core code
  if ([".ts", ".tsx", ".py", ".go", ".rs"].includes(ext)) return 50;
  if ([".js", ".jsx", ".rb", ".php"].includes(ext)) return 40;

  return 10;
}

export interface CodebaseDigest {
  tree: string;
  stats: {
    totalFiles: number;
    totalDirs: number;
    byExtension: Record<string, number>;
    estimatedSizeKb: number;
  };
  keyFiles: Array<{
    path: string;
    content: string;
  }>;
}

/**
 * Scan a codebase and return a structured digest:
 * - A formatted directory tree
 * - File extension statistics
 * - Sampled contents of the most important files
 */
export async function buildCodebaseDigest(rootDir: string, maxDepth = 4): Promise<CodebaseDigest> {
  const tree = await walkDir(rootDir, maxDepth);
  const allFiles = await collectFiles(rootDir, maxDepth);

  const stats = {
    totalFiles: 0,
    totalDirs: 0,
    byExtension: {} as Record<string, number>,
    estimatedSizeKb: 0,
  };

  for (const entry of allFiles) {
    if (entry.type === "dir") {
      stats.totalDirs++;
    } else {
      stats.totalFiles++;
      if (entry.size) stats.estimatedSizeKb += entry.size / 1024;
      const ext = entry.ext || "(no ext)";
      stats.byExtension[ext] = (stats.byExtension[ext] ?? 0) + 1;
    }
  }
  stats.estimatedSizeKb = Math.round(stats.estimatedSizeKb);

  // Pick the most important files to sample
  const codeFiles = allFiles
    .filter(
      (e) =>
        e.type === "file" &&
        (CODE_EXTENSIONS.has(e.ext ?? "") || KEY_FILENAMES.has(path.basename(e.path)))
    )
    .sort((a, b) => scoreFile(b) - scoreFile(a))
    .slice(0, MAX_DIGEST_FILES);

  const keyFiles: CodebaseDigest["keyFiles"] = [];
  for (const entry of codeFiles) {
    const content = await readFileSample(entry.path);
    keyFiles.push({
      path: path.relative(rootDir, entry.path),
      content,
    });
  }

  return { tree, stats, keyFiles };
}
