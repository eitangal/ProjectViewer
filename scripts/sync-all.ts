import 'dotenv/config';
import path from 'node:path';
import { createDatabase } from '../src/backend/db/schema.js';
import { BareGitManager } from '../src/backend/services/gitManager.js';
import { ProjectCopierService } from '../src/backend/services/projectCopier.js';
import { GeminiRagService } from '../src/backend/services/geminiRagService.js';
import { ProjectSyncAndRagOrchestrator } from '../src/backend/workers/syncWorker.js';

async function syncAll() {
  const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'portal.db');
  const REPOS_DIR = process.env.REPOS_DIR || path.join(DATA_DIR, 'repos');

  console.log(`[+] Initializing DB: ${DB_PATH}`);
  const db = createDatabase(DB_PATH);
  const gitManager = new BareGitManager(REPOS_DIR);
  const geminiService = new GeminiRagService();
  const projectCopier = new ProjectCopierService(db, gitManager);
  const orchestrator = new ProjectSyncAndRagOrchestrator(db, gitManager, geminiService, projectCopier);

  const projects = db.prepare('SELECT id, name, is_local_repo, local_source_path, branch FROM projects').all() as any[];

  console.log(`[+] Found ${projects.length} project(s) to sync:`);
  for (const proj of projects) {
    console.log(`\n[+] Syncing project "${proj.name}" (${proj.id})...`);
    console.log(`    Source: ${proj.local_source_path || 'remote'}`);
    console.log(`    Branch: ${proj.branch}`);
    try {
      const res = await orchestrator.syncProject(proj.id, 'MANUAL');
      console.log(`[✓] SUCCESS:`);
      console.log(`    Commit SHA:   ${res.newSha.slice(0, 7)}`);
      console.log(`    Total Files:  ${res.totalFiles}`);
      console.log(`    Indexed RAG:  ${res.indexedFiles}`);
      console.log(`    Duration:     ${res.durationMs}ms`);
    } catch (err: any) {
      console.error(`[-] ERROR syncing project "${proj.name}":`, err.message || err);
    }
  }

  console.log('\n[+] Sync completed for all projects.');
}

syncAll().catch((err) => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
