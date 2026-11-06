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

  // Block dangerous URI schemes (javascript:, vbscript:, data:, file:)
  if (/^\s*(javascript|vbscript|data|file):/i.test(rawHref)) {
    return { type: 'anchor-only', rawHref: '' };
  }

  // 1. External protocols (mailto, tel)
  if (/^(mailto:|tel:)/i.test(rawHref)) {
    return { type: 'external', rawHref };
  }

  // 2. Same-document anchor (#section-name)
  if (rawHref.startsWith('#')) {
    return { type: 'anchor-only', hash: rawHref.slice(1), rawHref };
  }

  // 3. Full HTTP/HTTPS URLs
  if (/^https?:\/\//i.test(rawHref)) {
    try {
      const urlObj = new URL(rawHref);
      const isPortalRaw = /\/api\/viewer\/[^/]+\/raw\/(.*)/.test(urlObj.pathname);
      const hasPathQuery = urlObj.searchParams.has('path');

      // Check if this URL points to our portal's raw endpoint or viewer deep link
      if (isPortalRaw || hasPathQuery) {
        let extractedPath = '';
        if (isPortalRaw) {
          const match = urlObj.pathname.match(/\/api\/viewer\/[^/]+\/raw\/(.*)/);
          extractedPath = match ? match[1] : '';
        } else if (hasPathQuery) {
          extractedPath = urlObj.searchParams.get('path') || '';
        }

        try {
          extractedPath = decodeURIComponent(extractedPath);
        } catch {
          // keep as is
        }

        const hashPart = urlObj.hash ? urlObj.hash.slice(1) : undefined;
        return {
          type: 'internal-repo',
          targetPath: extractedPath.replace(/^\/+/, ''),
          hash: hashPart,
          rawHref,
        };
      }

      // External website
      return { type: 'external', rawHref };
    } catch {
      return { type: 'external', rawHref };
    }
  }

  // 4. Relative or root-relative repository path, or portal root raw/path links
  const [withoutHash, hashPart] = rawHref.split('#');
  const [pathAndQuery, queryPart] = withoutHash.split('?');

  let pathCandidate = pathAndQuery;

  // Check if query parameter contains ?path=...
  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    if (searchParams.has('path')) {
      pathCandidate = searchParams.get('path') || '';
    }
  }

  // Check if root-relative path points to /api/viewer/:projectId/raw/...
  const rawMatch = pathCandidate.match(/^\/?api\/viewer\/[^/]+\/raw\/(.*)/);
  if (rawMatch) {
    pathCandidate = rawMatch[1];
  }

  // URL-decode characters (e.g. %20 for spaces)
  try {
    pathCandidate = decodeURIComponent(pathCandidate);
  } catch {
    // keep as is
  }

  const currentDirSegments = currentFilePath ? currentFilePath.split('/').slice(0, -1) : [];

  const inputSegments = pathCandidate.startsWith('/')
    ? pathCandidate.slice(1).split('/')
    : [...currentDirSegments, ...pathCandidate.split('/')];

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
  const rootCandidate = pathCandidate.replace(/^\/+/, '');

  try {
    const authorizedPaths = useViewerStore.getState().authorizedPaths || [];
    if (authorizedPaths.length > 0) {
      if (authorizedPaths.includes(targetPath)) {
        // Keep targetPath
      } else if (authorizedPaths.includes(rootCandidate)) {
        targetPath = rootCandidate;
      } else {
        // Extensionless or index match (e.g. .md, .html, .yaml, .yml, .mmd, /index.html)
        const match = authorizedPaths.find(
          (p) =>
            p === `${targetPath}.md` ||
            p === `${targetPath}.html` ||
            p === `${targetPath}.yaml` ||
            p === `${targetPath}.yml` ||
            p === `${targetPath}.mmd` ||
            p === `${targetPath}/index.html` ||
            p.startsWith(`${targetPath}.`) ||
            p === `${rootCandidate}.md` ||
            p === `${rootCandidate}.html` ||
            p === `${rootCandidate}.yaml` ||
            p === `${rootCandidate}.yml` ||
            p === `${rootCandidate}.mmd` ||
            p === `${rootCandidate}/index.html` ||
            p.startsWith(`${rootCandidate}.`)
        );
        if (match) {
          targetPath = match;
        }
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
