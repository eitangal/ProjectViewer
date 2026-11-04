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

  return {
    type: 'internal-repo',
    targetPath: resolvedStack.join('/'),
    hash: hashPart || undefined,
    rawHref,
  };
}
