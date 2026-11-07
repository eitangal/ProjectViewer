import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../src/backend/app.js';
import { PortalMailer } from '../src/backend/auth/mailer.js';
import { getUserInitials } from '../src/frontend/components/common/ThemeAndUserControls.js';
import { resolveDefaultProjectFile } from '../src/frontend/utils/resolveDefaultProjectFile.js';

const execFileAsync = promisify(execFile);

describe('Unified Navigation, User Initials & Mixed-Role Project Access', () => {
  describe('User Initials Extractor (getUserInitials)', () => {
    it('returns "U" for null or undefined users', () => {
      expect(getUserInitials(null)).toBe('U');
      expect(getUserInitials(undefined)).toBe('U');
      expect(getUserInitials({})).toBe('U');
    });

    it('extracts initials from full display name', () => {
      expect(getUserInitials({ name: 'Jane Doe' })).toBe('JD');
      expect(getUserInitials({ name: 'John Michael Doe' })).toBe('JD');
      expect(getUserInitials({ name: 'Alice' })).toBe('AL');
    });

    it('extracts initials from email username separated by punctuation', () => {
      expect(getUserInitials({ email: 'jane.doe@company.org' })).toBe('JD');
      expect(getUserInitials({ email: 'admin_root@portal.local' })).toBe('AR');
      expect(getUserInitials({ email: 'publisher-lead@agency.io' })).toBe('PL');
    });

    it('falls back to first two characters of single email handle', () => {
      expect(getUserInitials({ email: 'admin@portal.local' })).toBe('AD');
      expect(getUserInitials({ email: 'root@portal.local' })).toBe('RO');
      expect(getUserInitials({ email: 'x@portal.local' })).toBe('X');
    });
  });

  describe('Mixed-Role Multi-Project Backend API (GET /api/projects)', () => {
    let tempBaseDir: string;
    let sourceRepoA: string;
    let sourceRepoB: string;
    let reposDir: string;
    let dbPath: string;
    let app: FastifyInstance;
    let mailer: PortalMailer;

    beforeEach(async () => {
      tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-mixed-role-test-'));
      sourceRepoA = path.join(tempBaseDir, 'repo-a');
      sourceRepoB = path.join(tempBaseDir, 'repo-b');
      reposDir = path.join(tempBaseDir, 'repos');
      dbPath = path.join(tempBaseDir, 'test.db');

      await fs.mkdir(sourceRepoA, { recursive: true });
      await fs.mkdir(sourceRepoB, { recursive: true });
      await fs.mkdir(reposDir, { recursive: true });

      // Init repo A
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoA });
      await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: sourceRepoA });
      await execFileAsync('git', ['config', 'user.email', 'test@test.local'], { cwd: sourceRepoA });
      await fs.writeFile(path.join(sourceRepoA, 'README.md'), '# Repo A Docs');
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepoA });
      await execFileAsync('git', ['commit', '-m', 'Init A'], { cwd: sourceRepoA });

      // Init repo B
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoB });
      await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: sourceRepoB });
      await execFileAsync('git', ['config', 'user.email', 'test@test.local'], { cwd: sourceRepoB });
      await fs.writeFile(path.join(sourceRepoB, 'README.md'), '# Repo B Docs');
      await execFileAsync('git', ['add', '.'], { cwd: sourceRepoB });
      await execFileAsync('git', ['commit', '-m', 'Init B'], { cwd: sourceRepoB });

      const bundle = buildApp({
        dbPath,
        reposDir,
        bootstrapSysAdminEmail: 'admin@portal.local',
      });
      app = bundle.app;
      mailer = (bundle.authService as any).mailer;
    });

    afterEach(async () => {
      await app.close();
      try {
        await fs.rm(tempBaseDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    });

    async function loginAs(email: string): Promise<string> {
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        payload: { email },
      });
      const mail = mailer.getLastSentEmail(email);
      if (!mail) throw new Error(`No OTP found for ${email}`);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { email, otpCode: mail.otpCode },
      });
      expect(verifyRes.statusCode).toBe(200);
      const auth = JSON.parse(verifyRes.payload);
      return auth.token;
    }

    it('returns userRole: PUBLISHER for owned projects and userRole: VIEWER for group-shared projects', async () => {
      // 1. Admin logs in
      const adminToken = await loginAs('admin@portal.local');

      // Admin invites user1 as a Publisher
      const inviteRes = await app.inject({
        method: 'POST',
        url: '/api/admin/invite-publisher',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { email: 'user1@company.com', maxRepos: 5 },
      });
      expect(inviteRes.statusCode).toBe(200);

      // 2. user1 logs in
      const user1Token = await loginAs('user1@company.com');

      // user1 creates Project A (user1 is Owner/Publisher)
      const createResA = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { Authorization: `Bearer ${user1Token}` },
        payload: {
          name: 'User1 Project A',
          repoUrl: sourceRepoA,
          branch: 'main',
        },
      });
      expect(createResA.statusCode).toBe(200);
      const { projectId: projectAId } = JSON.parse(createResA.payload);

      // Admin creates Project B (Admin is Owner/Publisher)
      const createResB = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin Project B',
          repoUrl: sourceRepoB,
          branch: 'main',
        },
      });
      expect(createResB.statusCode).toBe(200);
      const { projectId: projectBId } = JSON.parse(createResB.payload);

      // Admin creates a group for Project B and invites user1 to it
      const groupRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectBId}/groups`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Auditors',
          allowedFolders: [''],
          allowedExtensions: ['.md'],
          excludeGlobs: [],
        },
      });
      expect(groupRes.statusCode).toBe(200);
      const { groupId } = JSON.parse(groupRes.payload);

      const addViewerRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectBId}/invite-viewer`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { email: 'user1@company.com', groupIds: [groupId] },
      });
      expect(addViewerRes.statusCode).toBe(200);

      // 3. user1 calls GET /api/projects
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listJson = JSON.parse(listRes.payload);
      const projects = listJson.projects;

      // Should contain both Project A and Project B
      expect(projects).toHaveLength(2);

      const listedProjectA = projects.find((p: any) => p.id === projectAId);
      const listedProjectB = projects.find((p: any) => p.id === projectBId);

      expect(listedProjectA).toBeDefined();
      expect(listedProjectA.userRole).toBe('PUBLISHER');

      expect(listedProjectB).toBeDefined();
      expect(listedProjectB.userRole).toBe('VIEWER');

      // 4. Verify user1 cannot delete Project B where they are only a VIEWER (returns 404 since they are not the owner)
      const deleteForbiddenRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectBId}`,
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      expect(deleteForbiddenRes.statusCode).toBe(404);

      // 5. Verify user1 CAN delete Project A where they are the PUBLISHER
      const deleteAllowedRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectAId}`,
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      expect(deleteAllowedRes.statusCode).toBe(200);
    });
  });

  describe('Viewer Default File Resolution (resolveDefaultProjectFile)', () => {
    it('defaults to root index.html when present', () => {
      const files = ['README.md', 'index.html', 'src/main.ts', 'docs/guide.md'];
      expect(resolveDefaultProjectFile(files)).toBe('index.html');
    });

    it('handles case-insensitive index.html / index.htm', () => {
      expect(resolveDefaultProjectFile(['README.md', 'INDEX.HTML', 'src/main.ts'])).toBe('INDEX.HTML');
      expect(resolveDefaultProjectFile(['README.md', 'index.htm', 'src/main.ts'])).toBe('index.htm');
      expect(resolveDefaultProjectFile(['README.md', '/index.html', 'src/main.ts'])).toBe('/index.html');
    });

    it('defaults to nested index.html if root index.html is absent', () => {
      const files = ['README.md', 'public/index.html', 'src/app.tsx'];
      expect(resolveDefaultProjectFile(files)).toBe('public/index.html');
    });

    it('prioritizes root index.html over nested index.html', () => {
      const files = ['dist/index.html', 'index.html', 'docs/index.html'];
      expect(resolveDefaultProjectFile(files)).toBe('index.html');
    });

    it('falls back to the first file in view if no index.html exists in project', () => {
      const files = ['docs/intro.md', 'README.md', 'src/index.ts'];
      expect(resolveDefaultProjectFile(files)).toBe('docs/intro.md');
    });

    it('returns null for empty or invalid file lists', () => {
      expect(resolveDefaultProjectFile([])).toBeNull();
      expect(resolveDefaultProjectFile(null as any)).toBeNull();
      expect(resolveDefaultProjectFile(undefined as any)).toBeNull();
    });
  });
});
