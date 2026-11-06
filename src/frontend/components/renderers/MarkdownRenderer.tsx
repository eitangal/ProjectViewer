import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { SmartMarkdownLink } from './SmartMarkdownLink.js';
import { MermaidBlock } from './MermaidBlock.js';
import { useViewerStore } from '../../store/useViewerStore.js';
import { resolveRepoLink } from '../../utils/resolveRepoLink.js';

// Relax sanitize schema to permit custom classes, ids for anchors, and SVG/Mermaid containers
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'dir', 'id'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
  },
};

const slugifyHeading = (children: React.ReactNode, id?: string): string => {
  if (id) return id;
  const text = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
};

export const MarkdownRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  const { direction, activeFilePath, projectId } = useViewerStore();

  return (
    <div
      dir={direction}
      className={`markdown-body w-full max-w-none ${direction === 'rtl' ? 'text-right' : 'text-left'}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a: SmartMarkdownLink as any,
          h1({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h1 id={headingId} {...props}>{children}</h1>;
          },
          h2({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h2 id={headingId} {...props}>{children}</h2>;
          },
          h3({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h3 id={headingId} {...props}>{children}</h3>;
          },
          h4({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h4 id={headingId} {...props}>{children}</h4>;
          },
          h5({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h5 id={headingId} {...props}>{children}</h5>;
          },
          h6({ id, children, ...props }: any) {
            const headingId = slugifyHeading(children, id);
            return <h6 id={headingId} {...props}>{children}</h6>;
          },
          img({ src = '', alt, ...props }: any) {
            let resolvedSrc = src;
            if (src && !/^(https?:|data:|blob:)/i.test(src) && projectId) {
              const resolved = resolveRepoLink(activeFilePath || '', src);
              if (resolved.targetPath) {
                resolvedSrc = `/api/viewer/${projectId}/raw/${encodeURI(resolved.targetPath)}`;
              }
            }

            return (
              <figure className="my-6 flex flex-col items-center">
                <img
                  src={resolvedSrc}
                  alt={alt || ''}
                  className="max-w-full h-auto rounded-xl border border-slate-800 shadow-xl bg-slate-900/50"
                  loading="lazy"
                  {...props}
                />
                {alt && (
                  <figcaption className="mt-2 text-xs text-slate-400 italic text-center">
                    {alt}
                  </figcaption>
                )}
              </figure>
            );
          },
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            if (language === 'mermaid') {
              return <MermaidBlock chart={codeString} />;
            }

            const isInline = !match && !codeString.includes('\n');
            if (isInline) {
              return (
                <code
                  dir="ltr"
                  className="px-1.5 py-0.5 rounded font-mono text-[13px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre
                dir="ltr"
                className="my-4 p-4 rounded-xl font-mono text-xs overflow-x-auto text-left"
              >
                <code dir="ltr" className={className} {...props}>
                  {codeString}
                </code>
              </pre>
            );
          },
          table({ children }) {
            return (
              <div className="my-6 overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full border-collapse text-start text-sm">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-b border-slate-800 px-4 py-2.5 font-semibold text-start">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-b border-slate-800/60 px-4 py-2.5 text-start">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-s-4 border-indigo-500 my-4 text-start italic">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
};
