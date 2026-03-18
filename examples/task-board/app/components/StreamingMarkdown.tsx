import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { T } from '../lib/theme'

/**
 * StreamingMarkdown — shared markdown renderer for chat messages.
 * Used by both the main Chat panel and floating Thread panels.
 * Matches the style from ~/pinecode-v3/ui StreamingMarkdown.
 * 
 * Supports: code blocks (syntax highlighted), inline code, headings,
 * lists, blockquotes, links, tables, horizontal rules, and a
 * streaming cursor indicator.
 */

const CodeBlock = memo(function CodeBlock({ language, children }: { language?: string; children: React.ReactNode }) {
    return (
        <SyntaxHighlighter style={oneDark} language={language || 'text'} PreTag="div"
            customStyle={{ margin: '8px 0', borderRadius: '8px', fontSize: '12px', border: `1px solid ${T.border}`, background: T.surface }}>
            {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
    )
})

const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
    return <code style={{ background: T.surface, color: T.t1, padding: '2px 6px', borderRadius: '4px', fontSize: '12px', border: `1px solid ${T.border}` }}>{children}</code>
})

function createMarkdownComponents(compact: boolean = false) {
    const fontSize = compact ? '12px' : '13px'
    return {
        code({ className, children }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const text = String(children).replace(/\n$/, '')
            if (text.includes('\n') || match) {
                return <CodeBlock language={match?.[1]}>{children}</CodeBlock>
            }
            return <InlineCode>{children}</InlineCode>
        },
        p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }: any) => <li style={{ fontSize }}>{children}</li>,
        h1: ({ children }: any) => <h1 style={{ fontSize: '16px', fontWeight: 600, color: T.t1, marginBottom: '8px', marginTop: '12px' }}>{children}</h1>,
        h2: ({ children }: any) => <h2 style={{ fontSize: '15px', fontWeight: 600, color: T.t1, marginBottom: '8px', marginTop: '12px' }}>{children}</h2>,
        h3: ({ children }: any) => <h3 style={{ fontSize: '14px', fontWeight: 600, color: T.t1, marginBottom: '6px', marginTop: '8px' }}>{children}</h3>,
        blockquote: ({ children }: any) => <blockquote style={{ borderLeft: `2px solid ${T.border}`, paddingLeft: '12px', margin: '8px 0', color: T.t3 }}>{children}</blockquote>,
        a: ({ href, children }: any) => <a href={href} style={{ color: T.accent }} className="hover:underline" target="_blank" rel="noreferrer">{children}</a>,
        table: ({ children }: any) => <div className="overflow-x-auto my-2"><table style={{ fontSize: '12px', borderCollapse: 'collapse', border: `1px solid ${T.border}`, width: '100%' }}>{children}</table></div>,
        th: ({ children }: any) => <th style={{ border: `1px solid ${T.border}`, padding: '6px 12px', background: T.surface, textAlign: 'left' as const }}>{children}</th>,
        td: ({ children }: any) => <td style={{ border: `1px solid ${T.border}`, padding: '6px 12px' }}>{children}</td>,
        hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '12px 0' }} />,
    }
}

export const StreamingMarkdown = memo(function StreamingMarkdown({ content, isStreaming, compact = false }: {
    content: string
    isStreaming: boolean
    compact?: boolean
}) {
    const components = useMemo(() => createMarkdownComponents(compact), [compact])
    const fontSize = compact ? '12px' : '13px'

    return (
        <div className="leading-relaxed" style={{ color: T.t2, fontSize }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
            {isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 animate-pulse rounded-sm align-middle" style={{ background: T.accent }} />}
        </div>
    )
})

export default StreamingMarkdown
