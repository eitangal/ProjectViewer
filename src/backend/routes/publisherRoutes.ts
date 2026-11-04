import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/authService.js';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';
import { ProjectSyncAndRagOrchestrator } from '../workers/syncWorker.js';
import { BareGitManager } from '../services/gitManager.js';
import { GeminiRagService } from '../services/geminiRagService.js';
import { encryptSecret, verifyGithubWebhookSignature } from '../utils/crypto.js';

export async function registerPublisherRoutes(
  app: FastifyInstance,
  db: Database.Database,
  authService: AuthService,
  middlewares: ReturnType<typeof buildAuthMiddlewares>,
  gitManager: BareGitManager,
  syncOrchestrator: ProjectSyncAndRagOrchestrator,
  geminiService: GeminiRagService
) {
  const publisherGuard = { preHandler: [middlewares.requireRole(['PUBLISHER', 'SYSADMIN'])] };

  // Helper to ensure publisher owns the project
  function getOwnedProject(projectId: string, userId: string, role: string) {
    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as any;
    if (!project) return null;
    if (project.owner_id !== userId && role !== 'SYSADMIN') return null;
    return project;
  }

  // 1. List Projects for Publisher
  app.get('/api/projects', publisherGuard, async (req, reply) => {
    const isSysAdmin = req.user!.role === 'SYSADMIN';
    const sql = isSysAdmin
      ? `SELECT * FROM projects ORDER BY created_at DESC`
      : `SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC`;

    const rows = isSysAdmin
      ? db.prepare(sql).all() as any[]
      : db.prepare(sql).all(req.user!.sub) as any[];

    const projects = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.owner_id,
      repoUrl: r.repo_url,
      branch: r.branch,
      hasGithubPat: !!r.encrypted_github_pat,
      hasWebhookSecret: !!r.encrypted_webhook_secret,
      hasGeminiKey: !!r.encrypted_gemini_key,
      geminiChatModel: r.gemini_chat_model,
      geminiEmbeddingModel: r.gemini_embedding_model,
      systemPrompt: r.system_prompt,
      dailyViewerQueryLimit: r.daily_viewer_query_limit,
      syncIntervalMinutes: r.sync_interval_minutes,
      lastSyncedSha: r.last_synced_sha,
      lastSyncedAt: r.last_synced_at,
      syncStatus: r.sync_status,
      lastSyncError: r.last_sync_error,
      diskUsageBytes: r.disk_usage_bytes,
      totalFiles: r.total_files ?? 0,
      createdAt: r.created_at,
    }));

    return reply.send({ projects });
  });

  // 2. Create Project
  app.post('/api/projects', publisherGuard, async (req, reply) => {
    const { name, repoUrl, branch, githubPat, webhookSecret, geminiApiKey } = req.body as {
      name: string;
      repoUrl: string;
      branch?: string;
      githubPat?: string;
      webhookSecret?: string;
      geminiApiKey?: string;
    };

    if (!name || !repoUrl) {
      return reply.code(400).send({ error: 'Project name and Git repository URL are required' });
    }

    // Check publisher max_repos quota
    if (req.user!.role !== 'SYSADMIN') {
      const user = db.prepare(`SELECT max_repos FROM users WHERE id = ?`).get(req.user!.sub) as any;
      const count = (db.prepare(`SELECT COUNT(*) as count FROM projects WHERE owner_id = ?`).get(req.user!.sub) as any).count;
      if (count >= (user?.max_repos ?? 5)) {
        return reply.code(400).send({ error: `Repository limit reached (max ${user?.max_repos ?? 5} projects)` });
      }
    }

    const projectId = randomUUID();
    const encPat = githubPat ? encryptSecret(githubPat.trim()) : null;
    const encWebhook = webhookSecret ? encryptSecret(webhookSecret.trim()) : null;
    const encGemini = geminiApiKey ? encryptSecret(geminiApiKey.trim()) : null;

    db.prepare(`
      INSERT INTO projects (
        id, owner_id, name, repo_url, branch,
        encrypted_github_pat, encrypted_webhook_secret, encrypted_gemini_key,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      req.user!.sub,
      name.trim(),
      repoUrl.trim(),
      branch?.trim() || 'main',
      encPat,
      encWebhook,
      encGemini,
      Date.now()
    );

    // Create default "All Docs" Viewer Group
    const defaultGroupId = randomUUID();
    db.prepare(`
      INSERT INTO viewer_groups (id, project_id, name, allowed_folders_json, allowed_extensions_json, exclude_globs_json, max_file_size_bytes)
      VALUES (?, ?, 'Default Viewers', '["*"]', '[]', '["**/*.secret.*", "**/internal/**", "**/.env*"]', 2097152)
    `).run(defaultGroupId, projectId);

    return reply.send({ ok: true, projectId });
  });

  // 3. Get Project Details
  app.get('/api/projects/:projectId', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    return reply.send({
      project: {
        id: p.id,
        name: p.name,
        ownerId: p.owner_id,
        repoUrl: p.repo_url,
        branch: p.branch,
        hasGithubPat: !!p.encrypted_github_pat,
        hasWebhookSecret: !!p.encrypted_webhook_secret,
        hasGeminiKey: !!p.encrypted_gemini_key,
        geminiChatModel: p.gemini_chat_model,
        geminiEmbeddingModel: p.gemini_embedding_model,
        systemPrompt: p.system_prompt,
        dailyViewerQueryLimit: p.daily_viewer_query_limit,
        syncIntervalMinutes: p.sync_interval_minutes,
        lastSyncedSha: p.last_synced_sha,
        lastSyncedAt: p.last_synced_at,
        syncStatus: p.sync_status,
        lastSyncError: p.last_sync_error,
        diskUsageBytes: p.disk_usage_bytes,
        createdAt: p.created_at,
      },
    });
  });

  // 4. Update Project Settings
  app.patch('/api/projects/:projectId', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const body = req.body as any;
    let encPat = p.encrypted_github_pat;
    if (body.githubPat !== undefined) {
      encPat = body.githubPat ? encryptSecret(body.githubPat.trim()) : null;
    }
    let encWebhook = p.encrypted_webhook_secret;
    if (body.webhookSecret !== undefined) {
      encWebhook = body.webhookSecret ? encryptSecret(body.webhookSecret.trim()) : null;
    }

    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        repo_url = COALESCE(?, repo_url),
        branch = COALESCE(?, branch),
        encrypted_github_pat = ?,
        encrypted_webhook_secret = ?,
        sync_interval_minutes = COALESCE(?, sync_interval_minutes),
        daily_viewer_query_limit = COALESCE(?, daily_viewer_query_limit)
      WHERE id = ?
    `).run(
      body.name ?? null,
      body.repoUrl ?? null,
      body.branch ?? null,
      encPat,
      encWebhook,
      body.syncIntervalMinutes ?? null,
      body.dailyViewerQueryLimit ?? null,
      projectId
    );

    return reply.send({ ok: true });
  });

  // 5. Delete Project
  app.delete('/api/projects/:projectId', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    return reply.send({ ok: true });
  });

  // 6. Trigger Delta Git Sync (PUB-03)
  app.post('/api/projects/:projectId/sync', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { forceReindex } = (req.body as { forceReindex?: boolean }) || {};
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    try {
      const syncResult = await syncOrchestrator.syncProject(projectId, 'MANUAL', { forceReindex });
      return reply.send({ ok: true, syncResult });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Git sync failed' });
    }
  });

  // 7. Get Sync Logs (PUB-03)
  app.get('/api/projects/:projectId/sync-logs', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const logs = db.prepare(`
      SELECT * FROM sync_logs
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(projectId);

    return reply.send({ logs });
  });

  // 8. GitHub Webhook Receiver (PUB-03)
  app.post('/api/webhooks/github/:projectId', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as any;
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    // Validate signature if webhook secret is configured
    if (project.encrypted_webhook_secret) {
      const secret = (await import('../utils/crypto.js')).decryptSecret(project.encrypted_webhook_secret);
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = JSON.stringify(req.body);
      const valid = verifyGithubWebhookSignature(rawBody, signature, secret);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }
    }

    // Trigger sync asynchronously in background
    syncOrchestrator.syncProject(projectId, 'WEBHOOK').catch((err) => {
      console.error(`Webhook sync error on project ${projectId}:`, err);
    });

    return reply.send({ ok: true, status: 'Sync triggered' });
  });

  // 9. Viewer Groups CRUD (PUB-04)
  app.get('/api/projects/:projectId/groups', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const rows = db.prepare(`
      SELECT vg.*, (SELECT COUNT(DISTINCT user_id) FROM user_group_memberships WHERE group_id = vg.id) as viewerCount
      FROM viewer_groups vg
      WHERE vg.project_id = ?
      ORDER BY vg.name ASC
    `).all(projectId) as any[];

    const groups = rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      allowedFolders: JSON.parse(r.allowed_folders_json || '[]'),
      allowedExtensions: JSON.parse(r.allowed_extensions_json || '[]'),
      excludeGlobs: JSON.parse(r.exclude_globs_json || '[]'),
      maxFileSizeBytes: r.max_file_size_bytes,
      viewerCount: r.viewerCount,
    }));

    return reply.send({ groups });
  });

  app.post('/api/projects/:projectId/groups', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const { name, allowedFolders, allowedExtensions, excludeGlobs, maxFileSizeBytes } = req.body as any;
    if (!name) return reply.code(400).send({ error: 'Group name is required' });

    const groupId = randomUUID();
    db.prepare(`
      INSERT INTO viewer_groups (id, project_id, name, allowed_folders_json, allowed_extensions_json, exclude_globs_json, max_file_size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      projectId,
      name.trim(),
      JSON.stringify(allowedFolders || ['*']),
      JSON.stringify(allowedExtensions || []),
      JSON.stringify(excludeGlobs || []),
      maxFileSizeBytes || 2097152
    );

    return reply.send({ ok: true, groupId });
  });

  app.put('/api/projects/:projectId/groups/:groupId', publisherGuard, async (req, reply) => {
    const { projectId, groupId } = req.params as { projectId: string; groupId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const { name, allowedFolders, allowedExtensions, excludeGlobs, maxFileSizeBytes } = req.body as any;

    db.prepare(`
      UPDATE viewer_groups SET
        name = COALESCE(?, name),
        allowed_folders_json = COALESCE(?, allowed_folders_json),
        allowed_extensions_json = COALESCE(?, allowed_extensions_json),
        exclude_globs_json = COALESCE(?, exclude_globs_json),
        max_file_size_bytes = COALESCE(?, max_file_size_bytes)
      WHERE id = ? AND project_id = ?
    `).run(
      name ?? null,
      allowedFolders ? JSON.stringify(allowedFolders) : null,
      allowedExtensions ? JSON.stringify(allowedExtensions) : null,
      excludeGlobs ? JSON.stringify(excludeGlobs) : null,
      maxFileSizeBytes ?? null,
      groupId,
      projectId
    );

    return reply.send({ ok: true });
  });

  app.delete('/api/projects/:projectId/groups/:groupId', publisherGuard, async (req, reply) => {
    const { projectId, groupId } = req.params as { projectId: string; groupId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    db.prepare(`DELETE FROM viewer_groups WHERE id = ? AND project_id = ?`).run(groupId, projectId);
    return reply.send({ ok: true });
  });

  // 10. Real Repository File List for Live ACL Tree Preview (PUB-05)
  app.get('/api/projects/:projectId/repo-files', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    if (!p.last_synced_sha) {
      return reply.send({ files: [], synced: false });
    }

    try {
      const files = await gitManager.listRepoFiles(projectId, p.last_synced_sha);
      return reply.send({ files, synced: true, commitSha: p.last_synced_sha });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Failed to list repository files' });
    }
  });

  // 11. Viewers Management (PUB-06)
  app.get('/api/projects/:projectId/viewers', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const rows = db.prepare(`
      SELECT
        u.id as userId,
        u.email,
        u.status,
        ugm.created_at as invitedAt,
        GROUP_CONCAT(ugm.group_id) as groupIdsConcatenated
      FROM users u
      JOIN user_group_memberships ugm ON ugm.user_id = u.id
      WHERE ugm.project_id = ?
      GROUP BY u.id
      ORDER BY ugm.created_at DESC
    `).all(projectId) as any[];

    const viewers = rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      status: r.status,
      groupIds: r.groupIdsConcatenated ? r.groupIdsConcatenated.split(',') : [],
      invitedAt: r.invitedAt,
    }));

    return reply.send({ viewers });
  });

  app.post('/api/projects/:projectId/invite-viewer', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { email, groupIds } = req.body as { email: string; groupIds: string[] };

    if (!email || !groupIds || groupIds.length === 0) {
      return reply.code(400).send({ error: 'Email and at least one Viewer Group ID are required' });
    }

    try {
      await authService.inviteViewerToGroups({
        publisherUserId: req.user!.sub,
        projectId,
        viewerEmail: email,
        groupIds,
      });
      return reply.send({ ok: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Failed to invite viewer' });
    }
  });

  app.post('/api/projects/:projectId/invite-viewers-bulk', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { entries } = req.body as { entries: { email: string; groupIds: string[] }[] };

    if (!entries || !Array.isArray(entries)) {
      return reply.code(400).send({ error: 'Entries array is required' });
    }

    const result = await authService.bulkInviteViewers({
      publisherUserId: req.user!.sub,
      projectId,
      entries,
    });

    return reply.send({ ok: true, ...result });
  });

  app.delete('/api/projects/:projectId/viewers/:userId', publisherGuard, async (req, reply) => {
    const { projectId, userId } = req.params as { projectId: string; userId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    db.prepare(`DELETE FROM user_group_memberships WHERE project_id = ? AND user_id = ?`).run(projectId, userId);
    return reply.send({ ok: true });
  });

  // 12. Gemini BYOK Settings & Test Connection (PUB-07)
  app.post('/api/projects/:projectId/ai/test-key', publisherGuard, async (req, reply) => {
    const { apiKey } = req.body as { apiKey: string };
    if (!apiKey) return reply.code(400).send({ error: 'API key is required' });

    try {
      await geminiService.validateApiKey(apiKey.trim());
      return reply.send({ ok: true, valid: true });
    } catch (err: any) {
      return reply.code(400).send({ ok: false, error: err.message || 'Invalid Gemini API key' });
    }
  });

  app.put('/api/projects/:projectId/ai/config', publisherGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const p = getOwnedProject(projectId, req.user!.sub, req.user!.role);
    if (!p) return reply.code(404).send({ error: 'Project not found' });

    const { apiKey, chatModel, systemPrompt, dailyViewerQueryLimit } = req.body as any;

    let encKey = p.encrypted_gemini_key;
    if (apiKey !== undefined) {
      encKey = apiKey ? encryptSecret(apiKey.trim()) : null;
    }

    db.prepare(`
      UPDATE projects SET
        encrypted_gemini_key = ?,
        gemini_chat_model = COALESCE(?, gemini_chat_model),
        system_prompt = COALESCE(?, system_prompt),
        daily_viewer_query_limit = COALESCE(?, daily_viewer_query_limit)
      WHERE id = ?
    `).run(
      encKey,
      chatModel ?? null,
      systemPrompt ?? null,
      dailyViewerQueryLimit ?? null,
      projectId
    );

    return reply.send({ ok: true });
  });
}
