import fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

import { createDatabase } from './db/schema.js';
import { PortalMailer } from './auth/mailer.js';
import { AuthService } from './auth/authService.js';
import { buildAuthMiddlewares } from './auth/authMiddleware.js';
import { BareGitManager } from './services/gitManager.js';
import { GeminiRagService } from './services/geminiRagService.js';
import { LocalRepoService } from './services/localRepoService.js';
import { ProjectCopierService } from './services/projectCopier.js';
import { ProjectSyncAndRagOrchestrator } from './workers/syncWorker.js';

import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerPublisherRoutes } from './routes/publisherRoutes.js';
import { registerViewerRoutes } from './routes/viewerRoutes.js';

export interface AppConfig {
  dbPath: string;
  reposDir: string;
  portalBaseUrl?: string;
  bootstrapSysAdminEmail?: string;
}

export function buildApp(config: AppConfig): {
  app: FastifyInstance;
  db: Database.Database;
  authService: AuthService;
  gitManager: BareGitManager;
  syncOrchestrator: ProjectSyncAndRagOrchestrator;
  geminiService: GeminiRagService;
  projectCopier: ProjectCopierService;
  localRepoService: LocalRepoService;
} {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.reposDir, { recursive: true });

  const db = createDatabase(config.dbPath);
  const mailer = new PortalMailer(db);
  const authService = new AuthService(db, mailer, config.portalBaseUrl);
  const middlewares = buildAuthMiddlewares(db);
  const gitManager = new BareGitManager(config.reposDir);
  const geminiService = new GeminiRagService();
  const projectCopier = new ProjectCopierService(db, gitManager);
  const localRepoService = new LocalRepoService();
  const syncOrchestrator = new ProjectSyncAndRagOrchestrator(db, gitManager, geminiService, projectCopier);

  // Bootstrap initial SysAdmin
  const bootstrapEmail = config.bootstrapSysAdminEmail || process.env.SYSADMIN_BOOTSTRAP_EMAIL || 'admin@gitlens-portal.local';
  authService.bootstrapSysAdmin(bootstrapEmail);

  const app = fastify({ logger: false });

  // Capture raw body for webhook HMAC verification while parsing JSON normally
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const rawStr = typeof body === 'string' ? body : body.toString('utf8');
      (req as any).rawBody = rawStr;
      const json = rawStr ? JSON.parse(rawStr) : {};
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Strict CORS origin validation (H-4)
  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ]);
  if (config.portalBaseUrl) {
    try {
      allowedOrigins.add(new URL(config.portalBaseUrl).origin);
    } catch {}
  }
  if (process.env.PORTAL_BASE_URL) {
    try {
      allowedOrigins.add(new URL(process.env.PORTAL_BASE_URL).origin);
    } catch {}
  }

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  });

  app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'gitlens-portal-cookie-secret-key-signature',
  });

  // Baseline security headers on all responses
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.getHeader('X-Content-Type-Options')) {
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    if (!reply.getHeader('Referrer-Policy')) {
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
    if (!reply.getHeader('X-Frame-Options')) {
      reply.header('X-Frame-Options', 'SAMEORIGIN');
    }
    return payload;
  });

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: Date.now(),
    version: '1.0.0',
  }));

  // Register Routes
  registerAuthRoutes(app, authService, middlewares);
  registerAdminRoutes(app, db, authService, middlewares, mailer, localRepoService, projectCopier, syncOrchestrator);
  registerPublisherRoutes(app, db, authService, middlewares, gitManager, syncOrchestrator, geminiService, projectCopier);
  registerViewerRoutes(app, db, middlewares, gitManager, syncOrchestrator, geminiService);

  // Serve static SPA in production if dist/client exists
  const clientDist = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'API endpoint not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return {
    app,
    db,
    authService,
    gitManager,
    syncOrchestrator,
    geminiService,
    projectCopier,
    localRepoService,
  };
}
