import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileDelta, RepoFileEntry } from '@/shared/types.js';

const execFileAsync = promisify(execFile);

export class BareGitManager {
  private fileCache: Map<string, RepoFileEntry[]> = new Map();

  constructor(private readonly baseReposDir: string) {}

  public getRepoDir(projectId: string): string {
    return path.join(this.baseReposDir, `${projectId}.git`);
  }

  /**
   * Builds an authenticated HTTPS URL in-memory without persisting tokens in .git/config
   */
  private buildAuthHeader(githubPat?: string): string[] {
    if (!githubPat) return [];
    const basicAuth = Buffer.from(`x-access-token:${githubPat}`).toString('base64');
    return ['-c', `http.extraHeader=Authorization: Basic ${basicAuth}`];
  }

  /**
   * Initializes a bare clone or fetches the latest commit on the target branch.
   * Returns the newly fetched HEAD commit SHA.
   */
  public async syncBareRepo(
    projectId: string,
    repoUrl: string,
    branch: string = 'main',
    githubPat?: string
  ): Promise<string> {
    const repoDir = this.getRepoDir(projectId);
    const authArgs = this.buildAuthHeader(githubPat);

    const exists = await fs
      .stat(repoDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await fs.mkdir(path.dirname(repoDir), { recursive: true });
      await execFileAsync('git', [
        ...authArgs,
        'clone',
        '--bare',
        '--depth',
        '2',
        '--single-branch',
        '--branch',
        branch,
        repoUrl,
        repoDir,
      ]);
    } else {
      await execFileAsync(
        'git',
        [
          ...authArgs,
          'fetch',
          'origin',
          `${branch}:${branch}`,
          '--depth',
          '2',
          '--prune',
        ],
        { cwd: repoDir }
      );
    }

    const { stdout } = await execFileAsync('git', ['rev-parse', branch], { cwd: repoDir });
    return stdout.trim();
  }

  /**
   * Lists all files and their byte sizes in a commit tree (`git ls-tree -r -l`).
   */
  public async listRepoFiles(projectId: string, commitSha: string): Promise<RepoFileEntry[]> {
    const cacheKey = `${projectId}:${commitSha}`;
    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey)!;
    }

    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['ls-tree', '-r', '-l', '--full-tree', commitSha],
      { cwd: repoDir, maxBuffer: 25 * 1024 * 1024 }
    );

    const entries: RepoFileEntry[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // Format: "<mode> <type> <object> <size>\t<file>"
      const [meta, filePath] = line.split('\t');
      if (!meta || !filePath) continue;

      const parts = meta.trim().split(/\s+/);
      const type = parts[1];
      const sizeBytes = parseInt(parts[3], 10);
      if (type === 'blob' && filePath && !Number.isNaN(sizeBytes)) {
        entries.push({ filePath, sizeBytes });
      }
    }

    this.fileCache.set(cacheKey, entries);
    return entries;
  }

  /**
   * Computes changed files between two commits (`git diff --name-status`).
   * If oldSha is null (initial sync), treats all files in newSha as Added ('A').
   */
  public async getCommitDelta(
    projectId: string,
    oldSha: string | null,
    newSha: string
  ): Promise<FileDelta[]> {
    if (!oldSha) {
      const allFiles = await this.listRepoFiles(projectId, newSha);
      return allFiles.map((f) => ({ status: 'A', filePath: f.filePath }));
    }
    if (oldSha === newSha) return [];

    const repoDir = this.getRepoDir(projectId);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-status', '--no-renames', oldSha, newSha],
        { cwd: repoDir, maxBuffer: 25 * 1024 * 1024 }
      );

      const deltas: FileDelta[] = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [rawStatus, filePath] = line.split('\t');
        if (!rawStatus || !filePath) continue;
        const statusChar = rawStatus.trim()[0] as 'A' | 'M' | 'D';
        if (['A', 'M', 'D'].includes(statusChar) && filePath) {
          deltas.push({ status: statusChar, filePath });
        }
      }
      return deltas;
    } catch {
      // Fallback if shallow history was force-pushed past depth window
      const allFiles = await this.listRepoFiles(projectId, newSha);
      return allFiles.map((f) => ({ status: 'M', filePath: f.filePath }));
    }
  }

  /**
   * Reads a file blob directly from the bare repository into memory.
   */
  public async readFileBlob(
    projectId: string,
    commitSha: string,
    filePath: string
  ): Promise<string> {
    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['cat-file', 'blob', `${commitSha}:${filePath}`],
      { cwd: repoDir, maxBuffer: 15 * 1024 * 1024 }
    );
    return stdout;
  }

  /**
   * Calculates total disk usage in bytes for the project's bare repository directory.
   */
  public async getRepoDiskUsageBytes(projectId: string): Promise<number> {
    const repoDir = this.getRepoDir(projectId);
    try {
      return await calculateDirSize(repoDir);
    } catch {
      return 0;
    }
  }
}

async function calculateDirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await calculateDirSize(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        total += stats.size;
      }
    }
  } catch {
    // Return accumulated size
  }
  return total;
}
