import React from 'react';
import { useViewerStore } from '../../store/useViewerStore.js';
import { resolveRepoLink } from '../../utils/resolveRepoLink.js';

export const SmartMarkdownLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
  href = '',
  children,
  ...props
}) => {
  const { activeFilePath, navigateToFile } = useViewerStore();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href) return;
    const current = activeFilePath || '';
    const resolved = resolveRepoLink(current, href);

    if (resolved.type === 'external') {
      return; // Default browser new-tab behavior
    }

    e.preventDefault();

    if (resolved.type === 'anchor-only' && resolved.hash) {
      const el = document.getElementById(resolved.hash);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    if (resolved.type === 'internal-repo' && resolved.targetPath) {
      if (resolved.targetPath === current && resolved.hash) {
        const el = document.getElementById(resolved.hash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }
      navigateToFile(resolved.targetPath, resolved.hash);
    }
  };

  const isUnsafeScheme = /^\s*(javascript|vbscript|data|file):/i.test(href);
  const isExternal = /^(https?:|mailto:|tel:)/i.test(href);

  return (
    <a
      href={isUnsafeScheme ? '#' : href}
      onClick={handleClick}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className="text-indigo-400 hover:text-indigo-300 underline underline-offset-4 cursor-pointer transition-colors"
      {...props}
    >
      {children}
    </a>
  );
};
