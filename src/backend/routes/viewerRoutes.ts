import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';
import { BareGitManager } from '../services/gitManager.js';
import { ProjectSyncAndRagOrchestrator } from '../workers/syncWorker.js';
import { GeminiRagService } from '../services/geminiRagService.js';
import { resolveAuthorizedFiles, buildPrunedFileTree } from '../services/aclMatcher.js';
import { decryptSecret } from '../utils/crypto.js';

export async function registerViewerRoutes(
  app: FastifyInstance,
  db: Database.Database,
  middlewares: ReturnType<typeof buildAuthMiddlewares>,
  gitManager: BareGitManager,
  syncOrchestrator: ProjectSyncAndRagOrchestrator,
  geminiService: GeminiRagService
) {
  const viewerGuard = { preHandler: [middlewares.requireProjectViewerAccess] };

  // 1. Get Dynamic Filtered File Tree (VIE-02)
  app.get('/api/viewer/:projectId/tree', viewerGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = db
      .prepare(`SELECT id, name, last_synced_sha, encrypted_gemini_key FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project || !project.last_synced_sha) {
      return reply.send({
        tree: [],
        authorizedPaths: [],
        projectName: project?.name || 'Project',
        aiEnabled: false,
        lastSyncedSha: null,
      });
    }

    const allRepoFiles = await gitManager.listRepoFiles(projectId, project.last_synced_sha);
    const authorizedPaths = resolveAuthorizedFiles(allRepoFiles, req.projectAclRules || []);
    const authorizedEntries = allRepoFiles.filter((f) => authorizedPaths.includes(f.filePath));
    const tree = buildPrunedFileTree(authorizedEntries);

    return reply.send({
      tree,
      authorizedPaths,
      projectName: project.name,
      aiEnabled: !!project.encrypted_gemini_key,
      lastSyncedSha: project.last_synced_sha,
      isPublisher: !!req.isProjectPublisher,
    });
  });

  // 2. Fetch File Blob with ACL Enforcement (VIE-03, VIE-04)
  app.get('/api/viewer/:projectId/blob', viewerGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { path: rawPath } = req.query as { path: string };

    if (!rawPath) {
      return reply.code(400).send({ error: 'File path query parameter is required' });
    }

    const normalizedPath = rawPath.replace(/^\/+/, '');
    const project = db
      .prepare(`SELECT id, last_synced_sha FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project?.last_synced_sha) {
      return reply.code(404).send({ error: 'Repository has not been synced yet' });
    }

    const allRepoFiles = await gitManager.listRepoFiles(projectId, project.last_synced_sha);
    const authorizedPaths = resolveAuthorizedFiles(allRepoFiles, req.projectAclRules || []);

    // Strict ACL gate check
    if (!authorizedPaths.includes(normalizedPath)) {
      return reply.code(403).send({
        error: `Access restricted: "${normalizedPath}" is outside your viewer group scope.`,
        restricted: true,
      });
    }

    try {
      const content = await gitManager.readFileBlob(
        projectId,
        project.last_synced_sha,
        normalizedPath
      );
      const fileEntry = allRepoFiles.find((f) => f.filePath === normalizedPath);

      return reply.send({
        path: normalizedPath,
        content,
        sizeBytes: fileEntry?.sizeBytes || Buffer.byteLength(content, 'utf8'),
        commitSha: project.last_synced_sha,
      });
    } catch (err: any) {
      return reply.code(404).send({ error: 'File not found in repository commit' });
    }
  });

  // 3. Raw File Serving Endpoint with MIME types & Full Script Execution (VIE-03)
  app.get('/api/viewer/:projectId/raw/*', viewerGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const rawPath = (req.params as any)['*'];

    if (!rawPath) {
      return reply.code(400).send({ error: 'File path parameter is required' });
    }

    const normalizedPath = rawPath.replace(/^\/+/, '');
    const project = db
      .prepare(`SELECT id, last_synced_sha FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project?.last_synced_sha) {
      return reply.code(404).send({ error: 'Repository has not been synced yet' });
    }

    const allRepoFiles = await gitManager.listRepoFiles(projectId, project.last_synced_sha);
    const authorizedPaths = resolveAuthorizedFiles(allRepoFiles, req.projectAclRules || []);

    if (!authorizedPaths.includes(normalizedPath)) {
      return reply.code(403).send({
        error: `Access restricted: "${normalizedPath}" is outside your viewer group scope.`,
        restricted: true,
      });
    }

    try {
      const content = await gitManager.readFileBlob(
        projectId,
        project.last_synced_sha,
        normalizedPath
      );

      const mimeType = getMimeType(normalizedPath);
      reply.header('Content-Type', mimeType);
      return reply.send(content);
    } catch (err: any) {
      return reply.code(404).send({ error: 'File not found in repository commit' });
    }
  });

  // 3. ACL-Scoped Viewer RAG Query (VIE-06, Flow B)
  app.post('/api/viewer/:projectId/rag/chat', viewerGuard, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { question } = req.body as { question: string };

    if (!question || !question.trim()) {
      return reply.code(400).send({ error: 'Question is required' });
    }

    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(projectId) as any;

    if (!project?.encrypted_gemini_key) {
      return reply.code(400).send({ error: 'AI Assistant is not configured for this project' });
    }

    // Check Viewer Daily Quota
    const today = new Date().toISOString().split('T')[0];
    const userId = req.user!.sub;

    if (!req.isProjectPublisher) {
      const usageRow = db
        .prepare(`
          SELECT query_count FROM viewer_daily_usage
          WHERE project_id = ? AND user_id = ? AND usage_date = ?
        `)
        .get(projectId, userId, today) as { query_count: number } | undefined;

      const currentCount = usageRow?.query_count || 0;
      if (currentCount >= project.daily_viewer_query_limit) {
        return reply.code(429).send({
          error: `Daily query quota exceeded (${currentCount}/${project.daily_viewer_query_limit} queries). Try again tomorrow.`,
        });
      }
    }

    // Retrieve ACL-filtered chunks
    let chunks;
    try {
      chunks = await syncOrchestrator.retrieveAuthorizedContext(
        projectId,
        req.projectAclRules || [],
        question.trim(),
        6
      );
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Retrieval failed' });
    }

    // Setup Server-Sent Events (SSE)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    if (chunks.length === 0) {
      const msg = 'No authorized repository context was found matching your query within your permitted files.';
      reply.raw.write(`data: ${JSON.stringify({ text: msg, citations: [] })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    const citations = chunks.map((c) => ({
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
    }));

    // Send citations initial event
    reply.raw.write(`data: ${JSON.stringify({ citations })}\n\n`);

    try {
      const decryptedKey = decryptSecret(project.encrypted_gemini_key);
      const stream = geminiService.streamGroundedAnswer({
        decryptedGeminiKey: decryptedKey,
        model: project.gemini_chat_model || 'gemini-3.8-flash',
        systemPrompt: project.system_prompt,
        userQuestion: question.trim(),
        retrievedChunks: chunks,
      });

      for await (const token of stream) {
        reply.raw.write(`data: ${JSON.stringify({ text: token })}\n\n`);
      }

      // Record daily usage increment
      db.prepare(`
        INSERT INTO viewer_daily_usage (project_id, user_id, usage_date, query_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(project_id, user_id, usage_date) DO UPDATE SET query_count = query_count + 1
      `).run(projectId, userId, today);

      reply.raw.write('data: [DONE]\n\n');
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ error: err.message || 'AI streaming error' })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'js':
    case 'mjs':
      return 'application/javascript; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'pdf':
      return 'application/pdf';
    case 'md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}
