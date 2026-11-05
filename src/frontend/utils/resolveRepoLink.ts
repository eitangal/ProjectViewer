import { useViewerStore } from '../store/useViewerStore.js';

export interface ResolvedLink {
  type: 'external' | 'anchor-only' | 'internal-repo';
  targetPath?: string;
  hash?: string;
  rawHref: string;
}

export function resolveRepoLink(currentFilePath: string, rawHref: string): ResolvedLink {
  if (!rawHref) {
    return { type: 'anchor-only', rawHref };
  }

  // 1. External protocols (http, https, mailto, tel)
  if (/^(https?:|mailto:|tel:)/i.test(rawHref)) {
    return { type: 'external', rawHref };
  }

  // 2. Same-document anchor (#section-name)
  if (rawHref.startsWith('#')) {
    return { type: 'anchor-only', hash: rawHref.slice(1), rawHref };
  }

  // 3. Relative or root-relative repository path
  const [pathPart, hashPart] = rawHref.split('#');
  const currentDirSegments = currentFilePath.split('/').slice(0, -1);

  const inputSegments = pathPart.startsWith('/')
    ? pathPart.slice(1).split('/')
    : [...currentDirSegments, ...pathPart.split('/')];

  const resolvedStack: string[] = [];
  for (const segment of inputSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      resolvedStack.pop();
    } else {
      resolvedStack.push(segment);
    }
  }

  let targetPath = resolvedStack.join('/');

  // If link was written relative to repository root (without leading slash), e.g. 'docs/pmo/project_phases.png'
  // inside 'docs/pmo/projectplan.md', candidateFromCurrentDir would be 'docs/pmo/docs/pmo/project_phases.png'.
  // If candidateFromRoot is in authorizedPaths, prefer candidateFromRoot.
  const rootCandidate = pathPart.replace(/^\/+/, '');
  try {
    const authorizedPaths = useViewerStore.getState().authorizedPaths || [];
    if (authorizedPaths.length > 0) {
      if (!authorizedPaths.includes(targetPath) && authorizedPaths.includes(rootCandidate)) {
        targetPath = rootCandidate;
      }
    }
  } catch {
    // Keep targetPath in environments without store initialization
  }

  return {
    type: 'internal-repo',
    targetPath,
    hash: hashPart || undefined,
    rawHref,
  };
}
