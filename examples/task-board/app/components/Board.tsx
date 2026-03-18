import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useWindow, useChat, useThread, useWorkspace } from 'drift/react'
import { ArrowRight, Trash2, Circle, LayoutGrid, Wifi, WifiOff, Loader2, CheckCircle2, MessageCircle, X, Minus, Send, Maximize2 } from 'lucide-react'
import { useDriftContext } from 'drift/react'
import { T } from '../lib/theme'
import { StreamingMarkdown } from './StreamingMarkdown'

// ── Types matching the server TaskItem ──
interface TaskItem {
    id: string
    title: string
    description: string
    status: 'todo' | 'doing' | 'done'
    priority: 'low' | 'medium' | 'high'
    createdAt: number
}

interface Activity {
    source: 'user' | 'agent'
    agentName?: string
    action: string
    taskId?: string
    taskTitle?: string
    detail?: string
    at: number
}

interface BoardState {
    filter: 'all' | 'todo' | 'doing' | 'done'
    activity: Activity[]
}

// ── Constants ──
const STATUS_CONFIG = {
    todo: { label: 'Todo', color: T.t3, bg: T.t3 + '08', border: T.t3 + '20', dot: T.t3 },
    doing: { label: 'In Progress', color: T.amber, bg: T.amber + '08', border: T.amber + '20', dot: T.amber },
    done: { label: 'Done', color: T.green, bg: T.green + '08', border: T.green + '20', dot: T.green },
}

const PRIORITY_CONFIG = {
    high: { color: T.red, label: 'High' },
    medium: { color: T.amber, label: 'Medium' },
    low: { color: T.green, label: 'Low' },
}

const STATUS_CYCLE: Record<string, 'todo' | 'doing' | 'done'> = {
    todo: 'doing',
    doing: 'done',
    done: 'todo',
}

type NudgePhase = 'idle' | 'thinking' | 'streaming' | 'done'

