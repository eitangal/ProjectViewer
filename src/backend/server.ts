import 'dotenv/config';
import path from 'node:path';
import { buildApp } from './app.js';
import { validateJwtConfig } from './auth/tokenService.js';
import { validateMasterKeyConfig } from './utils/crypto.js';

// Pre-flight validation of production cryptographic secrets to fail fast on startup
validateJwtConfig();
validateMasterKeyConfig();

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'portal.db');
const REPOS_DIR = process.env.REPOS_DIR || path.join(DATA_DIR, 'repos');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || `http://localhost:${PORT}`;

const { app, syncOrchestrator } = buildApp({
  dbPath: DB_PATH,
  reposDir: REPOS_DIR,
  portalBaseUrl: PORTAL_BASE_URL,
  bootstrapSysAdminEmail: process.env.SYSADMIN_BOOTSTRAP_EMAIL || 'admin@gitlens-portal.local',
});

// Start scheduled sync worker
syncOrchestrator.startScheduledSyncWorker(60);

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    console.error('Failed to start GitLens-Portal server:', err);
    process.exit(1);
  }
  console.log(`🚀 GitLens-Portal server listening at ${address}`);
});
