import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { InspectLocalRepoResponse } from '@/shared/types.js';

const execFileAsync = promisify(execFile);

export class LocalRepoService {
  /**
   * Inspects a local filesystem directory path to check if it's a valid Git repository
   * and extracts repository metadata (branch, commit SHA, file count, suggested name).
   */
  public async inspectLocalRepo(rawPath: string): Promise<InspectLocalRepoResponse> {
    if (!rawPath || typeof rawPath !== 'string') {
      return {
        isValid: false,
        suggestedName: '',
        currentBranch: 'main',
        branches: [],
        headCommitSha: '',
        commitMessage: '',
        totalFiles: 0,
        isBare: false,
        error: 'A valid filesystem path is required',
      };
    }

    const resolvedPath = path.resolve(rawPath.trim());

    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return {
          isValid: false,
          suggestedName: path.basename(resolvedPath),
          currentBranch: 'main',
          branches: [],
          headCommitSha: '',
          commitMessage: '',
          totalFiles: 0,
          isBare: false,
          error: `Path "${resolvedPath}" is not a directory`,
        };
      }
    } catch {
      return {
        isValid: false,
        suggestedName: path.basename(resolvedPath),
        currentBranch: 'main',
        branches: [],
        headCommitSha: '',
        commitMessage: '',
        totalFiles: 0,
        isBare: false,
        error: `Directory "${resolvedPath}" does not exist on the VPS host`,
      };
    }

    // Check if it's a bare or working-tree Git repository
    let isBare = false;
    try {
      const { stdout: bareStdout } = await execFileAsync(
        'git',
        ['-c', 'safe.directory=*', 'rev-parse', '--is-bare-repository'],
        { cwd: resolvedPath }
      );
      isBare = bareStdout.trim() === 'true';

      if (!isBare) {
        // Ensure that resolvedPath is the standalone repository root,
        // not a subdirectory inside a parent repository
        const { stdout: toplevelStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'rev-parse', '--show-toplevel'],
          { cwd: resolvedPath }
        );
        const toplevel = path.resolve(toplevelStdout.trim());
        if (toplevel !== resolvedPath) {
          return {
            isValid: false,
            suggestedName: path.basename(resolvedPath),
            currentBranch: 'main',
            branches: [],
            headCommitSha: '',
            commitMessage: '',
            totalFiles: 0,
            isBare: false,
            error: `Directory "${resolvedPath}" is a subdirectory inside "${toplevel}", not a standalone Git repository root`,
          };
        }
      }
    } catch {
      return {
        isValid: false,
        suggestedName: path.basename(resolvedPath).replace(/\.git$/, ''),
        currentBranch: 'main',
        branches: [],
        headCommitSha: '',
        commitMessage: '',
        totalFiles: 0,
        isBare: false,
        error: `Directory "${resolvedPath}" is not a valid Git repository (missing .git or Git metadata)`,
      };
    }

    try {
      // Get current branch
      let currentBranch = 'main';
      try {
        const { stdout: branchStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: resolvedPath }
        );
        const b = branchStdout.trim();
        if (b && b !== 'HEAD') {
          currentBranch = b;
        }
      } catch {}

      // Get list of local branches
      let branches: string[] = [];
      try {
        const { stdout: branchesStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
          { cwd: resolvedPath }
        );
        branches = branchesStdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
      } catch {}

      if (branches.length === 0) {
        branches = [currentBranch];
      } else if (!branches.includes(currentBranch)) {
        branches.unshift(currentBranch);
      }

      // Get latest HEAD commit SHA and commit message
      let headCommitSha = '';
      let commitMessage = '';
      try {
        const { stdout: shaStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'],
          { cwd: resolvedPath }
        );
        headCommitSha = shaStdout.trim();

        const { stdout: msgStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'log', '-1', '--pretty=%s'],
          { cwd: resolvedPath }
        );
        commitMessage = msgStdout.trim();
      } catch {
        return {
          isValid: false,
          suggestedName: path.basename(resolvedPath).replace(/\.git$/, ''),
          currentBranch,
          branches,
          headCommitSha: '',
          commitMessage: '',
          totalFiles: 0,
          isBare,
          error: `Git repository has no commits on branch "${currentBranch}"`,
        };
      }

      // Count files in HEAD tree
      let totalFiles = 0;
      try {
        const { stdout: treeStdout } = await execFileAsync(
          'git',
          ['-c', 'safe.directory=*', 'ls-tree', '-r', '--name-only', headCommitSha],
          { cwd: resolvedPath, maxBuffer: 25 * 1024 * 1024 }
        );
        totalFiles = treeStdout.split('\n').filter((l) => l.trim().length > 0).length;
      } catch {}

      const rawBaseName = path.basename(resolvedPath).replace(/\.git$/, '');
      const suggestedName = rawBaseName || 'local-project';

      return {
        isValid: true,
        suggestedName,
        currentBranch,
        branches,
        headCommitSha,
        commitMessage,
        totalFiles,
        isBare,
      };
    } catch (err: any) {
      return {
        isValid: false,
        suggestedName: path.basename(resolvedPath).replace(/\.git$/, ''),
        currentBranch: 'main',
        branches: [],
        headCommitSha: '',
        commitMessage: '',
        totalFiles: 0,
        isBare,
        error: err.message || 'Failed to inspect Git repository',
      };
    }
  }
}
