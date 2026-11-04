import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { SmartMarkdownLink } from './SmartMarkdownLink.js';
import { MermaidBlock } from './MermaidBlock.js';
import { useViewerStore } from '../../store/useViewerStore.js';

// Relax sanitize schema to permit custom classes, ids for anchors, and SVG/Mermaid containers
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'dir', 'id'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
  },
};

export const MarkdownRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  const { theme } = useViewerStore();
  return (
    <div className={`prose ${theme === 'dark' ? 'prose-invert text-slate-200' : 'text-slate-800'} prose-indigo max-w-none`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          a: SmartMarkdownLink as any,
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
                  className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono text-[13px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre
                dir="ltr"
                className="my-4 p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 font-mono text-xs overflow-x-auto text-left"
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
                <table className="w-full border-collapse text-left text-sm text-slate-300">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-b border-slate-800 bg-slate-900/80 px-4 py-2.5 font-semibold text-slate-200">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-b border-slate-800/60 px-4 py-2.5">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-s-4 border-indigo-500 bg-indigo-950/20 px-4 py-2 rounded-e-xl my-4 text-slate-300 italic">
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
