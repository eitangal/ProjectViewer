/**
 * Resolves the default file to view for a project:
 * Defaults to 'index.html' (or 'index.htm') if it exists in the authorized files
 * (giving priority to root index.html over nested ones), otherwise falls back to the
 * first file in view.
 */
export function resolveDefaultProjectFile(authorizedPaths: string[]): string | null {
  if (!authorizedPaths || authorizedPaths.length === 0) return null;

  // 1. Root index.html or index.htm (case-insensitive)
  const rootIndex = authorizedPaths.find((p) => {
    const clean = p.replace(/^\/+/, '').toLowerCase();
    return clean === 'index.html' || clean === 'index.htm';
  });
  if (rootIndex) return rootIndex;

  // 2. Any nested index.html or index.htm (e.g. public/index.html, docs/index.html)
  const nestedIndex = authorizedPaths.find((p) => {
    const clean = p.replace(/^\/+/, '').toLowerCase();
    return clean.endsWith('/index.html') || clean.endsWith('/index.htm');
  });
  if (nestedIndex) return nestedIndex;

  // 3. Fallback to the first file in view
  return authorizedPaths[0];
}
