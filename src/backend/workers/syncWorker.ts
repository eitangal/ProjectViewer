import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { BareGitManager } from '../services/gitManager.js';
import {
  GeminiRagService,
  chunkFileContent,
  isIndexableFile,
} from '../services/geminiRagService.js';
import { decryptSecret } from '../utils/crypto.js';
import { resolveAuthorizedFiles } from '../services/aclMatcher.js';
import { GroupAclRule, RepoFileEntryWithSha } from '@/shared/types.js';
import { ProjectCopierService } from '../services/projectCopier.js';

export interface RetrievedChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  distance: number;
}

export class ProjectSyncAndRagOrchestrator {
  private scheduledTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly gitManager: BareGitManager,
    private readonly geminiService: GeminiRagService,
    private readonly projectCopier?: ProjectCopierService
  ) {}

  /**
   * Executes incremental Git sync + delta Gemini vector indexing
   */
  public async syncProject(
    projectId: string,
    triggerType: 'MANUAL' | 'WEBHOOK' | 'SCHEDULED' = 'MANUAL',
    options?: { forceReindex?: boolean }
  ): Promise<{
    oldSha: string | null;
    newSha: string;
    totalFiles: number;
    indexedFiles: number;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const project = this.db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const owner = this.db
      .prepare(`SELECT max_disk_quota_bytes FROM users WHERE id = ?`)
      .get(project.owner_id) as { max_disk_quota_bytes: number } | undefined;

    this.db
      .prepare(`UPDATE projects SET sync_status = 'SYNCING', last_sync_error = NULL WHERE id = ?`)
      .run(projectId);

    try {
      const githubPat = project.encrypted_github_pat
        ? decryptSecret(project.encrypted_github_pat)
        : undefined;
      const geminiKey = project.encrypted_gemini_key
        ? decryptSecret(project.encrypted_gemini_key)
        : undefined;

      // 1. Fetch bare repository and resolve HEAD SHA
      const isLocal = !!project.is_local_repo;
      const newSha = await this.gitManager.syncBareRepo(
        projectId,
        project.repo_url,
        project.branch,
        githubPat,
        isLocal
      );

      // Clear cache and count total files in HEAD commit
      this.gitManager.clearCache(projectId);
      const allRepoFilesWithShas = await this.gitManager.listRepoFilesWithShas(projectId, newSha);
      const totalFiles = allRepoFilesWithShas.length;

      // Check repo disk usage against publisher quota
      const diskBytes = await this.gitManager.getRepoDiskUsageBytes(projectId);
      if (owner && diskBytes > owner.max_disk_quota_bytes) {
        throw new Error(
          `Project repository size (${Math.round(diskBytes / 1024 / 1024)}MB) exceeds publisher disk quota (${Math.round(owner.max_disk_quota_bytes / 1024 / 1024)}MB).`
        );
      }

      const oldSha = project.last_synced_sha;
      let indexedFiles = 0;

      // 2. Incremental RAG Directory Tree Snapshot Diffing
      if (geminiKey) {
        const currentMap = new Map<string, RepoFileEntryWithSha>();
        for (const f of allRepoFilesWithShas) {
          currentMap.set(f.filePath, f);
        }

        const prevSnapshots = this.db
          .prepare(`SELECT file_path, blob_sha, size_bytes FROM rag_file_snapshots WHERE project_id = ?`)
          .all(projectId) as { file_path: string; blob_sha: string; size_bytes: number }[];

        const prevMap = new Map<string, { blob_sha: string; size_bytes: number }>();
        for (const s of prevSnapshots) {
          prevMap.set(s.file_path, s);
        }

        // Determine Added, Modified, Deleted
        const addedTargets: RepoFileEntryWithSha[] = [];
        const modifiedTargets: RepoFileEntryWithSha[] = [];
        const pathsToDelete: string[] = [];

        if (options?.forceReindex) {
          // Force re-indexing of all indexable files
          for (const f of allRepoFilesWithShas) {
            if (isIndexableFile(f.filePath)) {
              addedTargets.push(f);
            }
          }
          for (const s of prevSnapshots) {
            pathsToDelete.push(s.file_path);
          }
        } else {
          // Compare current HEAD tree vs stored snapshot
          for (const [filePath, currentEntry] of currentMap.entries()) {
            if (!isIndexableFile(filePath)) continue;

            const prevEntry = prevMap.get(filePath);
            if (!prevEntry) {
              // File is newly added
              addedTargets.push(currentEntry);
            } else if (prevEntry.blob_sha !== currentEntry.blobSha) {
              // File content was modified
              modifiedTargets.push(currentEntry);
              pathsToDelete.push(filePath);
            }
            // else: identical blobSha -> UNCHANGED! Skip completely.
          }

          // Check for files deleted from repository
          for (const s of prevSnapshots) {
            if (!currentMap.has(s.file_path)) {
              pathsToDelete.push(s.file_path);
            }
          }
        }

        // 3. Delete old chunks & vectors for modified/deleted files
        if (pathsToDelete.length > 0) {
          const deleteTx = this.db.transaction((paths: string[]) => {
            const selectIds = this.db.prepare(
              `SELECT id FROM doc_chunks WHERE project_id = ? AND file_path = ?`
            );
            const delVec = this.db.prepare(`DELETE FROM vec_chunks WHERE chunk_id = ?`);
            const delChunk = this.db.prepare(`DELETE FROM doc_chunks WHERE id = ?`);
            const delSnapshot = this.db.prepare(
              `DELETE FROM rag_file_snapshots WHERE project_id = ? AND file_path = ?`
            );

            for (const p of paths) {
              const rows = selectIds.all(projectId, p) as { id: number }[];
              for (const r of rows) {
                delVec.run(r.id);
                delChunk.run(r.id);
              }
              delSnapshot.run(projectId, p);
            }
          });
          deleteTx(pathsToDelete);
        }

        // 4. Chunk & embed Added and Modified files only
        const targetsToEmbed = [...addedTargets, ...modifiedTargets];
        const insertChunk = this.db.prepare(`
          INSERT INTO doc_chunks (project_id, file_path, start_line, end_line, content)
          VALUES (?, ?, ?, ?, ?)
        `);
        const insertVec = this.db.prepare(`
          INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)
        `);
        const upsertSnapshot = this.db.prepare(`
          INSERT INTO rag_file_snapshots (project_id, file_path, blob_sha, size_bytes, chunk_count, last_indexed_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, file_path) DO UPDATE SET
            blob_sha = excluded.blob_sha,
            size_bytes = excluded.size_bytes,
            chunk_count = excluded.chunk_count,
            last_indexed_at = excluded.last_indexed_at
        `);

        for (const item of targetsToEmbed) {
          try {
            const rawText = await this.gitManager.readFileBlob(
              projectId,
              newSha,
              item.filePath
            );
            const chunks = chunkFileContent(item.filePath, rawText);
            if (chunks.length === 0) {
              // Record in snapshot with 0 chunks so it's not repeatedly checked
              upsertSnapshot.run(projectId, item.filePath, item.blobSha, item.sizeBytes, 0, Date.now());
              continue;
            }

            const embeddings = await this.geminiService.embedChunks(
              geminiKey,
              chunks.map((c) => c.content),
              project.gemini_embedding_model || 'gemini-embedding-001'
            );

            const insertFileTx = this.db.transaction(() => {
              for (let i = 0; i < chunks.length; i++) {
                const c = chunks[i];
                const info = insertChunk.run(
                  projectId,
                  c.filePath,
                  c.startLine,
                  c.endLine,
                  c.content
                );
                insertVec.run(
                  BigInt(info.lastInsertRowid),
                  new Uint8Array(embeddings[i].buffer)
                );
              }
              upsertSnapshot.run(
                projectId,
                item.filePath,
                item.blobSha,
                item.sizeBytes,
                chunks.length,
                Date.now()
              );
            });
            insertFileTx();
            indexedFiles++;
          } catch (fileErr) {
            console.error(`Failed to index file ${item.filePath}:`, fileErr);
          }
        }
      }

      // 5. Automatic Copy to Additional Location if configured
      if (project.additional_copy_path && project.auto_copy_on_sync && this.projectCopier) {
        try {
          await this.projectCopier.copyProjectToLocation(
            projectId,
            project.additional_copy_path,
            {
              commitSha: newSha,
              copyMode: project.copy_mode,
              localSourcePath: project.local_source_path,
            }
          );
        } catch (copyErr) {
          console.error(`Failed to auto-copy project ${projectId} to ${project.additional_copy_path}:`, copyErr);
        }
      }

      const durationMs = Date.now() - startTime;

      // 4. Update project record and sync logs
      this.db
        .prepare(`
          UPDATE projects
          SET last_synced_sha = ?,
              last_synced_at = ?,
              disk_usage_bytes = ?,
              total_files = ?,
              sync_status = 'IDLE',
              last_sync_error = NULL
          WHERE id = ?
        `)
        .run(newSha, Date.now(), diskBytes, totalFiles, projectId);

      this.db
        .prepare(`
          INSERT INTO sync_logs (id, project_id, trigger_type, old_sha, new_sha, total_files, indexed_files, status, error_message, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          triggerType,
          oldSha,
          newSha,
          totalFiles,
          indexedFiles,
          durationMs,
          Date.now()
        );

      return { oldSha, newSha, totalFiles, indexedFiles, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err.message || 'Unknown sync error';

      this.db
        .prepare(`
          UPDATE projects
          SET sync_status = 'ERROR',
              last_sync_error = ?
          WHERE id = ?
        `)
        .run(errorMsg, projectId);

      this.db
        .prepare(`
          INSERT INTO sync_logs (id, project_id, trigger_type, old_sha, new_sha, total_files, indexed_files, status, error_message, duration_ms, created_at)
          VALUES (?, ?, ?, ?, NULL, 0, 0, 'ERROR', ?, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          triggerType,
          project.last_synced_sha,
          errorMsg,
          durationMs,
          Date.now()
        );

      throw err;
    }
  }

  /**
   * Executes ACL-Filtered Vector Retrieval:
   * Only chunks belonging to files permitted by the viewer's ACL groups can be retrieved.
   */
  public async retrieveAuthorizedContext(
    projectId: string,
    userGroupRules: GroupAclRule[],
    userQuestion: string,
    topK = 6
  ): Promise<RetrievedChunk[]> {
    const project = this.db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project?.encrypted_gemini_key || !project?.last_synced_sha) {
      throw new Error('RAG assistant is not configured or project has not been synced.');
    }

    // Auto-index repository chunks on-the-fly if not yet indexed
    const existingChunkCount = (this.db
      .prepare(`SELECT COUNT(*) as cnt FROM doc_chunks WHERE project_id = ?`)
      .get(projectId) as any)?.cnt ?? 0;

    if (existingChunkCount === 0) {
      await this.syncProject(projectId, 'MANUAL', { forceReindex: true });
    }

    // 1. Resolve exact authorized file list for this viewer's groups
    const allRepoFiles = await this.gitManager.listRepoFiles(
      projectId,
      project.last_synced_sha
    );
    const authorizedPaths = resolveAuthorizedFiles(allRepoFiles, userGroupRules);

    // ZERO-LEAKAGE GUARANTEE: If viewer has no access to any files, return empty immediately
    if (authorizedPaths.length === 0) {
      return [];
    }

    // 2. Embed user query using Publisher's Gemini API key
    const geminiKey = decryptSecret(project.encrypted_gemini_key);
    const [queryVector] = await this.geminiService.embedChunks(
      geminiKey,
      [userQuestion],
      project.gemini_embedding_model || 'gemini-embedding-001'
    );

    // 3. Query sqlite-vec joined strictly against authorized file paths
    const placeholders = authorizedPaths.map(() => '?').join(',');
    const sql = `
      SELECT
        c.file_path AS filePath,
        c.start_line AS startLine,
        c.end_line AS endLine,
        c.content AS content,
        vec_distance_cosine(v.embedding, ?) AS distance
      FROM vec_chunks v
      JOIN doc_chunks c ON c.id = v.chunk_id
      WHERE c.project_id = ?
        AND c.file_path IN (${placeholders})
      ORDER BY distance ASC
      LIMIT ?
    `;

    return this.db
      .prepare(sql)
      .all(
        new Uint8Array(queryVector.buffer),
        projectId,
        ...authorizedPaths,
        topK
      ) as RetrievedChunk[];
  }

  /**
   * Starts periodic polling for projects with sync_interval_minutes > 0
   */
  public startScheduledSyncWorker(pollIntervalSeconds = 60): void {
    if (this.scheduledTimer) return;

    this.scheduledTimer = setInterval(async () => {
      try {
        const now = Date.now();
        const candidateProjects = this.db
          .prepare(`
            SELECT id, sync_interval_minutes, last_synced_at
            FROM projects
            WHERE sync_interval_minutes > 0 AND sync_status != 'SYNCING'
          `)
          .all() as { id: string; sync_interval_minutes: number; last_synced_at: number | null }[];

        for (const proj of candidateProjects) {
          const intervalMs = proj.sync_interval_minutes * 60 * 1000;
          const lastSync = proj.last_synced_at || 0;
          if (now - lastSync >= intervalMs) {
            this.syncProject(proj.id, 'SCHEDULED').catch((err) =>
              console.error(`Scheduled sync error on ${proj.id}:`, err.message)
            );
          }
        }
      } catch (err) {
        console.error('Error in scheduled sync worker:', err);
      }
    }, pollIntervalSeconds * 1000);
  }

  public stopScheduledSyncWorker(): void {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }
}
