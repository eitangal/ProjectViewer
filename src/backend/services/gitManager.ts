import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileDelta, RepoFileEntry, RepoFileEntryWithSha } from '@/shared/types.js';

const execFileAsync = promisify(execFile);

const FORBIDDEN_SYSTEM_PREFIXES = ['/etc', '/proc', '/sys', '/dev', '/boot', '/root', '/var/run'];

export function validateGitBranchName(branch: string): void {
  const trimmed = (branch || '').trim();
  if (
    !trimmed ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.lock') ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    !/^[a-zA-Z0-9._/-]+$/.test(trimmed)
  ) {
    throw new Error('Invalid Git branch or reference name');
  }
}

export function validateCommitSha(commitSha: string): void {
  const trimmed = (commitSha || '').trim();
  if (!trimmed || trimmed.startsWith('-') || (!/^[0-9a-fA-F]{4,64}$/.test(trimmed) && trimmed !== 'HEAD')) {
    throw new Error('Invalid Git commit SHA');
  }
}

export function validateRepositorySource(
  rawUrl: string,
  options?: { allowLocal?: boolean }
): void {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.startsWith('-')) {
    throw new Error('Invalid repository URL');
  }

  // Block git remote helper syntax (e.g. ext::, fd::, etc.) and file:// scheme
  if (/^[a-zA-Z0-9+.-]+::/.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    throw new Error('Unsupported or unsafe Git transport protocol');
  }

  // Handle local filesystem paths
  if (trimmed.startsWith('/')) {
    const resolved = path.resolve(trimmed);
    const isForbiddenSystemDir = FORBIDDEN_SYSTEM_PREFIXES.some(
      (prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`)
    );
    if (isForbiddenSystemDir) {
      throw new Error('Access to restricted system directory is forbidden');
    }

    const isVitestTempRepo =
      Boolean(process.env.VITEST) &&
      resolved.startsWith(path.join(os.tmpdir(), 'gitlens-'));

    if (!options?.allowLocal && !isVitestTempRepo) {
      throw new Error('Local filesystem repository paths are restricted to SysAdmin');
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid repository URL: must be a valid HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS Git repository URLs are permitted');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Repository URL must not contain embedded credentials; use GitHub PAT instead');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('Internal, loopback, or private network repository URLs are not permitted');
  }
}

export class BareGitManager {
  private fileCache: Map<string, RepoFileEntry[]> = new Map();

  constructor(private readonly baseReposDir: string) {
    execFile('git', ['config', '--global', '--add', 'safe.directory', '*'], () => {});
  }

  public getRepoDir(projectId: string): string {
    return path.join(this.baseReposDir, `${projectId}.git`);
  }

  /**
   * Builds an authenticated HTTPS URL in-memory without persisting tokens in .git/config
   */
  private buildAuthHeader(githubPat?: string): string[] {
    const args = ['-c', 'safe.directory=*'];
    if (!githubPat) return args;
    const basicAuth = Buffer.from(`x-access-token:${githubPat}`).toString('base64');
    return [...args, '-c', `http.extraHeader=Authorization: Basic ${basicAuth}`];
  }

  /**
   * Initializes a bare clone or fetches the latest commit on the target branch.
   * Supports both remote HTTPS repositories and local VPS directory clones.
   * Returns the newly fetched HEAD commit SHA.
   */
  public async syncBareRepo(
    projectId: string,
    repoUrl: string,
    branch: string = 'main',
    githubPat?: string,
    isLocal: boolean = false
  ): Promise<string> {
    validateGitBranchName(branch);
    validateRepositorySource(repoUrl, { allowLocal: isLocal });

    const repoDir = this.getRepoDir(projectId);
    const isLocalPath = isLocal || repoUrl.trim().startsWith('/');
    const authArgs = isLocalPath
      ? ['-c', 'safe.directory=*', '-c', 'protocol.file.allow=always']
      : [...this.buildAuthHeader(githubPat), '-c', 'protocol.allow=https'];

    const exists = await fs
      .stat(repoDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await fs.mkdir(path.dirname(repoDir), { recursive: true });
      const cloneArgs = isLocalPath
        ? [
            ...authArgs,
            'clone',
            '--bare',
            '--single-branch',
            '--branch',
            branch,
            '--',
            repoUrl,
            repoDir,
          ]
        : [
            ...authArgs,
            'clone',
            '--bare',
            '--depth',
            '2',
            '--single-branch',
            '--branch',
            branch,
            '--',
            repoUrl,
            repoDir,
          ];

      await execFileAsync('git', cloneArgs);
    } else {
      const fetchArgs = isLocalPath
        ? [
            ...authArgs,
            'fetch',
            'origin',
            `${branch}:${branch}`,
            '--prune',
          ]
        : [
            ...authArgs,
            'fetch',
            'origin',
            `${branch}:${branch}`,
            '--depth',
            '2',
            '--prune',
          ];

      await execFileAsync('git', fetchArgs, { cwd: repoDir });
    }

    const { stdout } = await execFileAsync('git', ['-c', 'safe.directory=*', 'rev-parse', '--verify', `${branch}^{commit}`], { cwd: repoDir });
    return stdout.trim();
  }

  /**
   * Clears the in-memory file cache for a project or for all projects.
   */
  public clearCache(projectId?: string): void {
    if (projectId) {
      for (const key of this.fileCache.keys()) {
        if (key.startsWith(`${projectId}:`)) {
          this.fileCache.delete(key);
        }
      }
    } else {
      this.fileCache.clear();
    }
  }

  /**
   * Lists all files and their byte sizes in a commit tree (`git ls-tree -r -l`).
   * Explicitly sets core.quotePath=false so UTF-8 / Hebrew paths are unescaped and unquoted.
   */
  public async listRepoFiles(projectId: string, commitSha: string): Promise<RepoFileEntry[]> {
    validateCommitSha(commitSha);
    const cacheKey = `${projectId}:${commitSha}`;
    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey)!;
    }

    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', 'ls-tree', '-r', '-l', '--full-tree', commitSha],
      { cwd: repoDir, maxBuffer: 25 * 1024 * 1024 }
    );

    const entries: RepoFileEntry[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // Format: "<mode> <type> <object> <size>\t<file>"
      let [meta, filePath] = line.split('\t');
      if (!meta || !filePath) continue;

      filePath = filePath.trim();
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }

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
   * Lists all files with their byte sizes and Git 40-char blob object SHAs (`git ls-tree -r -l --full-tree`).
   * Used for deterministic snapshot comparisons and incremental RAG delta processing.
   */
  public async listRepoFilesWithShas(projectId: string, commitSha: string): Promise<RepoFileEntryWithSha[]> {
    validateCommitSha(commitSha);
    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', 'ls-tree', '-r', '-l', '--full-tree', commitSha],
      { cwd: repoDir, maxBuffer: 25 * 1024 * 1024 }
    );

    const entries: RepoFileEntryWithSha[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // Format: "<mode> <type> <blobSha> <sizeBytes>\t<filePath>"
      let [meta, filePath] = line.split('\t');
      if (!meta || !filePath) continue;

      filePath = filePath.trim();
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }

      const parts = meta.trim().split(/\s+/);
      const type = parts[1];
      const blobSha = parts[2];
      const sizeBytes = parseInt(parts[3], 10);
      if (type === 'blob' && filePath && blobSha && !Number.isNaN(sizeBytes)) {
        entries.push({ filePath, blobSha, sizeBytes });
      }
    }

    return entries;
  }

  /**
   * Computes changed files between two commits (`git diff --name-status`).
   * If oldSha is null (initial sync), treats all files in newSha as Added ('A').
   * Explicitly sets core.quotePath=false so UTF-8 / Hebrew paths are unescaped and unquoted.
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
        ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', 'diff', '--name-status', '--no-renames', oldSha, newSha],
        { cwd: repoDir, maxBuffer: 25 * 1024 * 1024 }
      );

      const deltas: FileDelta[] = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let [rawStatus, filePath] = line.split('\t');
        if (!rawStatus || !filePath) continue;

        filePath = filePath.trim();
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }

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
    validateCommitSha(commitSha);
    if (!filePath || filePath.startsWith('-') || filePath.includes('\0')) {
      throw new Error('Invalid repository file path');
    }
    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', 'cat-file', 'blob', `${commitSha}:${filePath}`],
      { cwd: repoDir, maxBuffer: 15 * 1024 * 1024 }
    );
    return stdout;
  }

  /**
   * Reads a file blob directly from the bare repository into memory as a Buffer.
   * Essential for binary files (images, PDFs, audio/video) to avoid UTF-8 string corruption.
   */
  public async readFileBlobBuffer(
    projectId: string,
    commitSha: string,
    filePath: string
  ): Promise<Buffer> {
    validateCommitSha(commitSha);
    if (!filePath || filePath.startsWith('-') || filePath.includes('\0')) {
      throw new Error('Invalid repository file path');
    }
    const repoDir = this.getRepoDir(projectId);
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', 'cat-file', 'blob', `${commitSha}:${filePath}`],
      { cwd: repoDir, maxBuffer: 30 * 1024 * 1024, encoding: 'buffer' }
    );
    return stdout as Buffer;
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
