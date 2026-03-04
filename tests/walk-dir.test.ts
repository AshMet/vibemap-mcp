import * as fs from "fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCodebaseDigest, walkDir } from "../src/utils";

vi.mock("fs/promises");

describe("walkDir", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("scans a simple directory structure", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "file1.txt", isDirectory: () => false } as any,
      { name: "subdir", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "file2.txt", isDirectory: () => false } as any,
    ]);

    const result = await walkDir("/root", 3);

    expect(result).toContain("file1.txt");
    expect(result).toContain("📁 subdir");
    expect(result).toContain("file2.txt");
  });

  it("respects depth limits", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "level1", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "level2", isDirectory: () => true } as any,
    ]);

    const result = await walkDir("/root", 1);

    expect(result).toContain("📁 level1");
    expect(result).not.toContain("📁 level2");
  });

  it("skips ignored directories", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "node_modules", isDirectory: () => true } as any,
      { name: ".git", isDirectory: () => true } as any,
      { name: ".next", isDirectory: () => true } as any,
      { name: "dist", isDirectory: () => true } as any,
      { name: "src", isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await walkDir("/root", 3);

    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".git");
    expect(result).not.toContain(".next");
    expect(result).not.toContain("dist");
    expect(result).toContain("📁 src");
  });

  it("handles empty directories", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await walkDir("/root", 3);
    expect(result).toBe("");
  });

  it("returns error string if directory is unreadable", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("EACCES: permission denied"));

    const result = await walkDir("/root/secret", 3);
    expect(result).toContain("[Error reading directory:");
    expect(result).toContain("/root/secret");
  });

  it("sorts directories before files alphabetically", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "zebra.ts", isDirectory: () => false } as any,
      { name: "alpha", isDirectory: () => true } as any,
      { name: "apple.ts", isDirectory: () => false } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await walkDir("/root", 2);
    const lines = result.split("\n").filter(Boolean);

    // Directory should appear before files
    const dirIndex = lines.findIndex((l) => l.includes("📁 alpha"));
    const fileIndex = lines.findIndex((l) => l.includes("apple.ts"));
    expect(dirIndex).toBeLessThan(fileIndex);
  });

  it("returns empty string when depth is 0", async () => {
    const result = await walkDir("/root", 0);
    expect(result).toBe("");
    expect(fs.readdir).not.toHaveBeenCalled();
  });
});

describe("buildCodebaseDigest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns tree, stats, and keyFiles", async () => {
    // Root dir listing
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        { name: "src", isDirectory: () => true } as any,
        { name: "package.json", isDirectory: () => false } as any,
      ])
      // src/ listing (for walkDir)
      .mockResolvedValueOnce([
        { name: "index.ts", isDirectory: () => false } as any,
      ])
      // src/ listing (for collectFiles)
      .mockResolvedValueOnce([
        { name: "index.ts", isDirectory: () => false } as any,
      ])
      // root listing (for collectFiles root)
      .mockResolvedValueOnce([
        { name: "src", isDirectory: () => true } as any,
        { name: "package.json", isDirectory: () => false } as any,
      ]);

    vi.mocked(fs.stat).mockResolvedValue({ size: 2048 } as any);

    // Mock file reads
    const mockFd = {
      read: vi.fn().mockResolvedValue({ bytesRead: 100 }),
      stat: vi.fn().mockResolvedValue({ size: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(fs.open).mockResolvedValue(mockFd as any);

    const digest = await buildCodebaseDigest("/project", 2);

    expect(digest).toHaveProperty("tree");
    expect(digest).toHaveProperty("stats");
    expect(digest).toHaveProperty("keyFiles");
    expect(digest.stats.totalFiles).toBeGreaterThanOrEqual(0);
  });

  it("stats include byExtension counts", async () => {
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([]) // walkDir root
      .mockResolvedValueOnce([  // collectFiles root
        { name: "app.ts", isDirectory: () => false } as any,
        { name: "style.css", isDirectory: () => false } as any,
        { name: "utils.ts", isDirectory: () => false } as any,
      ]);

    vi.mocked(fs.stat).mockResolvedValue({ size: 512 } as any);

    const digest = await buildCodebaseDigest("/project", 2);

    expect(digest.stats.totalFiles).toBe(3);
    expect(digest.stats.byExtension[".ts"]).toBe(2);
    expect(digest.stats.byExtension[".css"]).toBe(1);
  });

  it("returns empty tree and zero stats for empty directory", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);

    const digest = await buildCodebaseDigest("/empty", 2);

    expect(digest.tree).toBe("");
    expect(digest.stats.totalFiles).toBe(0);
    expect(digest.stats.totalDirs).toBe(0);
    expect(digest.keyFiles).toHaveLength(0);
  });
});
