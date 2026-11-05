import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AuthService } from '../auth/authService.js';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';
import { PortalMailer, SmtpConfig, BrevoApiConfig, parseSender } from '../auth/mailer.js';
import { LocalRepoService } from '../services/localRepoService.js';
import { ProjectCopierService } from '../services/projectCopier.js';
import { ProjectSyncAndRagOrchestrator } from '../workers/syncWorker.js';
import { encryptSecret } from '../utils/crypto.js';

export async function registerAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
  authService: AuthService,
  middlewares: ReturnType<typeof buildAuthMiddlewares>,
  mailer?: PortalMailer,
  localRepoService?: LocalRepoService,
  projectCopier?: ProjectCopierService,
  syncOrchestrator?: ProjectSyncAndRagOrchestrator
) {
  const adminGuard = { preHandler: [middlewares.requireRole(['SYSADMIN'])] };

  // 1. SysAdmin invites a Publisher (SYS-01)
  app.post('/api/admin/invite-publisher', adminGuard, async (req, reply) => {
    const { email, maxRepos, maxDiskQuotaBytes, maxViewers } = req.body as {
      email: string;
      maxRepos?: number;
      maxDiskQuotaBytes?: number;
      maxViewers?: number;
    };
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    // Detect public URL from request origin/host
    const origin = req.headers.origin || (req.headers.host ? `${req.protocol}://${req.headers.host}` : null);
    if (origin) {
      authService.setPortalBaseUrl(origin);
    }

    const inviteResult = await authService.invitePublisher(req.user!.sub, email, {
      maxRepos,
      maxDiskQuotaBytes,
      maxViewers,
    });
    return reply.send({ ok: true, ...inviteResult });
  });

  // 2. SysAdmin lists publishers & quotas (SYS-02)
  app.get('/api/admin/publishers', adminGuard, async (req, reply) => {
    const publishers = db.prepare(`
      SELECT
        u.id,
        u.email,
        u.global_role as globalRole,
        u.status,
        u.max_repos as maxRepos,
        u.max_disk_quota_bytes as maxDiskQuotaBytes,
        u.max_viewers as maxViewers,
        u.created_at as createdAt,
        u.last_login_at as lastLoginAt,
        (SELECT COUNT(*) FROM projects WHERE owner_id = u.id) as projectCount,
        (SELECT COALESCE(SUM(disk_usage_bytes), 0) FROM projects WHERE owner_id = u.id) as totalDiskUsageBytes
      FROM users u
      WHERE u.global_role IN ('PUBLISHER', 'SYSADMIN')
      ORDER BY u.created_at DESC
    `).all();

    return reply.send({ publishers });
  });

  // 3. SysAdmin updates publisher status/quotas (SYS-02)
  app.patch('/api/admin/publishers/:userId', adminGuard, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const { status, maxRepos, maxDiskQuotaBytes, maxViewers } = req.body as {
      status?: 'ACTIVE' | 'SUSPENDED';
      maxRepos?: number;
      maxDiskQuotaBytes?: number;
      maxViewers?: number;
    };

    const user = db.prepare(`SELECT id, global_role FROM users WHERE id = ?`).get(userId) as any;
    if (!user) {
      return reply.code(404).send({ error: 'Publisher not found' });
    }

    db.prepare(`
      UPDATE users
      SET status = COALESCE(?, status),
          max_repos = COALESCE(?, max_repos),
          max_disk_quota_bytes = COALESCE(?, max_disk_quota_bytes),
          max_viewers = COALESCE(?, max_viewers)
      WHERE id = ?
    `).run(status ?? null, maxRepos ?? null, maxDiskQuotaBytes ?? null, maxViewers ?? null, userId);

    return reply.send({ ok: true });
  });

  // 4. SysAdmin system telemetry (SYS-03)
  app.get('/api/admin/telemetry', adminGuard, async (req, reply) => {
    const totalRepos = (db.prepare(`SELECT COUNT(*) as count FROM projects`).get() as any).count;
    const totalDiskUsage = (db.prepare(`SELECT COALESCE(SUM(disk_usage_bytes), 0) as total FROM projects`).get() as any).total;
    const totalVectors = (db.prepare(`SELECT COUNT(*) as count FROM doc_chunks`).get() as any).count;
    const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;

    const recentSyncLogs = db.prepare(`
      SELECT s.*, p.name as projectName
      FROM sync_logs s
      JOIN projects p ON p.id = s.project_id
      ORDER BY s.created_at DESC
      LIMIT 10
    `).all();

    const recentEmailLogs = db.prepare(`
      SELECT * FROM email_delivery_logs
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    return reply.send({
      stats: {
        totalRepos,
        totalDiskUsageBytes: totalDiskUsage,
        totalVectors,
        totalUsers,
      },
      recentSyncLogs,
      recentEmailLogs,
    });
  });

  // 5. Global Settings (SYS-04)
  app.get('/api/admin/settings', adminGuard, async (req, reply) => {
    const rows = db.prepare(`SELECT key, value_json FROM system_settings`).all() as any[];
    const settings: Record<string, any> = {};
    for (const r of rows) {
      settings[r.key] = JSON.parse(r.value_json);
    }
    return reply.send({ settings });
  });

  app.put('/api/admin/settings', adminGuard, async (req, reply) => {
    const { key, value } = req.body as { key: string; value: any };
    if (!key) return reply.code(400).send({ error: 'Key is required' });

    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), Date.now());

    return reply.send({ ok: true });
  });

  // 6. Brevo Transactional Email REST API Configuration & Verification
  const handleGetEmailConfig = async (req: any, reply: any) => {
    const config = mailer?.getBrevoConfig();
    return reply.send({
      isConfigured: !!config,
      provider: 'brevo_api',
      config: config
        ? {
            apiKey: config.apiKey ? '••••••••' : '',
            senderEmail: config.senderEmail,
            senderName: config.senderName,
            // Backwards-compatible fields
            host: 'api.brevo.com (HTTPS REST API)',
            port: 443,
            secure: true,
            user: config.senderName,
            pass: config.apiKey ? '••••••••' : '',
            from: `${config.senderName} <${config.senderEmail}>`,
          }
        : null,
    });
  };

  const handleSaveEmailConfig = async (req: any, reply: any) => {
    const body = req.body as any;
    const apiKey = body.apiKey || body.pass;
    const senderEmail = body.senderEmail || body.from;
    const senderName = body.senderName;

    if (!apiKey && apiKey !== '••••••••') {
      return reply.code(400).send({ error: 'Brevo API key is required' });
    }

    const current = mailer?.getBrevoConfig();
    const finalKey = apiKey === '••••••••' || apiKey === undefined ? (current?.apiKey || '') : apiKey;

    if (!finalKey) {
      return reply.code(400).send({ error: 'Brevo API key is required' });
    }

    const parsed = parseSender(senderEmail || '');
    const newConfig: BrevoApiConfig = {
      apiKey: finalKey.trim(),
      senderEmail: (senderEmail && !senderEmail.includes('<') ? senderEmail : parsed.email) || current?.senderEmail || 'noreply@gitlens-portal.local',
      senderName: (senderName || parsed.name || current?.senderName || 'GitLens Portal').trim(),
    };

    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES ('brevo_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(newConfig), Date.now());

    return reply.send({ ok: true, isConfigured: true, config: { ...newConfig, apiKey: '••••••••' } });
  };

  const handleTestEmailConfig = async (req: any, reply: any) => {
    const body = req.body as any;
    const testEmail = body.testEmail;
    if (!testEmail || !testEmail.trim()) {
      return reply.code(400).send({ error: 'Test recipient email is required' });
    }

    const current = mailer?.getBrevoConfig();
    const apiKey = body.apiKey || body.pass;
    const finalKey = apiKey === '••••••••' || !apiKey ? (current?.apiKey || '') : apiKey;

    if (!finalKey) {
      return reply.code(400).send({ error: 'Brevo API key is required' });
    }

    const senderEmail = body.senderEmail || body.from;
    const parsed = parseSender(senderEmail || '');
    const testConfig: BrevoApiConfig = {
      apiKey: finalKey.trim(),
      senderEmail: (senderEmail && !senderEmail.includes('<') ? senderEmail : parsed.email) || current?.senderEmail || '',
      senderName: (body.senderName || parsed.name || current?.senderName || 'GitLens Portal').trim(),
    };

    if (!mailer) {
      return reply.code(500).send({ error: 'Mailer service unavailable' });
    }

    const result = await mailer.testBrevoConnection(testConfig, testEmail.trim());
    if (!result.success) {
      return reply.code(400).send({ error: result.error || 'Brevo API test failed' });
    }

    return reply.send({ ok: true, message: result.message || `Test email successfully dispatched to ${testEmail}` });
  };

  app.get('/api/admin/email', adminGuard, handleGetEmailConfig);
  app.put('/api/admin/email', adminGuard, handleSaveEmailConfig);
  app.post('/api/admin/email/test', adminGuard, handleTestEmailConfig);

  // Backwards-compatible aliases
  app.get('/api/admin/smtp', adminGuard, handleGetEmailConfig);
  app.put('/api/admin/smtp', adminGuard, handleSaveEmailConfig);
  app.post('/api/admin/smtp/test', adminGuard, handleTestEmailConfig);

  // 7. SysAdmin: Inspect Local VPS Cloned Repository (SYS-LOCAL-01)
  app.post('/api/admin/local-repos/inspect', adminGuard, async (req, reply) => {
    if (!localRepoService) {
      return reply.code(500).send({ error: 'Local repository service is not initialized' });
    }
    const { path: rawPath } = (req.body as { path: string }) || {};
    if (!rawPath) {
      return reply.code(400).send({ error: 'Filesystem directory path is required' });
    }

    const result = await localRepoService.inspectLocalRepo(rawPath);
    return reply.send(result);
  });

  // 8. SysAdmin: Publish Local VPS Cloned Repository without Git Connection & Copy to Additional Location (SYS-LOCAL-02)
  app.post('/api/admin/local-repos/publish', adminGuard, async (req, reply) => {
    if (!localRepoService) {
      return reply.code(500).send({ error: 'Local repository service is not initialized' });
    }

    const {
      name,
      localPath,
      branch,
      additionalCopyPath,
      copyMode,
      autoCopyOnSync,
      geminiApiKey,
    } = (req.body as {
      name: string;
      localPath: string;
      branch?: string;
      additionalCopyPath?: string;
      copyMode?: 'WORKING_TREE' | 'FULL_REPO';
      autoCopyOnSync?: boolean;
      geminiApiKey?: string;
    }) || {};

    if (!name || !localPath) {
      return reply.code(400).send({ error: 'Project name and local directory path are required' });
    }

    // Inspect and validate local repository
    const inspection = await localRepoService.inspectLocalRepo(localPath);
    if (!inspection.isValid) {
      return reply.code(400).send({ error: inspection.error || 'Invalid local Git repository' });
    }

    const projectId = randomUUID();
    const resolvedSource = path.resolve(localPath.trim());
    const trackingBranch = branch?.trim() || inspection.currentBranch || 'main';
    const resolvedAdditional = additionalCopyPath?.trim() ? path.resolve(additionalCopyPath.trim()) : null;
    const encGemini = geminiApiKey?.trim() ? encryptSecret(geminiApiKey.trim()) : null;

    db.prepare(`
      INSERT INTO projects (
        id, owner_id, name, repo_url, branch,
        encrypted_gemini_key, is_local_repo, local_source_path,
        additional_copy_path, copy_mode, auto_copy_on_sync,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      req.user!.sub,
      name.trim(),
      resolvedSource,
      trackingBranch,
      encGemini,
      resolvedSource,
      resolvedAdditional,
      copyMode || 'WORKING_TREE',
      autoCopyOnSync !== false ? 1 : 0,
      Date.now()
    );

    // Create default "All Docs" Viewer Group
    const defaultGroupId = randomUUID();
    db.prepare(`
      INSERT INTO viewer_groups (id, project_id, name, allowed_folders_json, allowed_extensions_json, exclude_globs_json, max_file_size_bytes)
      VALUES (?, ?, 'Default Viewers', '["*"]', '[]', '["**/*.secret.*", "**/internal/**", "**/.env*"]', 2097152)
    `).run(defaultGroupId, projectId);

    // Synchronize local bare repository and initial file list
    let syncResult: any = null;
    if (syncOrchestrator) {
      try {
        syncResult = await syncOrchestrator.syncProject(projectId, 'MANUAL');
      } catch (err: any) {
        console.error('Initial sync of local project failed:', err);
      }
    }

    // If additional copy location was provided, copy immediately
    let copyResult: any = null;
    if (resolvedAdditional && projectCopier) {
      try {
        copyResult = await projectCopier.copyProjectToLocation(projectId, resolvedAdditional, {
          commitSha: syncResult?.newSha || inspection.headCommitSha,
          copyMode: copyMode || 'WORKING_TREE',
          localSourcePath: resolvedSource,
        });
      } catch (copyErr: any) {
        console.error('Initial copy to additional location failed:', copyErr);
      }
    }

    return reply.send({
      ok: true,
      projectId,
      syncResult,
      copyResult,
    });
  });
}
