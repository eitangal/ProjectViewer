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
  createdAt: number;
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
