import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../src/backend/app.js';
import { PortalMailer } from '../src/backend/auth/mailer.js';

const execFileAsync = promisify(execFile);

describe('End-to-End Fastify API Route Lifecycle (api-routes.test.ts)', () => {
  let tempBaseDir: string;
  let sourceRepoDir: string;
  let reposDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let mailer: PortalMailer;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-api-test-'));
    sourceRepoDir = path.join(tempBaseDir, 'source-repo');
    reposDir = path.join(tempBaseDir, 'repos');
    dbPath = path.join(tempBaseDir, 'test.db');

    await fs.mkdir(sourceRepoDir, { recursive: true });
    await fs.mkdir(reposDir, { recursive: true });

    // Initialize Git repository with test files
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });

    await fs.mkdir(path.join(sourceRepoDir, 'docs/public'), { recursive: true });
    await fs.mkdir(path.join(sourceRepoDir, 'docs/internal'), { recursive: true });

    await fs.writeFile(path.join(sourceRepoDir, 'docs/public/guide.md'), '# Public Guide\nHello World');
    await fs.writeFile(path.join(sourceRepoDir, 'docs/internal/secret.md'), '# Classified Roadmap');

    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: sourceRepoDir });

    const bundle = buildApp({
      dbPath,
      reposDir,
      bootstrapSysAdminEmail: 'root@gitlens-portal.local',
    });

    app = bundle.app;
    // Access internal mailer for OTP inspection during tests
    mailer = (bundle.authService as any).mailer;
  });

  afterEach(async () => {
    await app.close();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('verifies health check endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ok');
  });

  it('executes full multi-tenant flow: Admin -> Publisher -> Viewer with ACL gate', async () => {
    // 1. SysAdmin requests login code
    const adminEmail = 'root@gitlens-portal.local';
    const reqCodeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { email: adminEmail },
    });
    expect(reqCodeRes.statusCode).toBe(200);
    const reqCodeJson = JSON.parse(reqCodeRes.payload);
    expect(reqCodeJson.devOtp).toBeUndefined();
    expect(reqCodeJson.devMagicToken).toBeUndefined();

    const adminMail = mailer.getLastSentEmail(adminEmail);
    expect(adminMail).toBeDefined();

    // 2. SysAdmin verifies OTP and signs in
    const adminAuthRes = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: adminEmail, otpCode: adminMail!.otpCode },
    });

    expect(adminAuthRes.statusCode).toBe(200);
    const adminAuth = JSON.parse(adminAuthRes.payload);
    const adminToken = adminAuth.token;
    expect(adminAuth.user.globalRole).toBe('SYSADMIN');

    // 3. SysAdmin invites Publisher
    const pubEmail = 'publisher1@company.com';
    const invitePubRes = await app.inject({
      method: 'POST',
      url: '/api/admin/invite-publisher',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { email: pubEmail, maxRepos: 3 },
    });

    expect(invitePubRes.statusCode).toBe(200);

    // 4. Publisher receives OTP and verifies
    const pubMail = mailer.getLastSentEmail(pubEmail);
    const pubAuthRes = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: pubEmail, otpCode: pubMail!.otpCode },
    });

    expect(pubAuthRes.statusCode).toBe(200);
    const pubAuth = JSON.parse(pubAuthRes.payload);
    const pubToken = pubAuth.token;
    expect(pubAuth.user.globalRole).toBe('PUBLISHER');

    // 5. Publisher creates a Project
    const createProjRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        name: 'Client Documentation Portal',
        repoUrl: sourceRepoDir,
        branch: 'main',
      },
    });

    expect(createProjRes.statusCode).toBe(200);
    const { projectId } = JSON.parse(createProjRes.payload);

    // 6. Publisher triggers initial delta sync
    const syncRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sync`,
      headers: { Authorization: `Bearer ${pubToken}` },
    });

    expect(syncRes.statusCode).toBe(200);

    // 7. Publisher creates a restricted Viewer Group (allowing only docs/public/**)
    const createGroupRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/groups`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        name: 'External Clients Group',
        allowedFolders: ['docs/public'],
        allowedExtensions: ['.md'],
        excludeGlobs: ['**/internal/**'],
      },
    });

    expect(createGroupRes.statusCode).toBe(200);
    const { groupId } = JSON.parse(createGroupRes.payload);

    // 8. Publisher invites external Viewer to this group
    const viewerEmail = 'viewer@external-client.com';
    const inviteViewerRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invite-viewer`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: { email: viewerEmail, groupIds: [groupId] },
    });

    expect(inviteViewerRes.statusCode).toBe(200);

    // 9. Viewer receives OTP and signs in
    const viewerMail = mailer.getLastSentEmail(viewerEmail);
    const viewerAuthRes = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: viewerEmail, otpCode: viewerMail!.otpCode },
    });

    expect(viewerAuthRes.statusCode).toBe(200);
    const viewerAuth = JSON.parse(viewerAuthRes.payload);
    const viewerToken = viewerAuth.token;
    expect(viewerAuth.user.globalRole).toBe('VIEWER');

    // 10. Viewer gets filtered file tree
    const treeRes = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/tree`,
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(treeRes.statusCode).toBe(200);
    const treeJson = JSON.parse(treeRes.payload);
    expect(treeJson.authorizedPaths).toContain('docs/public/guide.md');
    // Secret file must NOT be in viewer's authorizedPaths
    expect(treeJson.authorizedPaths).not.toContain('docs/internal/secret.md');

    // 11. Viewer requests authorized file: docs/public/guide.md -> 200 OK
    const allowedBlobRes = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/blob?path=docs/public/guide.md`,
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(allowedBlobRes.statusCode).toBe(200);
    const blobJson = JSON.parse(allowedBlobRes.payload);
    expect(blobJson.content).toContain('Public Guide');

    // 12. Viewer attempts to request restricted file: docs/internal/secret.md -> 403 Forbidden!
    const restrictedBlobRes = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/blob?path=docs/internal/secret.md`,
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(restrictedBlobRes.statusCode).toBe(403);
    const restrictedJson = JSON.parse(restrictedBlobRes.payload);
    expect(restrictedJson.restricted).toBe(true);
    expect(restrictedJson.error).toMatch(/Access restricted/i);
  });
});
