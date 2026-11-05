export type GlobalRole = 'SYSADMIN' | 'PUBLISHER' | 'VIEWER';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED';

export interface GroupAclRule {
  groupId: string;
  name?: string;
  allowedFolders: string[];    // e.g., ["docs/arch", "specs"] or ["*"] for root
  allowedExtensions: string[]; // e.g., [".md", ".yaml", ".json", ".mmd"]
  excludeGlobs: string[];      // e.g., ["**/*.secret.*", "**/internal/**", "**/.env*"]
  maxFileSizeBytes: number;    // e.g., 2097152 (2 MB)
}

export interface RepoFileEntry {
  filePath: string; // POSIX relative path, e.g., "docs/arch/overview.md"
  sizeBytes: number;
}

export interface RepoFileEntryWithSha {
  filePath: string;
  blobSha: string;
  sizeBytes: number;
}

export interface FileDelta {
  status: 'A' | 'M' | 'D';
  filePath: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  children?: FileTreeNode[];
}

export interface UserSummary {
  id: string;
  email: string;
  globalRole: GlobalRole;
  status: UserStatus;
  maxRepos: number;
  maxDiskQuotaBytes: number;
  maxViewers: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  ownerId: string;
  userRole?: 'PUBLISHER' | 'VIEWER';
  repoUrl: string;
  branch: string;
  hasGithubPat: boolean;
  hasWebhookSecret: boolean;
  hasGeminiKey: boolean;
  geminiChatModel: string;
  geminiEmbeddingModel: string;
  systemPrompt: string;
  dailyViewerQueryLimit: number;
  syncIntervalMinutes: number;
  lastSyncedSha: string | null;
  lastSyncedAt: number | null;
  syncStatus: 'IDLE' | 'SYNCING' | 'ERROR';
  lastSyncError: string | null;
  diskUsageBytes: number;
  totalFiles: number;
  indexedFiles?: number;
  isLocalRepo?: boolean;
  localSourcePath?: string | null;
  additionalCopyPath?: string | null;
  copyMode?: 'WORKING_TREE' | 'FULL_REPO';
  autoCopyOnSync?: boolean;
  lastCopiedAt?: number | null;
  lastCopyStatus?: 'IDLE' | 'COPYING' | 'SUCCESS' | 'ERROR' | null;
  lastCopyError?: string | null;
  createdAt: number;
}

export interface RagFileSnapshot {
  projectId: string;
  filePath: string;
  blobSha: string;
  sizeBytes: number;
  chunkCount: number;
  lastIndexedAt: number;
}

export interface InspectLocalRepoRequest {
  path: string;
}

export interface InspectLocalRepoResponse {
  isValid: boolean;
  suggestedName: string;
  currentBranch: string;
  branches: string[];
  headCommitSha: string;
  commitMessage: string;
  totalFiles: number;
  isBare: boolean;
  error?: string;
}

export interface PublishLocalProjectRequest {
  name: string;
  localPath: string;
  branch?: string;
  additionalCopyPath?: string;
  copyMode?: 'WORKING_TREE' | 'FULL_REPO';
  autoCopyOnSync?: boolean;
  geminiApiKey?: string;
}

export interface CopyToLocationRequest {
  targetPath?: string;
  copyMode?: 'WORKING_TREE' | 'FULL_REPO';
}

export interface CopyToLocationResponse {
  ok: boolean;
  targetPath: string;
  filesCount: number;
  durationMs: number;
  error?: string;
}

export interface ViewerGroupSummary {
  id: string;
  projectId: string;
  name: string;
  allowedFolders: string[];
  allowedExtensions: string[];
  excludeGlobs: string[];
  maxFileSizeBytes: number;
  viewerCount?: number;
}

export interface ViewerMembershipSummary {
  userId: string;
  email: string;
  status: UserStatus;
  groupIds: string[];
  invitedAt: number;
}

export interface RagChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: { filePath: string; startLine?: number; endLine?: number }[];
}
