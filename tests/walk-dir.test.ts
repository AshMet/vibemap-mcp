import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { walkDir } from '../src/utils';

vi.mock('fs/promises');

describe('walkDir', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('scans a simple directory structure', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'file1.txt', isDirectory: () => false } as any,
      { name: 'subdir', isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'file2.txt', isDirectory: () => false } as any,
    ]);

    const result = await walkDir('/root', 3);
    
    expect(result).toContain('file1.txt');
    expect(result).toContain('[DIR] subdir');
    expect(result).toContain('  file2.txt');
  });

  it('respects depth limits', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'level1', isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'level2', isDirectory: () => true } as any,
    ]);

    const result = await walkDir('/root', 1);
    
    expect(result).toContain('[DIR] level1');
    expect(result).not.toContain('[DIR] level2');
  });

  it('skips ignored directories', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'node_modules', isDirectory: () => true } as any,
      { name: '.git', isDirectory: () => true } as any,
      { name: 'src', isDirectory: () => true } as any,
    ]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await walkDir('/root', 3);
    
    expect(result).not.toContain('node_modules');
    expect(result).not.toContain('.git');
    expect(result).toContain('[DIR] src');
  });

  it('handles empty directories', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await walkDir('/root', 3);
    expect(result).toBe('');
  });
});
