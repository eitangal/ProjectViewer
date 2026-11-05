import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BareGitManager } from './gitManager.js';

export interface CopyResult {
  ok: boolean;
  targetPath: string;
  filesCount: number;
  durationMs: number;
  error?: string;
}

export class ProjectCopierService {
  constructor(
    private readonly db: Database.Database,
    private readonly gitManager: BareGitManager
  ) {}

  /**
   * Copies/exports the project's materialized tree at the given commit to an additional filesystem location.
   * If copyMode is 'WORKING_TREE', exports a clean materialized tree using `git archive | tar -x`.
   * If copyMode is 'FULL_REPO' and localSourcePath is provided, copies the full cloned working directory including .git.
   */
  public async copyProjectToLocation(
    projectId: string,
    targetPath: string,
    options?: {
      commitSha?: string;
      copyMode?: 'WORKING_TREE' | 'FULL_REPO';
      localSourcePath?: string;
    }
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const resolvedTarget = path.resolve(targetPath.trim());

    this.db
      .prepare(`UPDATE projects SET last_copy_status = 'COPYING', last_copy_error = NULL WHERE id = ?`)
      .run(projectId);

    try {
      await fs.mkdir(resolvedTarget, { recursive: true });

      const copyMode = options?.copyMode || 'WORKING_TREE';
      let filesCount = 0;

      if (copyMode === 'FULL_REPO' && options?.localSourcePath) {
        // Full local clone replication (including .git)
        const sourcePath = path.resolve(options.localSourcePath.trim());
        await fs.cp(sourcePath, resolvedTarget, { recursive: true, force: true });
        const entries = await fs.readdir(resolvedTarget);
        filesCount = entries.length;
      } else {
        // Clean working-tree export from bare repository (no .git internals)
        const repoDir = this.gitManager.getRepoDir(projectId);
        let commit = options?.commitSha;
        if (!commit) {
          const project = this.db
            .prepare(`SELECT last_synced_sha FROM projects WHERE id = ?`)
            .get(projectId) as any;
          commit = project?.last_synced_sha || 'HEAD';
        }
        const targetCommit = commit || 'HEAD';

        await new Promise<void>((resolve, reject) => {
          const gitProc = spawn('git', [
            '-c',
            'safe.directory=*',
            '-c',
            'core.quotePath=false',
            '-C',
            repoDir,
            'archive',
            targetCommit,
          ]);

          const tarProc = spawn('tar', ['-x', '-C', resolvedTarget]);

          let errorMsg = '';
          gitProc.stderr.on('data', (d) => {
            errorMsg += d.toString();
          });
          tarProc.stderr.on('data', (d) => {
            errorMsg += d.toString();
          });

          gitProc.stdout.pipe(tarProc.stdin);

          tarProc.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Extraction failed (code ${code}): ${errorMsg || 'tar error'}`));
            }
          });

          gitProc.on('error', reject);
          tarProc.on('error', reject);
        });

        const allFiles = await this.gitManager.listRepoFiles(projectId, targetCommit);
        filesCount = allFiles.length;
      }

      const durationMs = Date.now() - startTime;

      this.db
        .prepare(`
          UPDATE projects
          SET last_copied_at = ?,
              last_copy_status = 'SUCCESS',
              last_copy_error = NULL,
              additional_copy_path = ?
          WHERE id = ?
        `)
        .run(Date.now(), resolvedTarget, projectId);

      return {
        ok: true,
        targetPath: resolvedTarget,
        filesCount,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err.message || 'Failed to copy project to location';

      this.db
        .prepare(`
          UPDATE projects
          SET last_copy_status = 'ERROR',
              last_copy_error = ?
          WHERE id = ?
        `)
        .run(errorMsg, projectId);

      return {
        ok: false,
        targetPath: resolvedTarget,
        filesCount: 0,
        durationMs,
        error: errorMsg,
      };
    }
  }
}
