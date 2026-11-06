import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../src/backend/app.js';
import { PortalMailer } from '../src/backend/auth/mailer.js';
import { validateGitBranchName, validateRepositorySource } from '../src/backend/services/gitManager.js';
import { resolveRepoLink } from '../src/frontend/utils/resolveRepoLink.js';
import { useViewerStore } from '../src/frontend/store/useViewerStore.js';

const execFileAsync = promisify(execFile);

describe('Security Hardening & Vulnerability Remediation Suite (security-hardening.test.ts)', () => {
  let tempBaseDir: string;
  let sourceRepoDir: string;
  let reposDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let db: any;
  let mailer: PortalMailer;
  let adminToken: string;
  let pubToken: string;
  let projectId: string;
  let groupId: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-sec-test-'));
    sourceRepoDir = path.join(tempBaseDir, 'source-repo');
    reposDir = path.join(tempBaseDir, 'repos');
    dbPath = path.join(tempBaseDir, 'test.db');

    await fs.mkdir(sourceRepoDir, { recursive: true });
    await fs.mkdir(reposDir, { recursive: true });

    await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Sec Tester'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'sec@example.com'], { cwd: sourceRepoDir });

    await fs.writeFile(path.join(sourceRepoDir, 'index.html'), '<html><body>Hello</body></html>');
    await fs.writeFile(path.join(sourceRepoDir, 'README.md'), '# Security Test Repo');
    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: sourceRepoDir });

    const bundle = buildApp({
      dbPath,
      reposDir,
      portalBaseUrl: 'http://localhost:3000',
      bootstrapSysAdminEmail: 'admin@gitlens-portal.local',
    });

    app = bundle.app;
    db = bundle.db;
    mailer = (bundle.authService as any).mailer;

    // 1. Authenticate SysAdmin
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { email: 'admin@gitlens-portal.local' },
    });
    const adminMail = mailer.getLastSentEmail('admin@gitlens-portal.local')!;
    const adminVerify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'admin@gitlens-portal.local', otpCode: adminMail.otpCode },
    });
    adminToken = JSON.parse(adminVerify.payload).token;

    // 2. Invite & Authenticate Publisher
    await app.inject({
      method: 'POST',
      url: '/api/admin/invite-publisher',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { email: 'pub@company.com' },
    });
    const pubMail = mailer.getLastSentEmail('pub@company.com')!;
    const pubVerify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'pub@company.com', otpCode: pubMail.otpCode },
    });
    pubToken = JSON.parse(pubVerify.payload).token;

    // 3. Create project & group as Publisher
    const projRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        name: 'SecProject',
        repoUrl: sourceRepoDir,
        branch: 'main',
      },
    });
    projectId = JSON.parse(projRes.payload).projectId;

    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sync`,
      headers: { Authorization: `Bearer ${pubToken}` },
    });

    const groupsRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/groups`,
      headers: { Authorization: `Bearer ${pubToken}` },
    });
    groupId = JSON.parse(groupsRes.payload).groups[0].id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  it('[C-1] prevents Publisher from hijacking SysAdmin or active Publisher account via viewer invitation', async () => {
    // Publisher attempts to invite SysAdmin as a viewer to steal their login token
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invite-viewer`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        email: 'admin@gitlens-portal.local',
        groupIds: [groupId],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // MUST NOT expose magicLinkUrl or otpCode for an existing SYSADMIN/active user
    expect(body.magicLinkUrl).toBe('');
    expect(body.otpCode).toBe('');
  });

  it('[C-1] Zero-Trust: omits magicLinkUrl and otpCode from invite response when Brevo email delivery succeeds', async () => {
    vi.spyOn(mailer, 'sendAuthEmail').mockResolvedValueOnce({ sent: true });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invite-viewer`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        email: 'brandnew-viewer@external.com',
        groupIds: [groupId],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.emailSent).toBe(true);
    expect(body.magicLinkUrl).toBe('');
    expect(body.otpCode).toBe('');
  });

  it('[H-1] prevents Host / Origin header poisoning from altering magic link base URLs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invite-viewer`,
      headers: {
        Authorization: `Bearer ${pubToken}`,
        Origin: 'https://evil-phishing-domain.attacker.com',
        Host: 'evil-host.attacker.com',
      },
      payload: {
        email: 'victim@client.org',
        groupIds: [groupId],
      },
    });

    expect(res.statusCode).toBe(200);
    const mail = mailer.getLastSentEmail('victim@client.org')!;
    expect(mail).toBeDefined();
    expect(mail.magicLinkUrl).toMatch(/^http:\/\/localhost:3000\/auth\/verify\?token=/);
    expect(mail.magicLinkUrl).not.toContain('attacker.com');
  });

  it('[C-2] restricts additionalCopyPath and copy-to-location strictly to SYSADMIN', async () => {
    const targetCopyDir = path.join(tempBaseDir, 'unauth-copy');

    // Publisher attempts PATCH with additionalCopyPath -> 403 Forbidden
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        additionalCopyPath: targetCopyDir,
      },
    });
    expect(patchRes.statusCode).toBe(403);

    // Publisher attempts POST /copy-to-location -> 403 Forbidden
    const copyRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/copy-to-location`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        targetPath: targetCopyDir,
      },
    });
    expect(copyRes.statusCode).toBe(403);

    // SysAdmin attempting to copy to restricted system directory (/etc) -> 400 Bad Request
    const sysEtcRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/copy-to-location`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        targetPath: '/etc/evil-export',
      },
    });
    expect(sysEtcRes.statusCode).toBe(400);
  });

  it('[C-3] blocks SSRF, local paths for Publishers, file://, ext::, and Git option injection', async () => {
    const maliciousPayloads = [
      { name: 'LocalEtc', repoUrl: '/etc/passwd', branch: 'main' },
      { name: 'LocalHome', repoUrl: '/home/agydev/some-repo', branch: 'main' },
      { name: 'FileScheme', repoUrl: 'file:///tmp/repo.git', branch: 'main' },
      { name: 'ExtRemoteHelper', repoUrl: 'ext::sh -c touch% /tmp/pwned', branch: 'main' },
      { name: 'LoopbackSSRF', repoUrl: 'https://127.0.0.1:8080/repo.git', branch: 'main' },
      { name: 'MetadataSSRF', repoUrl: 'https://169.254.169.254/latest/meta-data', branch: 'main' },
      { name: 'OptionInjectUrl', repoUrl: '--upload-pack=touch /tmp/pwn', branch: 'main' },
      { name: 'OptionInjectBranch', repoUrl: 'https://github.com/org/repo.git', branch: '--upload-pack=evil' },
      { name: 'TraversalBranch', repoUrl: 'https://github.com/org/repo.git', branch: 'main..evil' },
    ];

    for (const payload of maliciousPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { Authorization: `Bearer ${pubToken}` },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }

    expect(() => validateGitBranchName('--option-flag')).toThrow();
    expect(() => validateRepositorySource('http://github.com/org/repo.git')).toThrow(/HTTPS/);
  });

  it('[H-2] enforces sandboxed Content-Security-Policy and X-Content-Type-Options on /raw/* endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/index.html`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeDefined();
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('[H-3] encrypts Brevo API key at rest in SQLite and masks it in /api/admin/settings', async () => {
    const rawBrevoKey = 'xkeysib-super-secret-production-key-99999';
    const saveRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/email',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        apiKey: rawBrevoKey,
        senderEmail: 'noreply@verified.org',
        senderName: 'Sec Portal',
      },
    });
    expect(saveRes.statusCode).toBe(200);

    // 1. Raw SQLite row must store encrypted ciphertext (`enc:...`), not plaintext
    const row = db
      .prepare(`SELECT value_json FROM system_settings WHERE key = 'brevo_config'`)
      .get() as { value_json: string };
    expect(row.value_json).not.toContain(rawBrevoKey);
    const parsedDb = JSON.parse(row.value_json);
    expect(parsedDb.apiKey).toMatch(/^enc:/);

    // 2. Mailer transparently decrypts the stored key
    const resolvedConfig = mailer.getBrevoConfig();
    expect(resolvedConfig?.apiKey).toBe(rawBrevoKey);

    // 3. GET /api/admin/settings masks the key
    const settingsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(settingsRes.statusCode).toBe(200);
    const settingsPayload = JSON.parse(settingsRes.payload);
    expect(settingsPayload.settings.brevo_config.apiKey).toBe('••••••••');
    expect(settingsRes.payload).not.toContain(rawBrevoKey);
  });

  it('[H-4] rejects untrusted cross-origin CORS requests while allowing configured origins', async () => {
    const untrustedRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { Origin: 'https://malicious-site.example.com' },
    });
    expect(untrustedRes.headers['access-control-allow-origin']).toBeUndefined();

    const trustedRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(trustedRes.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('[H-5] rejects unauthenticated webhooks when secret is missing or signature is invalid, and accepts valid HMAC', async () => {
    // 1. Project has no webhook secret configured -> 401
    const noSecretRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/github/${projectId}`,
      payload: { ref: 'refs/heads/main' },
    });
    expect(noSecretRes.statusCode).toBe(401);

    // 2. Configure webhook secret on project
    const webhookSecret = 'my-webhook-hmac-secret-123';
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: { webhookSecret },
    });

    const rawPayload = JSON.stringify({ ref: 'refs/heads/main', after: '123456' });

    // 3. Invalid signature -> 401
    const badSigRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/github/${projectId}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=' + '0'.repeat(64),
      },
      payload: rawPayload,
    });
    expect(badSigRes.statusCode).toBe(401);

    // 4. Valid HMAC signature -> 200
    const validSig =
      'sha256=' + createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');
    const goodSigRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/github/${projectId}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': validSig,
      },
      payload: rawPayload,
    });
    expect(goodSigRes.statusCode).toBe(200);
  });

  it('[M-1 & M-4] blocks unsafe javascript:/data: links and resets viewer store state on logout', () => {
    expect(resolveRepoLink('README.md', 'javascript:alert(1)').rawHref).toBe('');
    expect(resolveRepoLink('README.md', 'data:text/html,<script>alert(1)</script>').rawHref).toBe('');
    expect(resolveRepoLink('README.md', 'vbscript:msgbox(1)').rawHref).toBe('');

    useViewerStore.setState({
      projectId: 'proj-secret',
      activeFilePath: 'docs/confidential.md',
      activeHash: 'L10',
      previewGroupId: 'grp-1',
      authorizedPaths: ['docs/confidential.md'],
      isAiDrawerOpen: true,
    });

    useViewerStore.getState().resetSessionState();
    const afterLogout = useViewerStore.getState();
    expect(afterLogout.projectId).toBe('');
    expect(afterLogout.activeFilePath).toBeNull();
    expect(afterLogout.authorizedPaths).toEqual([]);
    expect(afterLogout.previewGroupId).toBeNull();
    expect(afterLogout.isAiDrawerOpen).toBe(false);
  });

  it('[M-3] rejects cross-project Viewer Group IDs and prevents SysAdmin self-suspension', async () => {
    // 1. Invite viewer with a groupId that does not belong to projectId -> 400
    const badGroupRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invite-viewer`,
      headers: { Authorization: `Bearer ${pubToken}` },
      payload: {
        email: 'viewer2@client.com',
        groupIds: ['non-existent-other-project-group-id'],
      },
    });
    expect(badGroupRes.statusCode).toBe(400);
    expect(JSON.parse(badGroupRes.payload).error).toMatch(/do not belong to this project/i);

    // 2. SysAdmin attempting to suspend their own account -> 400
    const adminRow = db
      .prepare(`SELECT id FROM users WHERE email = 'admin@gitlens-portal.local'`)
      .get() as { id: string };

    const selfSuspendRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/publishers/${adminRow.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { status: 'SUSPENDED' },
    });
    expect(selfSuspendRes.statusCode).toBe(400);
    expect(JSON.parse(selfSuspendRes.payload).error).toMatch(/cannot suspend their own account/i);
  });
});
