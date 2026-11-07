import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../src/backend/app.js';
import { BareGitManager } from '../src/backend/services/gitManager.js';

const execFileAsync = promisify(execFile);

// 1x1 transparent PNG buffer
const SAMPLE_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Raw File Serving & Binary Image Handling (viewer-image-and-raw-serving.test.ts)', () => {
  let tempBaseDir: string;
  let sourceRepoDir: string;
  let reposDir: string;
  let dbPath: string;
  let db: any;
  let app: FastifyInstance;
  let gitManager: BareGitManager;
  let adminToken: string;
  let projectId: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-image-test-'));
    sourceRepoDir = path.join(tempBaseDir, 'source-repo');
    reposDir = path.join(tempBaseDir, 'repos');
    dbPath = path.join(tempBaseDir, 'test.db');

    await fs.mkdir(sourceRepoDir, { recursive: true });
    await fs.mkdir(reposDir, { recursive: true });

    // Initialize Git repository with test files including index.html, markdown, and binary PNG
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });

    await fs.mkdir(path.join(sourceRepoDir, 'docs/pmo'), { recursive: true });
    await fs.mkdir(path.join(sourceRepoDir, 'secret'), { recursive: true });

    await fs.writeFile(path.join(sourceRepoDir, 'index.html'), '<!DOCTYPE html><html><head><title>Nafshi Docs</title></head><body><h1>Welcome</h1></body></html>');
    await fs.writeFile(path.join(sourceRepoDir, 'docs/pmo/projectplan.md'), '# Project Plan\n![Phases](project_phases.png)');
    await fs.writeFile(path.join(sourceRepoDir, 'docs/pmo/project_phases.png'), SAMPLE_PNG_BUFFER);
    await fs.writeFile(path.join(sourceRepoDir, 'secret/confidential.png'), SAMPLE_PNG_BUFFER);

    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit with index.html and PNG'], { cwd: sourceRepoDir });

    const bundle = buildApp({
      dbPath,
      reposDir,
      bootstrapSysAdminEmail: 'root@gitlens-portal.local',
    });

    app = bundle.app;
    db = bundle.db;
    gitManager = bundle.gitManager;

    // Login SysAdmin to get auth token
    const mailer = (bundle.authService as any).mailer;
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { email: 'root@gitlens-portal.local' },
    });

    const sentMail = mailer.getLastSentEmail('root@gitlens-portal.local');
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'root@gitlens-portal.local', otpCode: sentMail!.otpCode },
    });
    adminToken = JSON.parse(authRes.payload).token;

    // Create a project pointing to sourceRepoDir
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'NafshiMng',
        repoUrl: sourceRepoDir,
        branch: 'main',
        isLocalRepo: true,
        localSourcePath: sourceRepoDir,
      },
    });
    projectId = JSON.parse(createRes.payload).projectId;

    // Trigger initial sync so bare repository has last_synced_sha
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sync`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });

  afterEach(async () => {
    await app.close();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('BareGitManager reads binary blobs into Buffer preserving exact magic bytes', async () => {
    const project = db.prepare('SELECT last_synced_sha FROM projects WHERE id = ?').get(projectId) as any;
    expect(project?.last_synced_sha).toBeDefined();

    const buf = await gitManager.readFileBlobBuffer(projectId, project.last_synced_sha, 'docs/pmo/project_phases.png');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(SAMPLE_PNG_BUFFER.length);
    // PNG signature: 0x89 'P' 'N' 'G' 0x0D 0x0A 0x1A 0x0A
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('GET /api/viewer/:projectId/raw redirects to trailing slash /raw/ for proper relative path resolution', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/api/viewer/${projectId}/raw/`);
  });

  it('GET /api/viewer/:projectId/raw/ serves index.html by default without error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Nafshi Docs');
  });

  it('GET /api/viewer/:projectId/raw/index.html serves index.html with HTML Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/index.html`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<!DOCTYPE html>');
  });

  it('GET /api/viewer/:projectId/raw/index.html/docs/pmo/projectplan.md normalizes index.html prefix from Docsify', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/index.html/docs/pmo/projectplan.md`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.payload).toContain('# Project Plan');
  });

  it('GET /api/viewer/:projectId/raw/srcdoc/docs/pmo/projectplan.md normalizes srcdoc/ prefix from Docsify in iframe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/srcdoc/docs/pmo/projectplan.md`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.payload).toContain('# Project Plan');
  });

  it('GET /api/viewer/:projectId/raw/srcdoc/ serves index.html by default without error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/srcdoc/`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Nafshi Docs');
  });

  it('GET /api/viewer/:projectId/raw/docs/pmo/project_phases.png serves binary PNG with image/png Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/docs/pmo/project_phases.png`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.length).toBe(SAMPLE_PNG_BUFFER.length);
    expect(res.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('GET /api/viewer/:projectId/blob returns base64 data URI for binary images instead of corrupted UTF-8 string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/blob?path=docs/pmo/project_phases.png`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.path).toBe('docs/pmo/project_phases.png');
    expect(json.isBinary).toBe(true);
    expect(json.content).toMatch(/^data:image\/png;base64,/);
    expect(json.sizeBytes).toBe(SAMPLE_PNG_BUFFER.length);

    // Verify data URI decodes back to original PNG bytes
    const base64Data = json.content.replace(/^data:image\/png;base64,/, '');
    const decoded = Buffer.from(base64Data, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('SandboxedHtmlRenderer iframe includes allow-same-origin and Docsify basePath URL rewriting for embedded apps', async () => {
    const rendererSource = await fs.readFile(
      path.join(process.cwd(), 'src/frontend/components/renderers/SandboxedHtmlRenderer.tsx'),
      'utf8'
    );
    expect(rendererSource).toContain('allow-same-origin');
    expect(rendererSource).toContain('sandbox="allow-scripts allow-same-origin');
    expect(rendererSource).toContain('rewriteViewerUrl');
    expect(rendererSource).toContain('$docsify');
    expect(rendererSource).toContain('basePath');
    expect(rendererSource).toContain('XMLHttpRequest.prototype.open');
  });
});
