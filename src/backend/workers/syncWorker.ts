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
import { GroupAclRule } from '@/shared/types.js';

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
    private readonly geminiService: GeminiRagService
  ) {}

  /**
   * Executes incremental Git sync + delta Gemini vector indexing
   */
  public async syncProject(
    projectId: string,
    triggerType: 'MANUAL' | 'WEBHOOK' | 'SCHEDULED' = 'MANUAL'
  ): Promise<{
    oldSha: string | null;
    newSha: string;
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
      const newSha = await this.gitManager.syncBareRepo(
        projectId,
        project.repo_url,
        project.branch,
        githubPat
      );

      // Check repo disk usage against publisher quota
      const diskBytes = await this.gitManager.getRepoDiskUsageBytes(projectId);
      if (owner && diskBytes > owner.max_disk_quota_bytes) {
        throw new Error(
          `Project repository size (${Math.round(diskBytes / 1024 / 1024)}MB) exceeds publisher disk quota (${Math.round(owner.max_disk_quota_bytes / 1024 / 1024)}MB).`
        );
      }

      const oldSha = project.last_synced_sha;
      let indexedFiles = 0;

      // 2. Compute file delta between oldSha and newSha
      const deltas = await this.gitManager.getCommitDelta(
        projectId,
        oldSha,
        newSha
      );

      // 3. If Publisher provided a Gemini API key, incrementally update embeddings
      if (geminiKey && deltas.length > 0) {
        const pathsToRemove = deltas.map((d) => d.filePath);

        // Delete old chunks and vectors for Modified ('M') and Deleted ('D') files
        const deleteTx = this.db.transaction((paths: string[]) => {
          const selectIds = this.db.prepare(
            `SELECT id FROM doc_chunks WHERE project_id = ? AND file_path = ?`
          );
          const delVec = this.db.prepare(`DELETE FROM vec_chunks WHERE chunk_id = ?`);
          const delChunk = this.db.prepare(`DELETE FROM doc_chunks WHERE id = ?`);

          for (const p of paths) {
            const rows = selectIds.all(projectId, p) as { id: number }[];
            for (const r of rows) {
              delVec.run(r.id);
              delChunk.run(r.id);
            }
          }
        });
        deleteTx(pathsToRemove);

        // Chunk and embed Added ('A') and Modified ('M') files
        const upsertTargets = deltas.filter(
          (d) => (d.status === 'A' || d.status === 'M') && isIndexableFile(d.filePath)
        );

        const insertChunk = this.db.prepare(`
          INSERT INTO doc_chunks (project_id, file_path, start_line, end_line, content)
          VALUES (?, ?, ?, ?, ?)
        `);
        const insertVec = this.db.prepare(`
          INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)
        `);

        for (const item of upsertTargets) {
          try {
            const rawText = await this.gitManager.readFileBlob(
              projectId,
              newSha,
              item.filePath
            );
            const chunks = chunkFileContent(item.filePath, rawText);
            if (chunks.length === 0) continue;

            const embeddings = await this.geminiService.embedChunks(
              geminiKey,
              chunks.map((c) => c.content),
              project.gemini_embedding_model || 'text-embedding-004'
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
            });
            insertFileTx();
            indexedFiles++;
          } catch (fileErr) {
            console.error(`Failed to index file ${item.filePath}:`, fileErr);
          }
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
              sync_status = 'IDLE',
              last_sync_error = NULL
          WHERE id = ?
        `)
        .run(newSha, Date.now(), diskBytes, projectId);

      this.db
        .prepare(`
          INSERT INTO sync_logs (id, project_id, trigger_type, old_sha, new_sha, indexed_files, status, error_message, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          triggerType,
          oldSha,
          newSha,
          indexedFiles,
          durationMs,
          Date.now()
        );

      return { oldSha, newSha, indexedFiles, durationMs };
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
          INSERT INTO sync_logs (id, project_id, trigger_type, old_sha, new_sha, indexed_files, status, error_message, duration_ms, created_at)
          VALUES (?, ?, ?, ?, NULL, 0, 'ERROR', ?, ?, ?)
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
      project.gemini_embedding_model || 'text-embedding-004'
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
