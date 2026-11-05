import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load sqlite-vec extension
  sqliteVec.load(db);

  initSchema(db);
  return db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    -- 1. Users & Tenant Quotas (SYS-01, SYS-02, PUB-01, VIE-01)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      global_role TEXT NOT NULL DEFAULT 'VIEWER', -- 'SYSADMIN' | 'PUBLISHER' | 'VIEWER'
      status TEXT NOT NULL DEFAULT 'INVITED',     -- 'INVITED' | 'ACTIVE' | 'SUSPENDED'
      max_repos INTEGER NOT NULL DEFAULT 5,
      max_disk_quota_bytes INTEGER NOT NULL DEFAULT 524288000, -- 500 MB
      max_viewers INTEGER NOT NULL DEFAULT 50,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    -- 2. Projects & BYOK Gemini Settings (PUB-02, PUB-03, PUB-07)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      encrypted_github_pat TEXT,
      encrypted_webhook_secret TEXT,
      encrypted_gemini_key TEXT,
      gemini_chat_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
      gemini_embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
      system_prompt TEXT NOT NULL DEFAULT 'You are a technical repository assistant. Answer strictly using the provided repository context blocks.',
      daily_viewer_query_limit INTEGER NOT NULL DEFAULT 50,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 0,
      last_synced_sha TEXT,
      last_synced_at INTEGER,
      sync_status TEXT NOT NULL DEFAULT 'IDLE', -- 'IDLE' | 'SYNCING' | 'ERROR'
      last_sync_error TEXT,
      disk_usage_bytes INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      is_local_repo INTEGER NOT NULL DEFAULT 0,
      local_source_path TEXT,
      additional_copy_path TEXT,
      copy_mode TEXT NOT NULL DEFAULT 'WORKING_TREE',
      auto_copy_on_sync INTEGER NOT NULL DEFAULT 1,
      last_copied_at INTEGER,
      last_copy_status TEXT,
      last_copy_error TEXT,
      created_at INTEGER NOT NULL
    );

    -- 3. Viewer Groups & ACL Definitions (PUB-04)
    CREATE TABLE IF NOT EXISTS viewer_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      allowed_folders_json TEXT NOT NULL,    -- JSON string[]
      allowed_extensions_json TEXT NOT NULL, -- JSON string[]
      exclude_globs_json TEXT NOT NULL,      -- JSON string[]
      max_file_size_bytes INTEGER NOT NULL DEFAULT 2097152
    );

    -- 4. Viewer-to-Group Memberships (PUB-06)
    CREATE TABLE IF NOT EXISTS user_group_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
      invited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, project_id, group_id)
    );

    -- 5. Passwordless Auth Challenges (Magic Link + 6-digit OTP)
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      token_hash TEXT NOT NULL UNIQUE,
      otp_hash TEXT NOT NULL,
      purpose TEXT NOT NULL, -- 'INVITE_PUBLISHER' | 'INVITE_VIEWER' | 'LOGIN'
      project_id TEXT,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER,
      token_consumed_at INTEGER,
      otp_consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_email ON auth_challenges(email);

    -- 6. Document Chunks & Vector Index
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_proj_path ON doc_chunks(project_id, file_path);

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[768]
    );

    -- 7. Sync History, Telemetry, and Viewer Quotas
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL, -- 'MANUAL' | 'WEBHOOK' | 'SCHEDULED'
      old_sha TEXT,
      new_sha TEXT,
      total_files INTEGER NOT NULL DEFAULT 0,
      indexed_files INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,       -- 'SUCCESS' | 'ERROR'
      error_message TEXT,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS viewer_daily_usage (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL, -- YYYY-MM-DD
      query_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, user_id, usage_date)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_delivery_logs (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL, -- 'SENT' | 'FAILED'
      error_message TEXT,
      created_at INTEGER NOT NULL
    );

    -- 8. Persistent RAG Directory Tree Snapshots (Incremental Diff Sync)
    CREATE TABLE IF NOT EXISTS rag_file_snapshots (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      blob_sha TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      last_indexed_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_rag_snapshots_proj ON rag_file_snapshots(project_id);
  `);

  // Safe migrations for backwards-compatible schema evolutions
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE sync_logs ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN is_local_repo INTEGER NOT NULL DEFAULT 0;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN local_source_path TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN additional_copy_path TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN copy_mode TEXT NOT NULL DEFAULT 'WORKING_TREE';`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN auto_copy_on_sync INTEGER NOT NULL DEFAULT 1;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN last_copied_at INTEGER;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN last_copy_status TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN last_copy_error TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE auth_challenges ADD COLUMN token_consumed_at INTEGER;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE auth_challenges ADD COLUMN otp_consumed_at INTEGER;`);
  } catch {}
}
