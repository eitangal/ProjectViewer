import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/backend/db/schema.js';
import { BareGitManager } from '../src/backend/services/gitManager.js';
import { LocalRepoService } from '../src/backend/services/localRepoService.js';
import { ProjectCopierService } from '../src/backend/services/projectCopier.js';
import { GeminiRagService } from '../src/backend/services/geminiRagService.js';
import { ProjectSyncAndRagOrchestrator } from '../src/backend/workers/syncWorker.js';

async function main() {
  const args = process.argv.slice(2);
  let rawPath = '';
  let name = '';
  let branch = '';
  let copyTo = '';
  let copyMode: 'WORKING_TREE' | 'FULL_REPO' = 'WORKING_TREE';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--path' || arg === '-p') {
      rawPath = args[++i] || '';
    } else if (arg === '--name' || arg === '-n') {
      name = args[++i] || '';
    } else if (arg === '--branch' || arg === '-b') {
      branch = args[++i] || '';
    } else if (arg === '--copy-to' || arg === '-c') {
      copyTo = args[++i] || '';
    } else if (arg === '--copy-mode' || arg === '-m') {
      const mode = args[++i];
      if (mode === 'FULL_REPO') copyMode = 'FULL_REPO';
    }
  }

  if (!rawPath) {
    console.error('Usage: ./scripts/publish-local.sh --path <local_directory> [--name <project_name>] [--branch <branch>] [--copy-to <dest_path>] [--copy-mode <WORKING_TREE|FULL_REPO>]');
    process.exit(1);
  }

  const localRepoService = new LocalRepoService();
  console.log(`[+] Inspecting local repository at "${rawPath}"...`);
  const inspection = await localRepoService.inspectLocalRepo(rawPath);

  if (!inspection.isValid) {
    console.error(`[-] ERROR: ${inspection.error || 'Invalid local Git repository'}`);
    process.exit(1);
  }

  const projectName = (name || inspection.suggestedName).trim();
  const trackingBranch = (branch || inspection.currentBranch || 'main').trim();
  const resolvedSource = path.resolve(rawPath.trim());
  const resolvedCopyTo = copyTo.trim() ? path.resolve(copyTo.trim()) : null;

  console.log(`[+] Valid Git repository found:`);
  console.log(`    Suggested Name: ${projectName}`);
  console.log(`    Current Branch: ${inspection.currentBranch}`);
  console.log(`    HEAD Commit:    ${inspection.headCommitSha.slice(0, 7)} - ${inspection.commitMessage}`);
  console.log(`    Total Files:    ${inspection.totalFiles}`);

  const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'portal.db');
  const REPOS_DIR = process.env.REPOS_DIR || path.join(DATA_DIR, 'repos');

  const db = createDatabase(DB_PATH);
  const gitManager = new BareGitManager(REPOS_DIR);
  const geminiService = new GeminiRagService();
  const projectCopier = new ProjectCopierService(db, gitManager);
  const syncOrchestrator = new ProjectSyncAndRagOrchestrator(db, gitManager, geminiService, projectCopier);

  // Find root SysAdmin user ID
  const adminUser = db
    .prepare(`SELECT id, email FROM users WHERE global_role = 'SYSADMIN' ORDER BY created_at ASC LIMIT 1`)
    .get() as any;

  if (!adminUser) {
    console.error('[-] ERROR: No SysAdmin user found in database. Please run GitLens-Portal at least once to bootstrap root SysAdmin.');
    process.exit(1);
  }

  const projectId = randomUUID();

  console.log(`[+] Registering project in database as local VPS clone (id: ${projectId})...`);
  db.prepare(`
    INSERT INTO projects (
      id, owner_id, name, repo_url, branch,
      is_local_repo, local_source_path,
      additional_copy_path, copy_mode, auto_copy_on_sync,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?)
  `).run(
    projectId,
    adminUser.id,
    projectName,
    resolvedSource,
    trackingBranch,
    resolvedSource,
    resolvedCopyTo,
    copyMode,
    Date.now()
  );

  // Create default viewer group
  const defaultGroupId = randomUUID();
  db.prepare(`
    INSERT INTO viewer_groups (id, project_id, name, allowed_folders_json, allowed_extensions_json, exclude_globs_json, max_file_size_bytes)
    VALUES (?, ?, 'Default Viewers', '["*"]', '[]', '["**/*.secret.*", "**/internal/**", "**/.env*"]', 2097152)
  `).run(defaultGroupId, projectId);

  console.log(`[+] Initializing bare projection from local clone without network...`);
  const syncResult = await syncOrchestrator.syncProject(projectId, 'MANUAL');
  console.log(`[+] Successfully synchronized HEAD commit ${syncResult.newSha.slice(0, 7)} (${syncResult.totalFiles} files).`);

  if (resolvedCopyTo) {
    console.log(`[+] Copying materialized files to additional location: "${resolvedCopyTo}" (mode: ${copyMode})...`);
    const copyResult = await projectCopier.copyProjectToLocation(projectId, resolvedCopyTo, {
      commitSha: syncResult.newSha,
      copyMode,
      localSourcePath: resolvedSource,
    });

    if (copyResult.ok) {
      console.log(`[+] Successfully exported ${copyResult.filesCount} files to "${resolvedCopyTo}" in ${copyResult.durationMs}ms.`);
    } else {
      console.error(`[-] WARNING: Failed to copy to additional location: ${copyResult.error}`);
    }
  }

  console.log('==========================================================');
  console.log(` [SUCCESS] Project "${projectName}" published successfully!`);
  console.log(` Project ID:   ${projectId}`);
  console.log(` Source Path:  ${resolvedSource}`);
  if (resolvedCopyTo) {
    console.log(` Copy Location: ${resolvedCopyTo}`);
  }
  console.log('==========================================================');
}

main().catch((err) => {
  console.error('[-] Fatal error publishing local project:', err);
  process.exit(1);
});
