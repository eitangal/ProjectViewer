import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { AuthService } from '../auth/authService.js';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';
import { PortalMailer, SmtpConfig } from '../auth/mailer.js';

export async function registerAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
  authService: AuthService,
  middlewares: ReturnType<typeof buildAuthMiddlewares>,
  mailer?: PortalMailer
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

  // 6. SMTP Management & Verification
  app.get('/api/admin/smtp', adminGuard, async (req, reply) => {
    const config = mailer?.getSmtpConfig();
    return reply.send({
      isConfigured: !!config,
      config: config
        ? {
            host: config.host,
            port: config.port,
            secure: config.secure,
            user: config.user,
            pass: config.pass ? '••••••••' : '',
            from: config.from,
          }
        : null,
    });
  });

  app.put('/api/admin/smtp', adminGuard, async (req, reply) => {
    const { host, port, secure, user, pass, from } = req.body as SmtpConfig;
    if (!host) {
      return reply.code(400).send({ error: 'SMTP host is required' });
    }

    const current = mailer?.getSmtpConfig();
    const finalPass = pass === '••••••••' || pass === undefined ? (current?.pass || '') : pass;

    const newConfig: SmtpConfig = {
      host: host.trim(),
      port: Number(port) || 587,
      secure: Boolean(secure),
      user: (user || '').trim(),
      pass: finalPass,
      from: (from || 'noreply@gitlens-portal.local').trim(),
    };

    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES ('smtp_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(newConfig), Date.now());

    mailer?.reloadTransporter();

    return reply.send({ ok: true, isConfigured: true });
  });

  app.post('/api/admin/smtp/test', adminGuard, async (req, reply) => {
    const { host, port, secure, user, pass, from, testEmail } = req.body as SmtpConfig & { testEmail: string };
    if (!host || !testEmail) {
      return reply.code(400).send({ error: 'SMTP host and test recipient email are required' });
    }

    const current = mailer?.getSmtpConfig();
    const finalPass = pass === '••••••••' || pass === undefined ? (current?.pass || '') : pass;

    const testConfig: SmtpConfig = {
      host: host.trim(),
      port: Number(port) || 587,
      secure: Boolean(secure),
      user: (user || '').trim(),
      pass: finalPass,
      from: (from || 'noreply@gitlens-portal.local').trim(),
    };

    if (!mailer) {
      return reply.code(500).send({ error: 'Mailer service unavailable' });
    }

    const result = await mailer.testSmtpConnection(testConfig, testEmail.trim());
    if (!result.success) {
      return reply.code(400).send({ error: result.error || 'SMTP test failed' });
    }

    return reply.send({ ok: true, message: `Test email successfully dispatched to ${testEmail}` });
  });
}
