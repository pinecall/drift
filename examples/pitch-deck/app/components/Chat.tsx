import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat, useStreamBuffer, useMarkdown, parseMarkdown } from 'drift/react'
import type { ChatMessage } from 'drift/react'
import { Send, Plus, Sparkles, Loader2, CheckCircle2, Square } from 'lucide-react'

export function Chat({ sessionId, onNewSession }: { sessionId: string; onNewSession: () => void }) {
    const { messages: raw, send, abort, clear, isStreaming, lastError } = useChat('planner-agent', { sessionId })
    const messages = useStreamBuffer(raw, { charsPerFrame: 3 })
    const [input, setInput] = useState('')
    const bottomRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleSend = useCallback(() => {
        if (!input.trim() || isStreaming) return
        send(input.trim())
        setInput('')
    }, [input, isStreaming, send])

    return (
        <div style={{
            width: '400px',
            minWidth: '400px',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #1a1a2e',
            background: '#0d0d14',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid #1a1a2e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={18} color="#8b5cf6" />
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>Pitch Planner</span>
                    {isStreaming && <Loader2 size={12} color="#f59e0b" style={{ animation: 'spin 1s linear infinite' }} />}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={clear} title="Clear chat" style={{
                        background: '#1a1a2e', border: 'none', color: '#777', padding: '6px',
                        borderRadius: '6px', cursor: 'pointer', display: 'flex',
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                    <button onClick={onNewSession} title="New session" style={{
                        background: '#1a1a2e', border: 'none', color: '#777', padding: '6px',
                        borderRadius: '6px', cursor: 'pointer', display: 'flex',
                    }}>
                        <Plus size={14} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {messages.length === 0 && !isStreaming && (
                    <div style={{ color: '#555', textAlign: 'center', marginTop: '40px', fontSize: '14px', lineHeight: 1.6 }}>
                        <p style={{ fontSize: '28px', marginBottom: '12px' }}>📊</p>
                        <p style={{ marginBottom: '4px', color: '#888' }}>Tell me your business idea</p>
                        <p style={{ color: '#555', fontSize: '12px' }}>I'll create a pitch deck with 4 agents working in parallel</p>
                        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                'Pitch deck for an AI tutoring app',
                                'Pitch deck for PawRide — Uber for dogs',
                                'Pitch for a sustainable coffee brand',
                            ].map((example, i) => (
                                <button key={i} onClick={() => send(example)} style={{
                                    background: '#1a1a2e', border: '1px solid #252540', borderRadius: '8px',
                                    padding: '10px 14px', color: '#aaa', cursor: 'pointer', fontSize: '13px', textAlign: 'left',
                                    transition: 'all 0.2s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#8b5cf6'; e.currentTarget.style.color = '#ddd'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#252540'; e.currentTarget.style.color = '#aaa'; }}
                                >
                                    {example}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg: ChatMessage, i: number) => (
                    <MessageBubble key={i} message={msg} isLive={isStreaming && i === messages.length - 1} />
                ))}

                {lastError && (
                    <div style={{ fontSize: '12px', padding: '8px 12px', background: '#1a0808', border: '1px solid #3a1010', borderRadius: '8px', color: '#f87171' }}>
                        {lastError}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1a2e' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder={isStreaming ? 'Working...' : 'Describe your business idea...'}
                        disabled={isStreaming}
                        style={{
                            flex: 1, background: '#1a1a2e', border: '1px solid #252540', borderRadius: '8px',
                            padding: '10px 14px', color: '#e0e0e8', fontSize: '14px', outline: 'none',
                        }}
                    />
                    {isStreaming ? (
                        <button onClick={abort} style={{
                            background: '#3a1010', border: 'none', borderRadius: '8px', padding: '10px 12px',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#f87171',
                        }}>
                            <Square size={16} />
                        </button>
                    ) : (
                        <button onClick={handleSend} disabled={!input.trim()} style={{
                            background: input.trim() ? '#8b5cf6' : '#333', border: 'none', borderRadius: '8px',
                            padding: '10px 12px', cursor: input.trim() ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', color: 'white',
                        }}>
                            <Send size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Tool Colors ──
const TOOL_COLORS: Record<string, string> = {
    create_slide: '#8b5cf6',
    save_research: '#3b82f6',
    save_content: '#f59e0b',
    finalize_slide: '#10b981',
    plan_deck: '#8b5cf6',
}

function MessageBubble({ message, isLive }: { message: ChatMessage; isLive: boolean }) {
    const isUser = message.role === 'user'

    if (isUser) {
        const text = message.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.content || p.text).join('') || message.content || ''
        if (!text) return null
        return (
            <div style={{
                alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 14px', borderRadius: '12px',
                background: '#8b5cf6', color: 'white', fontSize: '14px', lineHeight: 1.5,
            }}>
                {text}
            </div>
        )
    }

    // Assistant message — render each part
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {message.parts && message.parts.length > 0 ? (
                message.parts.map((part: any, i: number) => {
                    if (part.type === 'text' && (part.content || part.text)) {
                        return <MarkdownTextPart key={i} text={part.content || part.text} isLive={isLive && i === (message.parts?.length || 0) - 1} />
                    }
                    if (part.type === 'tool') {
                        const color = TOOL_COLORS[part.name || ''] || '#888'
                        const isRunning = part.status === 'executing'
                        const duration = part.ms ? (part.ms < 1000 ? `${part.ms}ms` : `${(part.ms / 1000).toFixed(1)}s`) : null
                        return (
                            <div key={i} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '6px 12px', borderRadius: '8px', fontSize: '12px',
                                background: isRunning ? `${color}10` : '#111118',
                                border: `1px solid ${isRunning ? color + '30' : '#1e1e2e'}`,
                            }}>
                                {isRunning
                                    ? <Loader2 size={12} style={{ color, animation: 'spin 1s linear infinite' }} />
                                    : <CheckCircle2 size={12} style={{ color }} />}
                                <span style={{ color: '#aaa', fontWeight: 500 }}>{(part.name || '').replace(/_/g, ' ')}</span>
                                {duration && <span style={{ color: '#555', fontSize: '10px' }}>{duration}</span>}
                            </div>
                        )
                    }
                    if (part.type === 'thinking') {
                        return (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '6px 12px', fontSize: '11px', color: '#8b5cf6',
                            }}>
                                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                <span>{part.active ? 'Thinking...' : 'Thought'}</span>
                            </div>
                        )
                    }
                    return null
                })
            ) : isLive ? (
                <span style={{
                    display: 'inline-block', width: '6px', height: '16px',
                    background: '#8b5cf6', borderRadius: '2px', animation: 'pulse 1s infinite',
                }} />
            ) : null}
        </div>
    )
}

/** Renders a text part using useMarkdown with streaming animation */
function MarkdownTextPart({ text, isLive }: { text: string; isLive: boolean }) {
    const { html } = useMarkdown(text, { streaming: isLive, charsPerFrame: 4 })

    return (
        <div
            className="drift-md"
            style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: '#1a1a2e',
                fontSize: '13px',
                lineHeight: 1.7,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    )
}
