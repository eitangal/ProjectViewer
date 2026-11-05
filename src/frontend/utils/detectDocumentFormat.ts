export type DocumentFormat = 'markdown' | 'openapi' | 'mermaid' | 'html' | 'code' | 'image';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];

export function detectDocumentFormat(filePath: string, content: string = ''): DocumentFormat {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  if (['md', 'mdx', 'markdown'].includes(ext)) return 'markdown';
  if (['mmd', 'mermaid'].includes(ext)) return 'mermaid';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';

  if (['yaml', 'yml', 'json'].includes(ext)) {
    // Fast regex check on first 1000 chars for OpenAPI / Swagger signature
    const headerSlice = content.slice(0, 1000);
    if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(headerSlice) || /"openapi"\s*:\s*"[23]\./.test(headerSlice)) {
      return 'openapi';
    }
  }

  return 'code';
}
