import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import { BareGitManager } from '../src/backend/services/gitManager.js';
import { GeminiRagService, chunkFileContent } from '../src/backend/services/geminiRagService.js';
import { ProjectSyncAndRagOrchestrator } from '../src/backend/workers/syncWorker.js';
import { createDatabase } from '../src/backend/db/schema.js';
import { encryptSecret } from '../src/backend/utils/crypto.js';
import { GroupAclRule } from '../src/shared/types.js';

const execFileAsync = promisify(execFile);

describe('Bare Git Manager & Delta Sync Integration (gitManager.ts & syncWorker.ts)', () => {
  let tempBaseDir: string;
  let sourceRepoDir: string;
  let reposDir: string;
  let dbPath: string;
  let db: Database.Database;
  let gitManager: BareGitManager;
  let geminiService: GeminiRagService;
  let orchestrator: ProjectSyncAndRagOrchestrator;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-test-'));
    sourceRepoDir = path.join(tempBaseDir, 'source-repo');
    reposDir = path.join(tempBaseDir, 'repos');
    dbPath = path.join(tempBaseDir, 'test.db');

    await fs.mkdir(sourceRepoDir, { recursive: true });
    await fs.mkdir(reposDir, { recursive: true });

    // Initialize source Git repository
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });

    // Populate initial files
    await fs.mkdir(path.join(sourceRepoDir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(sourceRepoDir, 'internal'), { recursive: true });

    await fs.writeFile(
      path.join(sourceRepoDir, 'docs/api.md'),
      '# API Overview\nThis document describes how user authentication tokens are issued and validated.'
    );
    await fs.writeFile(
      path.join(sourceRepoDir, 'internal/secret.md'),
      '# Super Secret Internal Passwords\nThis document has internal authentication secrets that must never leak.'
    );

    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: sourceRepoDir });

    db = createDatabase(dbPath);
    gitManager = new BareGitManager(reposDir);
    geminiService = new GeminiRagService();

    // Mock Gemini embedding to return deterministic 768-dim float vectors for testing
    vi.spyOn(geminiService, 'embedChunks').mockImplementation(async (_key, texts) => {
      return texts.map((text) => {
        const vec = new Float32Array(768);
        // Simple deterministic pseudo-hash based on text content
        for (let i = 0; i < text.length && i < 768; i++) {
          vec[i] = (text.charCodeAt(i) % 100) / 100;
        }
        return vec;
      });
    });

    orchestrator = new ProjectSyncAndRagOrchestrator(db, gitManager, geminiService);
  });

  afterEach(async () => {
    try {
      db.close();
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('performs bare clone and reads commit blobs directly without working tree', async () => {
    const projectId = 'proj-123';
    const sha = await gitManager.syncBareRepo(projectId, sourceRepoDir, 'main');

    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const files = await gitManager.listRepoFiles(projectId, sha);
    const filePaths = files.map((f) => f.filePath);

    expect(filePaths).toContain('docs/api.md');
    expect(filePaths).toContain('internal/secret.md');

    // Read blob directly from Git packfile
    const content = await gitManager.readFileBlob(projectId, sha, 'docs/api.md');
    expect(content).toContain('This document describes how user authentication tokens');
  });

  it('computes commit delta between commit snapshots', async () => {
    const projectId = 'proj-delta';
    const oldSha = await gitManager.syncBareRepo(projectId, sourceRepoDir, 'main');

    // Add a new file and modify an existing one in source repo
    await fs.writeFile(path.join(sourceRepoDir, 'docs/api.md'), '# API Overview v2\nUpdated content');
    await fs.writeFile(path.join(sourceRepoDir, 'docs/new-spec.md'), '# New Spec');
    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Second commit'], { cwd: sourceRepoDir });

    const newSha = await gitManager.syncBareRepo(projectId, sourceRepoDir, 'main');
    expect(newSha).not.toBe(oldSha);

    const deltas = await gitManager.getCommitDelta(projectId, oldSha, newSha);
    expect(deltas).toEqual(
      expect.arrayContaining([
        { status: 'M', filePath: 'docs/api.md' },
        { status: 'A', filePath: 'docs/new-spec.md' },
      ])
    );
  });

  it('guarantees ZERO-LEAKAGE ACL vector search: restricted files are NEVER returned', async () => {
    const projectId = 'proj-acl-rag';
    const ownerId = 'publisher-1';

    // Seed publisher user
    db.prepare(`
      INSERT INTO users (id, email, global_role, status, max_disk_quota_bytes, created_at)
      VALUES (?, 'pub@test.com', 'PUBLISHER', 'ACTIVE', 524288000, ?)
    `).run(ownerId, Date.now());

    // Seed project with encrypted dummy Gemini key
    db.prepare(`
      INSERT INTO projects (
        id, owner_id, name, repo_url, branch,
        encrypted_gemini_key, created_at
      ) VALUES (?, ?, 'Secured Project', ?, 'main', ?, ?)
    `).run(projectId, ownerId, sourceRepoDir, encryptSecret('AIzaSyDummyKey'), Date.now());

    // Run delta sync & vector indexing
    const syncRes = await orchestrator.syncProject(projectId, 'MANUAL');
    expect(syncRes.indexedFiles).toBe(2); // docs/api.md and internal/secret.md

    // Verify chunks and sqlite-vec vectors were created in db
    const chunkCount = (db.prepare('SELECT COUNT(*) as c FROM doc_chunks WHERE project_id = ?').get(projectId) as any).c;
    expect(chunkCount).toBeGreaterThanOrEqual(2);

    // Case 1: External Viewer Group (allowed: docs/**, excluded: internal/**)
    const externalViewerRule: GroupAclRule = {
      groupId: 'external-group',
      allowedFolders: ['docs'],
      allowedExtensions: ['.md'],
      excludeGlobs: ['**/internal/**'],
      maxFileSizeBytes: 1048576,
    };

    const externalResults = await orchestrator.retrieveAuthorizedContext(
      projectId,
      [externalViewerRule],
      'authentication tokens',
      5
    );

    // MUST return docs/api.md
    expect(externalResults.length).toBeGreaterThan(0);
    for (const chunk of externalResults) {
      expect(chunk.filePath).toBe('docs/api.md');
      expect(chunk.filePath).not.toContain('internal');
    }

    // Case 2: Restricted Viewer Group with no access to any files
    const zeroAccessRule: GroupAclRule = {
      groupId: 'zero-group',
      allowedFolders: ['non-existent-folder'],
      allowedExtensions: ['.md'],
      excludeGlobs: [],
      maxFileSizeBytes: 1048576,
    };

    const zeroResults = await orchestrator.retrieveAuthorizedContext(
      projectId,
      [zeroAccessRule],
      'authentication tokens',
      5
    );

    // MUST return empty array immediately (Zero-Leakage guarantee)
    expect(zeroResults).toEqual([]);
  });

  it('correctly handles non-ASCII / Hebrew UTF-8 file paths without octal escaping', async () => {
    const hebrewDir = path.join(sourceRepoDir, 'תוצרים');
    await fs.mkdir(hebrewDir, { recursive: true });
    await fs.writeFile(path.join(hebrewDir, 'התוכנית.md'), '# תוכנית עבודה\nפירוט המשימות והשלבים.');
    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Add Hebrew files'], { cwd: sourceRepoDir });

    const projectId = 'proj-hebrew';
    const sha = await gitManager.syncBareRepo(projectId, sourceRepoDir, 'main');
    const files = await gitManager.listRepoFiles(projectId, sha);
    const filePaths = files.map((f) => f.filePath);

    expect(filePaths).toContain('תוצרים/התוכנית.md');
    // Ensure no quotes or octal escapes like \327
    for (const p of filePaths) {
      expect(p.startsWith('"')).toBe(false);
      expect(p).not.toMatch(/\\\d{3}/);
    }

    const content = await gitManager.readFileBlob(projectId, sha, 'תוצרים/התוכנית.md');
    expect(content).toContain('תוכנית עבודה');
  });
});
