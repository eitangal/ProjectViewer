import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from '../src/backend/app.js';
import { LocalRepoService } from '../src/backend/services/localRepoService.js';
import { ProjectCopierService } from '../src/backend/services/projectCopier.js';
import { GeminiRagService } from '../src/backend/services/geminiRagService.js';
import { ProjectSyncAndRagOrchestrator } from '../src/backend/workers/syncWorker.js';
import { encryptSecret } from '../src/backend/utils/crypto.js';

const execFileAsync = promisify(execFile);

describe('Local VPS Cloned Repositories, Incremental Snapshot RAG & Safe Deletion Lifecycle', () => {
  const testBaseDir = path.resolve(process.cwd(), 'tests/tmp/local-test-' + Date.now());
  const dbPath = path.join(testBaseDir, 'portal.db');
  const reposDir = path.join(testBaseDir, 'repos');
  const localSourceRepoDir = path.join(testBaseDir, 'my-local-source-repo');
  const additionalTargetDir = path.join(testBaseDir, 'additional-copy-location');

  let appInstance: ReturnType<typeof buildApp>;
  let adminUserId: string;
  let adminToken: string;

  beforeAll(async () => {
    await fs.mkdir(testBaseDir, { recursive: true });
    await fs.mkdir(localSourceRepoDir, { recursive: true });

    // Initialize a real local Git repository on disk with initial commits and UTF-8 files
    await execFileAsync('git', ['-c', 'safe.directory=*', 'init', '-b', 'main'], { cwd: localSourceRepoDir });
    await execFileAsync('git', ['-c', 'safe.directory=*', 'config', 'user.name', 'Test Dev'], { cwd: localSourceRepoDir });
    await execFileAsync('git', ['-c', 'safe.directory=*', 'config', 'user.email', 'dev@test.local'], { cwd: localSourceRepoDir });

    await fs.writeFile(path.join(localSourceRepoDir, 'README.md'), '# Local Test Repo\nThis is a local clone on the VPS.');
    await fs.writeFile(path.join(localSourceRepoDir, 'guide.md'), '## User Guide\nInitial version of guide.');
    await fs.mkdir(path.join(localSourceRepoDir, 'תוצרים'), { recursive: true });
    await fs.writeFile(path.join(localSourceRepoDir, 'תוצרים/מפרט.md'), '# מפרט טכני\nתוכן בעברית.');

    await execFileAsync('git', ['-c', 'safe.directory=*', 'add', '.'], { cwd: localSourceRepoDir });
    await execFileAsync('git', ['-c', 'safe.directory=*', 'commit', '-m', 'Initial commit of local repo'], { cwd: localSourceRepoDir });

    appInstance = buildApp({
      dbPath,
      reposDir,
      portalBaseUrl: 'http://localhost:3000',
      bootstrapSysAdminEmail: 'admin@gitlens-portal.local',
    });

    // Get admin user from DB
    const admin = appInstance.db.prepare(`SELECT id FROM users WHERE email = 'admin@gitlens-portal.local'`).get() as any;
    adminUserId = admin.id;

    // Authenticate admin and obtain JWT
    await appInstance.app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { email: 'admin@gitlens-portal.local' },
    });
    const mail = (appInstance.authService as any).mailer.getLastSentEmail('admin@gitlens-portal.local');
    const authRes = await appInstance.app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'admin@gitlens-portal.local', otpCode: mail.otpCode },
    });
    adminToken = JSON.parse(authRes.payload).token;
  });

  afterAll(async () => {
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Local Repository Inspection & Validation
  describe('LocalRepoService: Inspection & Validation', () => {
    it('successfully inspects a valid local cloned repository on the VPS disk', async () => {
      const service = new LocalRepoService();
      const result = await service.inspectLocalRepo(localSourceRepoDir);

      expect(result.isValid).toBe(true);
      expect(result.suggestedName).toBe('my-local-source-repo');
      expect(result.currentBranch).toBe('main');
      expect(result.branches).toContain('main');
      expect(result.headCommitSha).toHaveLength(40);
      expect(result.commitMessage).toBe('Initial commit of local repo');
      expect(result.totalFiles).toBe(3);
      expect(result.isBare).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('returns error when inspecting a non-existent path', async () => {
      const service = new LocalRepoService();
      const result = await service.inspectLocalRepo('/path/that/does/not/exist/anywhere');

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/does not exist/);
    });

    it('returns error when directory exists but is not a standalone Git repository root', async () => {
      const nonGitDir = path.join(testBaseDir, 'empty-non-git-dir');
      await fs.mkdir(nonGitDir, { recursive: true });

      const service = new LocalRepoService();
      const result = await service.inspectLocalRepo(nonGitDir);

      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/not a standalone Git repository root|not a valid Git repository/);
    });
  });

  // 2. Project Copier Service (Working Tree Clean Export & Full Repo)
  describe('ProjectCopierService: Export to Additional Location', () => {
    it('exports clean working tree to additional location preserving UTF-8 Hebrew files and omitting .git', async () => {
      const { db, gitManager } = appInstance;
      const copier = new ProjectCopierService(db, gitManager);

      // Setup a project in db and sync bare repo
      const projectId = 'test-proj-copier-1';
      db.prepare(`
        INSERT INTO projects (
          id, owner_id, name, repo_url, branch, is_local_repo, local_source_path, created_at
        ) VALUES (?, ?, 'Copier Test', ?, 'main', 1, ?, ?)
      `).run(projectId, adminUserId, localSourceRepoDir, localSourceRepoDir, Date.now());

      await gitManager.syncBareRepo(projectId, localSourceRepoDir, 'main', undefined, true);

      const copyResult = await copier.copyProjectToLocation(projectId, additionalTargetDir, {
        copyMode: 'WORKING_TREE',
        localSourcePath: localSourceRepoDir,
      });

      expect(copyResult.ok).toBe(true);
      expect(copyResult.filesCount).toBe(3);
      expect(copyResult.durationMs).toBeGreaterThanOrEqual(0);

      // Verify files physically exist on destination disk
      const readmeExists = await fs.stat(path.join(additionalTargetDir, 'README.md')).then(() => true).catch(() => false);
      const hebrewFileExists = await fs.stat(path.join(additionalTargetDir, 'תוצרים/מפרט.md')).then(() => true).catch(() => false);
      const dotGitExists = await fs.stat(path.join(additionalTargetDir, '.git')).then(() => true).catch(() => false);

      expect(readmeExists).toBe(true);
      expect(hebrewFileExists).toBe(true);
      // Clean working tree export MUST NOT include .git directory
      expect(dotGitExists).toBe(false);

      // Verify database recorded copy metadata
      const projRecord = db.prepare(`SELECT last_copy_status, last_copied_at FROM projects WHERE id = ?`).get(projectId) as any;
      expect(projRecord.last_copy_status).toBe('SUCCESS');
      expect(projRecord.last_copied_at).toBeGreaterThan(0);
    });
  });

  // 3. Incremental Directory Tree Snapshot RAG Sync
  describe('Incremental Snapshot RAG Synchronization', () => {
    it('creates persistent rag_file_snapshots and skips unchanged files on subsequent syncs', async () => {
      const { db, gitManager } = appInstance;
      const mockGemini = new GeminiRagService();

      let embedCallCount = 0;
      mockGemini.embedChunks = async (_key, chunks) => {
        embedCallCount += chunks.length;
        return chunks.map(() => new Float32Array(768).fill(0.1));
      };

      const syncWorker = new ProjectSyncAndRagOrchestrator(db, gitManager, mockGemini);

      const projectId = 'test-rag-snapshot-proj';
      db.prepare(`
        INSERT INTO projects (
          id, owner_id, name, repo_url, branch, is_local_repo, local_source_path,
          encrypted_gemini_key, created_at
        ) VALUES (?, ?, 'Snapshot Test', ?, 'main', 1, ?, ?, ?)
      `).run(projectId, adminUserId, localSourceRepoDir, localSourceRepoDir, encryptSecret('mock-key'), Date.now());

      // Initial Sync: should index all 3 indexable markdown files
      const syncResult1 = await syncWorker.syncProject(projectId, 'MANUAL');
      expect(syncResult1.indexedFiles).toBe(3);
      expect(embedCallCount).toBeGreaterThan(0);

      // Verify snapshot table populated in SQLite
      const snapshots1 = db
        .prepare(`SELECT file_path, blob_sha, size_bytes FROM rag_file_snapshots WHERE project_id = ?`)
        .all(projectId) as any[];

      expect(snapshots1).toHaveLength(3);
      const paths = snapshots1.map((s) => s.file_path);
      expect(paths).toContain('README.md');
      expect(paths).toContain('guide.md');
      expect(paths).toContain('תוצרים/מפרט.md');

      // Second Sync with NO changes on disk:
      const previousEmbedCalls = embedCallCount;
      const syncResult2 = await syncWorker.syncProject(projectId, 'MANUAL');

      // ZERO files re-indexed! Unchanged files are 100% skipped!
      expect(syncResult2.indexedFiles).toBe(0);
      expect(embedCallCount).toBe(previousEmbedCalls); // Gemini API was NOT called!

      // Modify 1 file and commit
      await fs.writeFile(path.join(localSourceRepoDir, 'guide.md'), '## User Guide\nModified second version with more text.');
      await execFileAsync('git', ['-c', 'safe.directory=*', 'commit', '-am', 'Update guide'], { cwd: localSourceRepoDir });

      // Third Sync: only the 1 modified file should be re-indexed!
      const syncResult3 = await syncWorker.syncProject(projectId, 'MANUAL');
      expect(syncResult3.indexedFiles).toBe(1);
      expect(embedCallCount).toBeGreaterThan(previousEmbedCalls);

      // Verify modified file snapshot was updated
      const updatedSnapshot = db
        .prepare(`SELECT blob_sha FROM rag_file_snapshots WHERE project_id = ? AND file_path = 'guide.md'`)
        .get(projectId) as any;
      const oldSnapshot = snapshots1.find((s) => s.file_path === 'guide.md');
      expect(updatedSnapshot.blob_sha).not.toBe(oldSnapshot.blob_sha);
    });
  });

  // 4. Safe Deletion Lifecycle Behavior
  describe('Safe Project Deletion Behavior', () => {
    it('deleting remote git project removes bare clone directory in data/repos', async () => {
      const { app, db, gitManager } = appInstance;

      // Insert mock remote project
      const remoteProjId = 'remote-git-project-to-delete';
      db.prepare(`
        INSERT INTO projects (
          id, owner_id, name, repo_url, branch, is_local_repo, created_at
        ) VALUES (?, ?, 'Remote Project', 'https://github.com/mock/repo.git', 'main', 0, ?)
      `).run(remoteProjId, adminUserId, Date.now());

      const remoteRepoDir = gitManager.getRepoDir(remoteProjId);
      await fs.mkdir(remoteRepoDir, { recursive: true });
      await fs.writeFile(path.join(remoteRepoDir, 'HEAD'), 'ref: refs/heads/main');

      // Delete via API
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${remoteProjId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);

      // Verify clone directory was deleted
      const cloneStillExists = await fs.stat(remoteRepoDir).then(() => true).catch(() => false);
      expect(cloneStillExists).toBe(false);

      // Verify DB row deleted
      const dbRow = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(remoteProjId);
      expect(dbRow).toBeUndefined();
    });

    it('deleting local drive project unpublishes index but PRESERVES local files on disk', async () => {
      const { app, db, gitManager } = appInstance;

      const localProjId = 'local-drive-project-to-delete';
      db.prepare(`
        INSERT INTO projects (
          id, owner_id, name, repo_url, branch, is_local_repo, local_source_path, additional_copy_path, created_at
        ) VALUES (?, ?, 'Local Project', ?, 'main', 1, ?, ?, ?)
      `).run(localProjId, adminUserId, localSourceRepoDir, localSourceRepoDir, additionalTargetDir, Date.now());

      // Create an internal bare projection in reposDir
      const internalProjectionDir = gitManager.getRepoDir(localProjId);
      await fs.mkdir(internalProjectionDir, { recursive: true });

      // Verify local source files exist BEFORE deletion
      const sourceFileBefore = await fs.stat(path.join(localSourceRepoDir, 'README.md')).then(() => true).catch(() => false);
      expect(sourceFileBefore).toBe(true);

      // Delete local project via API
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${localProjId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);
      const json = deleteRes.json();
      expect(json.isLocalRepo).toBe(true);
      expect(json.message).toMatch(/Local files on disk were preserved/);

      // CRITICAL SAFETY ASSERTION: Local files on disk MUST STILL EXIST!
      const sourceFileAfter = await fs.stat(path.join(localSourceRepoDir, 'README.md')).then(() => true).catch(() => false);
      const localGitAfter = await fs.stat(path.join(localSourceRepoDir, '.git')).then(() => true).catch(() => false);
      const additionalCopyAfter = await fs.stat(path.join(additionalTargetDir, 'README.md')).then(() => true).catch(() => false);

      expect(sourceFileAfter).toBe(true);
      expect(localGitAfter).toBe(true);
      expect(additionalCopyAfter).toBe(true);

      // Internal projection in reposDir is cleaned
      const projectionStillExists = await fs.stat(internalProjectionDir).then(() => true).catch(() => false);
      expect(projectionStillExists).toBe(false);

      // DB record is deleted
      const dbRow = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(localProjId);
      expect(dbRow).toBeUndefined();
    });
  });

  // 5. REST API Endpoints: Inspect, Publish Local, Copy Now
  describe('SysAdmin REST APIs: Local Repo Operations', () => {
    let publishedProjectId: string;

    it('POST /api/admin/local-repos/inspect validates local repository', async () => {
      const { app } = appInstance;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/local-repos/inspect',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { path: localSourceRepoDir },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.isValid).toBe(true);
      expect(json.suggestedName).toBe('my-local-source-repo');
      expect(json.currentBranch).toBe('main');
      expect(json.headCommitSha).toHaveLength(40);
    });

    it('POST /api/admin/local-repos/publish publishes local repository and copies to additional location', async () => {
      const { app, db } = appInstance;
      const secondaryCopyDir = path.join(testBaseDir, 'api-secondary-copy');

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/local-repos/publish',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Published Local Via API',
          localPath: localSourceRepoDir,
          branch: 'main',
          additionalCopyPath: secondaryCopyDir,
          copyMode: 'WORKING_TREE',
          autoCopyOnSync: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.ok).toBe(true);
      expect(json.projectId).toBeDefined();
      publishedProjectId = json.projectId;
      expect(json.copyResult?.ok).toBe(true);
      expect(json.copyResult?.targetPath).toBe(secondaryCopyDir);

      // Verify files in secondaryCopyDir
      const fileExists = await fs.stat(path.join(secondaryCopyDir, 'README.md')).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify project record in DB has is_local_repo = 1
      const p = db.prepare(`SELECT is_local_repo, local_source_path, additional_copy_path FROM projects WHERE id = ?`).get(json.projectId) as any;
      expect(p.is_local_repo).toBe(1);
      expect(p.local_source_path).toBe(localSourceRepoDir);
      expect(p.additional_copy_path).toBe(secondaryCopyDir);
    });

    it('POST /api/projects/:projectId/copy-to-location triggers on-demand copy', async () => {
      const { app } = appInstance;
      const onDemandDir = path.join(testBaseDir, 'on-demand-copy-dest');

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${publishedProjectId}/copy-to-location`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          targetPath: onDemandDir,
          copyMode: 'WORKING_TREE',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.ok).toBe(true);
      expect(json.filesCount).toBeGreaterThan(0);

      const fileExists = await fs.stat(path.join(onDemandDir, 'README.md')).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
