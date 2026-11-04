import picomatch from 'picomatch';
import path from 'node:path';
import { GroupAclRule, RepoFileEntry, FileTreeNode } from '@/shared/types.js';

export class CompiledGroupMatcher {
  private readonly folderPrefixes: string[];
  private readonly allowAllFolders: boolean;
  private readonly extSet: Set<string>;
  private readonly isExcluded: (testPath: string) => boolean;
  private readonly maxBytes: number;

  constructor(rule: GroupAclRule) {
    this.allowAllFolders =
      rule.allowedFolders.includes('*') ||
      rule.allowedFolders.includes('/') ||
      rule.allowedFolders.length === 0;

    this.folderPrefixes = rule.allowedFolders
      .map((f) => f.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);

    this.extSet = new Set(
      rule.allowedExtensions.map((ext) =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
      )
    );

    this.isExcluded =
      rule.excludeGlobs.length > 0
        ? (picomatch(rule.excludeGlobs, { dot: true, nocase: true }) as (str: string) => boolean)
        : () => false;

    this.maxBytes = rule.maxFileSizeBytes || 2 * 1024 * 1024;
  }

  public matches(file: RepoFileEntry): { matches: boolean; reason: string } {
    if (file.sizeBytes > this.maxBytes) {
      return { matches: false, reason: `Exceeds max file size (${file.sizeBytes} > ${this.maxBytes})` };
    }

    // 1. Explicit exclusion globs always win
    if (this.isExcluded(file.filePath)) {
      return { matches: false, reason: 'Matched exclude glob' };
    }

    // 2. Extension check
    const ext = path.posix.extname(file.filePath).toLowerCase();
    if (this.extSet.size > 0 && !this.extSet.has(ext)) {
      return { matches: false, reason: 'Extension not allowed' };
    }

    // 3. Allowed folder prefix check
    if (this.allowAllFolders) {
      return { matches: true, reason: 'Allowed' };
    }

    const inFolder = this.folderPrefixes.some(
      (prefix) => file.filePath === prefix || file.filePath.startsWith(`${prefix}/`)
    );

    if (inFolder) {
      return { matches: true, reason: 'Allowed folder' };
    }

    return { matches: false, reason: 'Outside allowed folders' };
  }
}

/**
 * Evaluates the union of permissions across all Viewer Groups assigned to a user
 * and returns the exact sorted list of authorized relative file paths.
 */
export function resolveAuthorizedFiles(
  allRepoFiles: RepoFileEntry[],
  userGroupRules: GroupAclRule[]
): string[] {
  if (userGroupRules.length === 0) return [];
  const compiledMatchers = userGroupRules.map((rule) => new CompiledGroupMatcher(rule));

  return allRepoFiles
    .filter((file) => compiledMatchers.some((matcher) => matcher.matches(file).matches))
    .map((file) => file.filePath)
    .sort();
}

/**
 * Builds a hierarchical file tree with empty folders automatically pruned.
 */
export function buildPrunedFileTree(authorizedFiles: RepoFileEntry[]): FileTreeNode[] {
  const rootNodes: Map<string, FileTreeNode> = new Map();

  for (const file of authorizedFiles) {
    const parts = file.filePath.split('/').filter(Boolean);
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const prevPath = currentPath;
      currentPath = prevPath ? `${prevPath}/${part}` : part;

      if (i === 0) {
        if (!rootNodes.has(part)) {
          rootNodes.set(part, {
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
            sizeBytes: isFile ? file.sizeBytes : undefined,
            children: isFile ? undefined : [],
          });
        }
      } else {
        // Find parent in tree
        const parent = findNode(Array.from(rootNodes.values()), prevPath);
        if (parent && parent.children) {
          let child = parent.children.find((c) => c.name === part);
          if (!child) {
            child = {
              name: part,
              path: currentPath,
              type: isFile ? 'file' : 'directory',
              sizeBytes: isFile ? file.sizeBytes : undefined,
              children: isFile ? undefined : [],
            };
            parent.children.push(child);
          }
        }
      }
    }
  }

  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
    return nodes;
  }

  return sortNodes(Array.from(rootNodes.values()));
}

function findNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}