// ── Floating Thread Chat ──
function ThreadPanel({ task, sessionId, onClose, index = 0 }: { task: TaskItem; sessionId: string; onClose: () => void; index?: number }) {
    const thread = useThread({
        agent: 'task-agent',
        threadId: `card:${task.id}`,
        parentSession: sessionId,
        context: `Task: "${task.title}" — ${task.description} (status: ${task.status}, priority: ${task.priority})`,
        system: 'You are helping the user understand and work on this specific task. Be concise and helpful.',
    })

    const [input, setInput] = useState('')
    const [isMaximized, setIsMaximized] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [thread.messages])

    const handleSend = () => {
        const text = input.trim()
        if (!text || thread.isStreaming) return
        thread.send(text)
        setInput('')
    }

    const rightOffset = 16 + index * 356

    // Minimized pill
    if (isMinimized) {
        return (
            <button
                onClick={() => setIsMinimized(false)}
                className="flex items-center gap-1.5 rounded-full cursor-pointer"
                style={{
                    position: 'fixed', bottom: '16px', right: `${rightOffset}px`,
                    background: T.accent, color: '#fff',
                    padding: '8px 14px', fontSize: '11px',
                    boxShadow: `0 4px 24px ${T.accent}40`,
                    zIndex: 100 + index,
                    maxWidth: '200px',
                }}>
                <MessageCircle size={12} />
                <span className="truncate">{task.title}</span>
                {thread.hasHistory && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#fff' }} />}
            </button>
        )
    }

    const panelWidth = isMaximized ? '420px' : '340px'
    const panelHeight = isMaximized ? '500px' : '380px'

    return (
        <div style={{
            position: 'fixed', bottom: '16px', right: `${rightOffset}px`,
            width: panelWidth, height: panelHeight,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: '16px',
            display: 'flex', flexDirection: 'column',
            boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 20px ${T.accent}08`,
            zIndex: 100 + index,
            transition: 'width 0.2s ease, height 0.2s ease, right 0.2s ease',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div className="flex items-center shrink-0" style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${T.border}`,
                background: T.surfaceAlt,
                borderRadius: '16px 16px 0 0',
                gap: '8px',
            }}>
                <MessageCircle size={13} style={{ color: T.accent }} />
                <span className="flex-1 text-[12px] truncate" style={{ color: T.t1 }}>
                    {task.title}
                </span>
                <span className="text-[10px]" style={{
                    color: T.accent, background: T.accent + '15',
                    padding: '1px 6px', borderRadius: '6px',
                }}>thread</span>
                <div className="flex items-center gap-0.5">
                    <button onClick={() => setIsMaximized(v => !v)}
                        className="p-1 rounded cursor-pointer"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.t2}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}>
                        <Maximize2 size={11} />
                    </button>
                    <button onClick={() => setIsMinimized(true)}
                        className="p-1 rounded cursor-pointer"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.t2}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}>
                        <Minus size={11} />
                    </button>
                    <button onClick={() => onClose()}
                        className="p-1 rounded cursor-pointer"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}>
                        <X size={11} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto" style={{ padding: '12px 14px' }}>
                {thread.messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center" style={{ gap: '8px' }}>
                        <MessageCircle size={24} style={{ color: T.t4 }} />
                        <span className="text-[11px]" style={{ color: T.t4 }}>
                            Ask anything about this task
                        </span>
                    </div>
                )}
                {thread.messages.map((msg, i) => (
                    <div key={i} style={{
                        marginBottom: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}>
                        <div style={{
                            maxWidth: '85%',
                            padding: '8px 12px',
                            borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                            background: msg.role === 'user' ? T.accent + '20' : T.surfaceAlt,
                            border: `1px solid ${msg.role === 'user' ? T.accent + '30' : T.border}`,
                            fontSize: '12px',
                            lineHeight: '1.5',
                            color: T.t1,
                        }}>
                            {msg.role === 'assistant' ? (
                                <div>
                                    {msg.parts?.map((part, j) => {
                                        if (part.type === 'text') {
                                            const isLastPart = j === (msg.parts?.length || 0) - 1
                                            return <StreamingMarkdown key={j} content={part.content || ''} isStreaming={msg.status === 'streaming' && isLastPart} compact />
                                        }
                                        if (part.type === 'thinking' && part.content) {
                                            return (
                                                <div key={j} className="text-[10px] italic" style={{ color: T.t4, marginBottom: '4px' }}>
                                                    💭 {part.content.slice(0, 120)}...
                                                </div>
                                            )
                                        }
                                        return null
                                    })}
                                </div>
                            ) : (
                                <span>{msg.content}</span>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0" style={{
                padding: '10px 12px',
                borderTop: `1px solid ${T.border}`,
                background: T.surfaceAlt,
                borderRadius: '0 0 16px 16px',
            }}>
                <div className="flex items-center" style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: '10px',
                    padding: '0 4px 0 12px',
                }}>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder="Ask about this task..."
                        className="flex-1 bg-transparent outline-none text-[12px]"
                        style={{ color: T.t1, padding: '8px 0', border: 'none' }}
                        disabled={thread.isStreaming}
                    />
                    <button onClick={handleSend}
                        className="p-1.5 rounded-md cursor-pointer"
                        style={{
                            color: input.trim() ? T.accent : T.t4,
                            opacity: thread.isStreaming ? 0.5 : 1,
                        }}
                        disabled={thread.isStreaming || !input.trim()}>
                        {thread.isStreaming ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Task Card ──
function TaskCard({ task, onMove, onDelete, onCyclePriority, onExplain, onThread, isSelected, nudgePhase }: {
    task: TaskItem
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
    onExplain: (task: TaskItem) => void
    onThread: (task: TaskItem) => void
    isSelected: boolean
    nudgePhase: NudgePhase
}) {
    const priority = PRIORITY_CONFIG[task.priority]
    const nextStatus = STATUS_CYCLE[task.status]
    const nextLabel = STATUS_CONFIG[nextStatus].label

    const age = Date.now() - task.createdAt
    const ageLabel = age < 3600000 ? `${Math.round(age / 60000)}m ago`
        : age < 86400000 ? `${Math.round(age / 3600000)}h ago`
        : `${Math.round(age / 86400000)}d ago`

    return (
        <div className="group rounded-xl"
            style={{
                background: T.surfaceAlt,
                border: `1px solid ${isSelected ? T.accent + '40' : T.border}`,
                borderLeft: isSelected ? `3px solid ${T.accent}` : undefined,
                padding: isSelected ? '16px 18px 16px 16px' : '14px 18px',
                transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
                if (!isSelected) e.currentTarget.style.borderColor = T.borderLit
            }}
            onMouseLeave={e => {
                if (!isSelected) e.currentTarget.style.borderColor = T.border
            }}>

            {/* Header: priority + hover actions */}
            <div className="flex items-center justify-between" style={{ marginBottom: '10px' }}>
                <button onClick={e => { e.stopPropagation(); onCyclePriority(task.id) }}
                    className="flex items-center gap-1.5 text-[10px] rounded-full cursor-pointer transition-opacity hover:opacity-80"
                    style={{
                        background: priority.color + '12',
                        color: priority.color,
                        border: `1px solid ${priority.color}18`,
                        padding: '3px 10px',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: priority.color }} />
                    {priority.label}
                </button>
                <div className="flex items-center gap-0.5" style={{ opacity: 0, transition: 'opacity 0.15s' }}
                    ref={el => {
                        if (el) {
                            const parent = el.closest('.group')
                            if (parent) {
                                parent.addEventListener('mouseenter', () => el.style.opacity = '1')
                                parent.addEventListener('mouseleave', () => el.style.opacity = '0')
                            }
                        }
                    }}>
                    {/* ✨ Explain — nudge with haiku */}
                    <button onClick={e => { e.stopPropagation(); onExplain(task) }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[13px] cursor-pointer transition-colors"
                        style={{ color: T.t4, marginRight: '4px' }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.purple; e.currentTarget.style.background = T.purple + '10' }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.t4; e.currentTarget.style.background = 'transparent' }}
                        title="Quick explanation">
                        ✨
                    </button>
                    {/* 💬 Thread */}
                    <button onClick={e => { e.stopPropagation(); onThread(task) }}
                        className="p-1 rounded-md cursor-pointer transition-colors"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.accent}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}
                        title="Open thread chat">
                        <MessageCircle size={11} />
                    </button>
                    {/* Separator */}
                    <span className="w-px h-3" style={{ background: T.border, margin: '0 2px' }} />
                    {/* → Move */}
                    <button onClick={e => { e.stopPropagation(); onMove(task.id, nextStatus) }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] cursor-pointer transition-colors"
                        style={{ color: T.t3, background: T.surface }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.accent; e.currentTarget.style.background = T.accent + '10' }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.t3; e.currentTarget.style.background = T.surface }}
                        title={`Move to ${nextLabel}`}>
                        <ArrowRight size={10} /> {nextLabel}
                    </button>
                    {/* 🗑 Delete */}
                    <button onClick={e => { e.stopPropagation(); onDelete(task.id) }}
                        className="p-1 rounded-md cursor-pointer transition-colors"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}
                        title="Delete task">
                        <Trash2 size={11} />
                    </button>
                </div>
            </div>

            {/* Title + nudge indicator */}
            <div className="flex items-center gap-2">
                <div className="text-[13px]" style={{ color: T.t1 }}>{task.title}</div>
                {nudgePhase === 'thinking' && (
                    <div className="flex gap-0.5 items-center">
                        {[0, 100, 200].map(d => (
                            <span key={d} className="w-1 h-1 rounded-full animate-bounce" style={{ background: T.amber, animationDelay: `${d}ms` }} />
                        ))}
                    </div>
                )}
                {nudgePhase === 'streaming' && (
                    <Loader2 size={11} style={{ color: T.accent }} className="animate-spin" />
                )}
                {nudgePhase === 'done' && (
                    <CheckCircle2 size={11} style={{ color: T.green }} />
                )}
            </div>

            {/* Description */}
            {task.description && (
                <div className="text-[11px] leading-relaxed" style={{
                    color: T.t3,
                    marginTop: '6px',
                    ...(isSelected
                        ? { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }
                        : {
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical' as const,
                            overflow: 'hidden',
                        }),
                }}>{task.description}</div>
            )}

            {/* Expanded details */}
            {isSelected && (
                <div className="flex flex-col gap-3" style={{ marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${T.border}` }}>
                    {/* Status + Priority tags */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] rounded-full" style={{
                            background: STATUS_CONFIG[task.status].bg,
                            color: STATUS_CONFIG[task.status].color,
                            border: `1px solid ${STATUS_CONFIG[task.status].border}`,
                            padding: '2px 10px',
                        }}>
                            {STATUS_CONFIG[task.status].label}
                        </span>
                        <span className="text-[10px] rounded-full" style={{
                            background: priority.color + '12',
                            color: priority.color,
                            border: `1px solid ${priority.color}18`,
                            padding: '2px 10px',
                        }}>
                            {priority.label} Priority
                        </span>
                    </div>
                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-[10px]" style={{ color: T.t4 }}>
                        <span>📅 Created {ageLabel}</span>
                        <span>🔗 <span className="font-mono">{task.id}</span></span>
                    </div>
                </div>
            )}

            {/* Collapsed footer */}
            {!isSelected && (
                <div className="flex items-center justify-between" style={{ marginTop: '8px' }}>
                    <div className="font-mono" style={{ fontSize: '9px', color: T.t4 }}>{task.id}</div>
                    <div className="text-[9px]" style={{ color: T.t4 }}>{ageLabel}</div>
                </div>
            )}
        </div>
    )
}

// ── Column ──
function Column({ status, tasks, onMove, onDelete, onCyclePriority, onExplain, onThread, selectedId, nudgePhase, onSelect }: {
    status: 'todo' | 'doing' | 'done'
    tasks: TaskItem[]
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
    onExplain: (task: TaskItem) => void
    onThread: (task: TaskItem) => void
    selectedId: string | null
    nudgePhase: NudgePhase
    onSelect: (id: string) => void
}) {
    const config = STATUS_CONFIG[status]

    return (
        <div className="flex-1 min-w-0 flex flex-col">
            {/* Column header */}
            <div className="flex items-center gap-2" style={{ marginBottom: '16px', padding: '0 4px' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: config.dot }} />
                <span className="text-[13px]" style={{ color: config.color }}>{config.label}</span>
                <span className="text-[11px] rounded-full" style={{ background: config.bg, color: config.color, padding: '1px 8px' }}>
                    {tasks.length}
                </span>
            </div>

            {/* Cards */}
            <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0" style={{ paddingBottom: '12px' }}>
                {tasks.length === 0 && (
                    <div className="flex items-center justify-center text-[12px] rounded-xl"
                        style={{ border: `1px dashed ${T.border}`, color: T.t4, padding: '32px 0' }}>
                        <Circle size={12} style={{ marginRight: '8px' }} /> No tasks
                    </div>
                )}
                {tasks.map(task => (
                    <div key={task.id} onClick={() => onSelect(task.id)} className="cursor-pointer">
                        <TaskCard task={task}
                            onMove={onMove} onDelete={onDelete} onCyclePriority={onCyclePriority}
                            onExplain={onExplain} onThread={onThread}
                            isSelected={selectedId === task.id}
                            nudgePhase={selectedId === task.id ? nudgePhase : 'idle'} />
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── Main Board ──
export function Board({ sessionId }: { sessionId: string }) {
    const { items, state, updateItem, removeItem, setState } = useWindow<TaskItem, BoardState>()
    const { nudge, isStreaming } = useChat('task-agent', { sessionId })
    const { connected } = useDriftContext()
    const { state: wsState } = useWorkspace()

    const tasks = items as TaskItem[]
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [nudgePhase, setNudgePhase] = useState<NudgePhase>('idle')
    const [nudgeTargetId, setNudgeTargetId] = useState<string | null>(null)
    const [threadTasks, setThreadTasks] = useState<TaskItem[]>([])
    const prevStreamingRef = useRef(false)

    // Track nudge phases based on isStreaming
    useEffect(() => {
        if (isStreaming && !prevStreamingRef.current && nudgeTargetId) {
            setNudgePhase('streaming')
        }
        if (!isStreaming && prevStreamingRef.current && nudgeTargetId) {
            setNudgePhase('done')
            setTimeout(() => {
                setNudgePhase('idle')
                setNudgeTargetId(null)
            }, 1500)
        }
        prevStreamingRef.current = isStreaming
    }, [isStreaming, nudgeTargetId])

    // Group tasks by status
    const grouped = useMemo(() => {
        const g = { todo: [] as TaskItem[], doing: [] as TaskItem[], done: [] as TaskItem[] }
        for (const t of tasks) {
            if (g[t.status]) g[t.status].push(t)
        }
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        for (const col of Object.values(g)) {
            col.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
        }
        return g
    }, [tasks])

    const logActivity = useCallback((action: string, taskId?: string, taskTitle?: string, detail?: string) => {
        const entry: Activity = { source: 'user', action, taskId, taskTitle, detail, at: Date.now() }
        const existing = (state?.activity || []) as Activity[]
        const updated = [...existing, entry].slice(-50)
        setState({ activity: updated } as Partial<BoardState>)
    }, [state, setState])

    // Click card → just toggle select/expand (no nudge, no blur)
    const handleSelect = useCallback((id: string) => {
        setSelectedId(prev => prev === id ? null : id)
    }, [])

    const handleMove = useCallback((id: string, newStatus: 'todo' | 'doing' | 'done') => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        const oldLabel = STATUS_CONFIG[task.status].label
        const newLabel = STATUS_CONFIG[newStatus].label
        updateItem(id, { status: newStatus } as Partial<TaskItem>)
        logActivity(`Moved task from ${oldLabel} to ${newLabel}`, id, task.title, `${oldLabel} → ${newLabel}`)
    }, [tasks, updateItem, logActivity])

    const handleDelete = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        removeItem(id)
        logActivity('Deleted task', id, task.title)
        if (selectedId === id) setSelectedId(null)
        setThreadTasks(prev => prev.filter(t => t.id !== id))
    }, [tasks, removeItem, logActivity, selectedId])

    const handleCyclePriority = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        const cycle: Record<string, 'low' | 'medium' | 'high'> = { low: 'medium', medium: 'high', high: 'low' }
        const newPriority = cycle[task.priority]
        updateItem(id, { priority: newPriority } as Partial<TaskItem>)
        logActivity(`Changed priority to ${newPriority}`, id, task.title, `${task.priority} → ${newPriority}`)
    }, [tasks, updateItem, logActivity])

    // ✨ Explain — dedicated nudge (fast model)
    const handleExplain = useCallback((task: TaskItem) => {
        setNudgeTargetId(task.id)
        setSelectedId(task.id)
        setNudgePhase('thinking')
        const statusLabel = STATUS_CONFIG[task.status].label
        nudge(
            `User wants a quick explanation of task "${task.title}" (${statusLabel}, ${task.priority} priority, description: "${task.description}"). Briefly explain what this task involves and suggest next steps.`,
            { system: 'Be very brief, 1-2 sentences max. No tool calls.', model: 'haiku' }
        )
    }, [nudge])

    const handleThread = useCallback((task: TaskItem) => {
        setThreadTasks(prev => {
            // If already open, don't add again
            if (prev.some(t => t.id === task.id)) return prev
            // Max 4 simultaneous threads
            const next = [...prev, task]
            return next.slice(-4)
        })
    }, [])

    return (
        <div className="flex-1 flex flex-col min-h-0" style={{ background: T.bg }}>
            {/* Header */}
            <div className="flex items-center shrink-0" style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '0 24px', height: '48px', gap: '12px' }}>
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: T.accent + '12' }}>
                    <LayoutGrid size={13} style={{ color: T.accent }} />
                </div>
                <span className="text-[13px]" style={{ color: T.t1 }}>Task Board</span>
                <span className="text-[11px] rounded-full" style={{ background: T.surfaceAlt, color: T.t3, padding: '2px 10px' }}>
                    {tasks.length} tasks
                </span>
                {wsState?.stats && (
                    <span className="text-[10px]" style={{ color: T.t4 }}>
                        📊 {wsState.stats.totalCreated || 0} created · {wsState.stats.totalCompleted || 0} done · {wsState.stats.agentInteractions || 0} AI
                    </span>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: connected ? T.green : T.red }}>
                    {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                    {connected ? 'Live' : 'Disconnected'}
                </div>
            </div>

            {/* Board columns */}
            <div className="flex-1 min-h-0 flex gap-6" style={{ padding: '24px' }}>
                <Column status="todo" tasks={grouped.todo} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onExplain={handleExplain} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} onSelect={handleSelect} />
                <Column status="doing" tasks={grouped.doing} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onExplain={handleExplain} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} onSelect={handleSelect} />
                <Column status="done" tasks={grouped.done} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onExplain={handleExplain} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} onSelect={handleSelect} />
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between" style={{ borderTop: `1px solid ${T.border}`, padding: '8px 24px', background: T.surface }}>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    Click to expand · ✨ explain · <MessageCircle size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> thread · Agent sees all changes
                </span>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    {(state?.activity?.length || 0)} actions logged{wsState?.stats ? ` · workspace v${Object.values(wsState.stats).reduce((s: number, v: any) => s + (typeof v === 'number' ? v : 0), 0)}` : ''}
                </span>
            </div>

            {/* Floating Thread Chat */}
            {threadTasks.map((t, i) => (
                <ThreadPanel key={t.id} task={t} sessionId={sessionId} index={i}
                    onClose={() => setThreadTasks(prev => prev.filter(x => x.id !== t.id))} />
            ))}
        </div>
    )
}
