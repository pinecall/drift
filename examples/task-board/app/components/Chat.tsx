import { useState, useRef, useEffect, useCallback } from 'react'
import { User, Send, Square, Trash2, Loader2, CheckCircle2, Brain, ChevronDown, ChevronRight, Zap, ClipboardList, Search, Bot } from 'lucide-react'
import { useChat, type ChatMessage, type MessagePart } from 'drift/react'
import { T, getAgentStyle, AGENT_COLORS } from '../lib/theme'
import { StreamingMarkdown } from './StreamingMarkdown'

// ── Agent icon mapping ──
const AGENT_ICONS: Record<string, React.ReactNode> = {
    'Zap': <Zap size={13} />,
    'ClipboardList': <ClipboardList size={13} />,
    'Search': <Search size={13} />,
    'Bot': <Bot size={13} />,
}

function agentIcon(name: string, size = 13) {
    const style = getAgentStyle(name)
    return AGENT_ICONS[style.lucideIcon] || <Bot size={size} />
}

// ── Agent Tabs ──
const AGENTS = Object.entries(AGENT_COLORS).map(([name, cfg]) => ({ name, ...cfg }))

function AgentTabs({ selected, onSelect }: { selected: string; onSelect: (name: string) => void }) {
    return (
        <div className="flex gap-1.5">
            {AGENTS.map(a => {
                const active = a.name === selected
                const IconEl = AGENT_ICONS[a.lucideIcon] || <Bot size={13} />
                return (
                    <button key={a.name} onClick={() => onSelect(a.name)}
                        className="flex items-center gap-2 rounded-lg text-[11px] transition-all cursor-pointer"
                        style={{
                            padding: '7px 14px',
                            background: active ? a.color + '15' : 'transparent',
                            color: active ? a.color : T.t4,
                            border: active ? `1px solid ${a.color}30` : '1px solid transparent',
                            fontWeight: active ? 500 : 400,
                        }}>
                        <span style={{ color: active ? a.color : T.t4, display: 'flex' }}>{IconEl}</span>
                        <span>{a.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

// ── Thinking Block ──
function ThinkingBlock({ isActive, text }: { isActive: boolean; text: string }) {
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="my-1.5">
            <button onClick={() => text && setExpanded(!expanded)}
                className={`flex items-center gap-2 py-2 px-3.5 rounded-lg transition-all text-[11px] ${text ? 'cursor-pointer' : 'cursor-default'}`}
                style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                {isActive ? (
                    <>
                        <Brain size={12} style={{ color: T.purple }} className="animate-pulse" />
                        <span style={{ color: T.purple }}>Thinking</span>
                        <span className="flex gap-0.5">
                            {[0, 150, 300].map(d => (
                                <span key={d} className="w-1 h-1 rounded-full animate-bounce" style={{ background: T.purple, animationDelay: `${d}ms` }} />
                            ))}
                        </span>
                    </>
                ) : (
                    <>
                        {expanded ? <ChevronDown size={11} style={{ color: T.t3 }} /> : <ChevronRight size={11} style={{ color: T.t3 }} />}
                        <span style={{ color: T.t3 }}>Thought</span>
                    </>
                )}
            </button>
            {expanded && text && (
                <div className="mt-2 ml-4 pl-3 text-[11px] leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap"
                    style={{ borderLeft: `2px solid ${T.purple}20`, color: T.t3, fontStyle: 'italic' }}>
                    {text}
                </div>
            )}
        </div>
    )
}

// ── Tool Chip ──
const TOOL_COLORS: Record<string, string> = {
    create_task: T.green, move_task: T.amber, update_task: T.accent,
    delete_task: T.red, plan_project: T.cyan, suggest_priorities: T.cyan,
    review_task: T.pink, summarize_sprint: T.pink,
}

function ToolChip({ part }: { part: MessagePart }) {
    const isRunning = part.status === 'executing'
    const color = TOOL_COLORS[part.name || ''] || T.t3
    const duration = part.ms ? (part.ms < 1000 ? `${part.ms}ms` : `${(part.ms / 1000).toFixed(1)}s`) : null

    return (
        <div className="inline-flex items-center gap-2 rounded-lg text-[11px]"
            style={{ background: isRunning ? color + '08' : T.surface, border: `1px solid ${isRunning ? color + '30' : T.border}`, padding: '6px 12px' }}>
            {isRunning
                ? <Loader2 size={11} style={{ color }} className="animate-spin shrink-0" />
                : <CheckCircle2 size={11} style={{ color }} className="shrink-0" />}
            <span style={{ color: T.t3, fontWeight: 500 }}>{(part.name || '').replace(/_/g, ' ')}</span>
            {duration && <span style={{ color: T.t4, fontSize: 10 }}>{duration}</span>}
        </div>
    )
}

// ── Message ──
function Message({ msg, agentName }: { msg: ChatMessage; agentName: string }) {
    const isUser = msg.role === 'user'
    const agentStyle = getAgentStyle(agentName)
    const color = isUser ? T.purple : agentStyle.color
    const isLive = msg.status === 'streaming' || msg.status === 'tool'

    return (
        <div className="flex gap-3.5">
            <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: color + '12' }}>
                {isUser ? <User size={13} style={{ color }} /> : <span style={{ color, display: 'flex' }}>{agentIcon(agentName)}</span>}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-medium" style={{ color }}>{isUser ? 'you' : agentStyle.label}</span>
                    {isLive && <Loader2 size={10} style={{ color: T.amber }} className="animate-spin" />}
                </div>
                <div className="flex flex-col gap-2">
                    {msg.parts && msg.parts.length > 0 ? (
                        msg.parts.map((part: MessagePart, i: number) => {
                            const isLastPart = i === (msg.parts?.length || 0) - 1
                            if (part.type === 'text' && part.content) {
                                return <StreamingMarkdown key={i} content={part.content} isStreaming={isLive && isLastPart} />
                            }
                            if (part.type === 'thinking') {
                                return <ThinkingBlock key={i} isActive={!!part.active} text={part.content || ''} />
                            }
                            if (part.type === 'tool') {
                                return <div key={i} className="flex flex-wrap gap-2"><ToolChip part={part} /></div>
                            }
                            return null
                        })
                    ) : msg.content ? (
                        <StreamingMarkdown content={msg.content} isStreaming={false} />
                    ) : isLive ? (
                        <span className="inline-block w-1.5 h-4 animate-pulse rounded-sm" style={{ background: color }} />
                    ) : null}
                </div>
            </div>
        </div>
    )
}

// ── Main Chat ──
export function Chat({ sessionId }: { sessionId: string }) {
    const [selectedAgent, setSelectedAgent] = useState('task-agent')
    // Each agent gets its own session so the server creates separate Session objects
    const agentSessionId = `${sessionId}:${selectedAgent}`
    const { messages, send, abort, clear, isStreaming, lastError, activeAgent } = useChat(selectedAgent, { sessionId: agentSessionId })
    const [input, setInput] = useState('')
    const bottomRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const isAtBottomRef = useRef(true)
    const agentStyle = getAgentStyle(activeAgent || selectedAgent)

    useEffect(() => {
        if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }, [messages])

    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }, [input])

    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }, [])

    const handleSubmit = useCallback(() => {
        if (!input.trim() || isStreaming) return
        send(input.trim())
        setInput('')
        isAtBottomRef.current = true
    }, [input, isStreaming, send])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
    }, [handleSubmit])

    return (
        <div style={{ width: '420px', minWidth: '380px', display: 'flex', flexDirection: 'column', background: T.bg, borderRight: `1px solid ${T.border}` }}>
            {/* Header */}
            <div className="flex items-center shrink-0"
                style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '0 20px', height: '48px', gap: '12px' }}>
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: agentStyle.color + '12' }}>
                    <span style={{ color: agentStyle.color, display: 'flex' }}>{agentIcon(activeAgent || selectedAgent, 14)}</span>
                </div>
                <span className="text-[13px] font-medium" style={{ color: agentStyle.color }}>@{activeAgent || selectedAgent}</span>
                <div className="flex items-center gap-1.5">
                    {isStreaming
                        ? <Loader2 size={10} style={{ color: T.amber }} className="animate-spin" />
                        : <span className="w-2 h-2 rounded-full" style={{ background: T.green, boxShadow: `0 0 5px ${T.green}` }} />}
                </div>
                <div className="flex-1" />
                <button onClick={clear} className="p-1.5 rounded-md cursor-pointer" style={{ color: T.t4 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.red}
                    onMouseLeave={e => e.currentTarget.style.color = T.t4}>
                    <Trash2 size={14} />
                </button>
            </div>

            {/* Agent Selector */}
            <div className="shrink-0" style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '6px 12px' }}>
                <AgentTabs selected={selectedAgent} onSelect={setSelectedAgent} />
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto"
                style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {messages.length === 0 && !isStreaming && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span style={{ color: agentStyle.color, display: 'flex' }}>{agentIcon(selectedAgent, 28)}</span>
                        <div style={{ fontSize: '14px', color: T.t2 }}>{agentStyle.label}</div>
                        <div style={{ fontSize: '12px', color: T.t4, textAlign: 'center', maxWidth: '280px', lineHeight: '1.6' }}>
                            {selectedAgent === 'task-agent' && 'Create, move, update, and delete tasks. Try: "Plan a landing page project"'}
                            {selectedAgent === 'planner' && 'Break down goals into structured tasks. Try: "Plan an authentication system"'}
                            {selectedAgent === 'reviewer' && 'Review completed tasks and generate sprint summaries. Try: "Review all done tasks"'}
                        </div>
                    </div>
                )}

                {messages.map((msg: ChatMessage, i: number) => <Message key={i} msg={msg} agentName={activeAgent || selectedAgent} />)}

                {lastError && (
                    <div className="text-[12px] rounded-lg px-4 py-3"
                        style={{ background: T.red + '08', color: T.red, border: `1px solid ${T.red}20` }}>
                        {lastError}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '16px 20px', borderTop: `1px solid ${T.border}` }}>
                <div style={{ borderRadius: '14px', overflow: 'hidden', background: T.surface, border: `1px solid ${T.border}` }}>
                    <textarea ref={textareaRef} rows={1} value={input} autoFocus
                        onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                        placeholder={isStreaming ? 'Processing...' : `Ask ${agentStyle.label}...`}
                        style={{ width: '100%', background: 'transparent', fontSize: '13px', padding: '14px 18px 6px', outline: 'none', resize: 'none', overflowY: 'auto', maxHeight: '120px', color: T.t1, border: 'none', fontFamily: 'inherit' }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 14px 10px' }}>
                        {isStreaming ? (
                            <button onClick={abort} className="p-1.5 rounded-md cursor-pointer" style={{ color: T.red }}>
                                <Square size={16} />
                            </button>
                        ) : (
                            <button onClick={handleSubmit} disabled={!input.trim()}
                                className="p-1.5 rounded-md cursor-pointer disabled:cursor-default"
                                style={{ color: input.trim() ? T.t3 : T.t4 }}>
                                <Send size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
