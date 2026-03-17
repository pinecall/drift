import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useWindow, useChat, useThread } from 'drift/react'
import { ArrowRight, Trash2, Circle, LayoutGrid, Wifi, WifiOff, Loader2, CheckCircle2, MessageCircle, X, Minus, Send, Maximize2 } from 'lucide-react'
import { useDriftContext } from 'drift/react'
import { T } from '../lib/theme'
import ReactMarkdown from 'react-markdown'

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
function ThreadPanel({ task, sessionId, onClose }: { task: TaskItem; sessionId: string; onClose: () => void }) {
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

    // Minimized pill
    if (isMinimized) {
        return (
            <button
                onClick={() => setIsMinimized(false)}
                className="flex items-center gap-1.5 rounded-full cursor-pointer"
                style={{
                    position: 'fixed', bottom: '16px', right: '16px',
                    background: T.accent, color: '#fff',
                    padding: '8px 14px', fontSize: '11px',
                    boxShadow: `0 4px 24px ${T.accent}40`,
                    zIndex: 100,
                }}>
                <MessageCircle size={12} />
                {task.title}
                {thread.hasHistory && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fff' }} />}
            </button>
        )
    }

    const panelWidth = isMaximized ? '420px' : '340px'
    const panelHeight = isMaximized ? '500px' : '380px'

    return (
        <div style={{
            position: 'fixed', bottom: '16px', right: '16px',
            width: panelWidth, height: panelHeight,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: '16px',
            display: 'flex', flexDirection: 'column',
            boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 20px ${T.accent}08`,
            zIndex: 100,
            transition: 'width 0.2s ease, height 0.2s ease',
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
                                <div className="prose-thread">
                                    {msg.parts?.map((part, j) => {
                                        if (part.type === 'text') {
                                            return <ReactMarkdown key={j}>{part.content || ''}</ReactMarkdown>
                                        }
                                        if (part.type === 'thinking' && part.content) {
                                            return (
                                                <div key={j} className="text-[10px] italic" style={{ color: T.t4, marginBottom: '4px' }}>
                                                    {part.content.slice(0, 100)}...
                                                </div>
                                            )
                                        }
                                        return null
                                    })}
                                    {msg.status === 'streaming' && (
                                        <span className="inline-flex gap-0.5 ml-1">
                                            {[0, 100, 200].map(d => (
                                                <span key={d} className="w-1 h-1 rounded-full animate-bounce" style={{ background: T.accent, animationDelay: `${d}ms` }} />
                                            ))}
                                        </span>
                                    )}
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
function TaskCard({ task, onMove, onDelete, onCyclePriority, onNudge, onThread, isSelected, isBlurred, nudgePhase }: {
    task: TaskItem
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
    onNudge: (task: TaskItem) => void
    onThread: (task: TaskItem) => void
    isSelected: boolean
    isBlurred: boolean
    nudgePhase: NudgePhase
}) {
    const priority = PRIORITY_CONFIG[task.priority]
    const nextStatus = STATUS_CYCLE[task.status]
    const nextLabel = STATUS_CONFIG[nextStatus].label

    const handleClick = () => {
        onNudge(task)
    }

    const age = Date.now() - task.createdAt
    const ageLabel = age < 3600000 ? `${Math.round(age / 60000)}m ago`
        : age < 86400000 ? `${Math.round(age / 3600000)}h ago`
        : `${Math.round(age / 86400000)}d ago`

    const isActive = nudgePhase !== 'idle'
    const borderColor = isActive ? T.accent + '50' : T.border
    const leftBorder = isSelected ? `3px solid ${
        nudgePhase === 'thinking' ? T.amber :
        nudgePhase === 'streaming' ? T.accent :
        nudgePhase === 'done' ? T.green : T.accent
    }` : `1px solid ${borderColor}`

    return (
        <div className="group rounded-xl cursor-pointer"
            style={{
                background: T.surfaceAlt,
                border: `1px solid ${borderColor}`,
                borderLeft: leftBorder,
                padding: isSelected ? '16px 18px 16px 16px' : '14px 18px',
                boxShadow: isActive ? `0 0 16px ${T.accent}10` : 'none',
                opacity: isBlurred ? 0.35 : 1,
                filter: isBlurred ? 'blur(1px)' : 'none',
                transition: 'all 0.3s ease, opacity 0.3s ease, filter 0.3s ease',
                transform: isBlurred ? 'scale(0.98)' : 'scale(1)',
            }}
            onClick={handleClick}
            onMouseEnter={e => {
                if (!isSelected && !isBlurred) {
                    e.currentTarget.style.borderColor = T.borderLit
                    e.currentTarget.style.transform = 'translateY(-1px)'
                }
            }}
            onMouseLeave={e => {
                if (!isSelected && !isBlurred) {
                    e.currentTarget.style.borderColor = T.border
                    e.currentTarget.style.transform = 'scale(1)'
                }
            }}>

            {/* Header: priority + actions */}
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
                <div className="flex items-center gap-1" style={{ opacity: 0, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    ref={el => {
                        if (el) {
                            const parent = el.closest('.group')
                            if (parent) {
                                parent.addEventListener('mouseenter', () => el.style.opacity = '1')
                                parent.addEventListener('mouseleave', () => el.style.opacity = '0')
                            }
                        }
                    }}>
                    <button onClick={e => { e.stopPropagation(); onThread(task) }}
                        className="p-1 rounded-md cursor-pointer transition-colors"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.accent}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}
                        title="Open thread">
                        <MessageCircle size={11} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onMove(task.id, nextStatus) }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] cursor-pointer transition-colors"
                        style={{ color: T.t3, background: T.surface }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.accent; e.currentTarget.style.background = T.accent + '10' }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.t3; e.currentTarget.style.background = T.surface }}
                        title={`Move to ${nextLabel}`}>
                        <ArrowRight size={10} /> {nextLabel}
                    </button>
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
                    ...(isSelected ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }),
                }}>{task.description}</div>
            )}

            {/* Expanded details */}
            {isSelected && (
                <div className="flex flex-col gap-2" style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${T.border}` }}>
                    <div className="flex items-center gap-4 text-[10px]" style={{ color: T.t4 }}>
                        <span>Created {ageLabel}</span>
                        <span>ID: <span className="font-mono">{task.id}</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]" style={{ color: T.t4 }}>
                        <span>Status: <span style={{ color: STATUS_CONFIG[task.status].color }}>{STATUS_CONFIG[task.status].label}</span></span>
                        <span style={{ color: T.t4 }}>·</span>
                        <span>Priority: <span style={{ color: priority.color }}>{priority.label}</span></span>
                    </div>
                </div>
            )}

            {/* ID badge (collapsed only) */}
            {!isSelected && (
                <div className="font-mono" style={{ marginTop: '8px', fontSize: '9px', color: T.t4 }}>{task.id}</div>
            )}
        </div>
    )
}

// ── Column ──
function Column({ status, tasks, onMove, onDelete, onCyclePriority, onNudge, onThread, selectedId, nudgePhase }: {
    status: 'todo' | 'doing' | 'done'
    tasks: TaskItem[]
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
    onNudge: (task: TaskItem) => void
    onThread: (task: TaskItem) => void
    selectedId: string | null
    nudgePhase: NudgePhase
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
                    <TaskCard key={task.id} task={task}
                        onMove={onMove} onDelete={onDelete} onCyclePriority={onCyclePriority}
                        onNudge={onNudge} onThread={onThread}
                        isSelected={selectedId === task.id}
                        isBlurred={selectedId !== null && selectedId !== task.id}
                        nudgePhase={selectedId === task.id ? nudgePhase : 'idle'} />
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

    const tasks = items as TaskItem[]
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [nudgePhase, setNudgePhase] = useState<NudgePhase>('idle')
    const [threadTask, setThreadTask] = useState<TaskItem | null>(null)
    const prevStreamingRef = useRef(false)

    // Track nudge phases based on isStreaming
    useEffect(() => {
        if (isStreaming && !prevStreamingRef.current && selectedId) {
            setNudgePhase('streaming')
        }
        if (!isStreaming && prevStreamingRef.current && selectedId) {
            setNudgePhase('done')
            setTimeout(() => {
                setNudgePhase('idle')
                setSelectedId(null)
            }, 1500)
        }
        prevStreamingRef.current = isStreaming
    }, [isStreaming, selectedId])

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

    // Record user activity
    const logActivity = useCallback((action: string, taskId?: string, taskTitle?: string, detail?: string) => {
        const entry: Activity = { source: 'user', action, taskId, taskTitle, detail, at: Date.now() }
        const existing = (state?.activity || []) as Activity[]
        const updated = [...existing, entry].slice(-50)
        setState({ activity: updated } as Partial<BoardState>)
    }, [state, setState])

    const handleMove = useCallback((id: string, newStatus: 'todo' | 'doing' | 'done') => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        const oldLabel = STATUS_CONFIG[task.status].label
        const newLabel = STATUS_CONFIG[newStatus].label
        updateItem(id, { status: newStatus } as Partial<TaskItem>)
        logActivity(`Moved task from ${oldLabel} to ${newLabel}`, id, task.title, `${oldLabel} → ${newLabel}`)
        setSelectedId(id)
        setNudgePhase('thinking')
        nudge(
            `User moved task "${task.title}" from ${oldLabel} to ${newLabel}. Briefly acknowledge the move.`,
            { system: 'One sentence max. No tool calls.' }
        )
    }, [tasks, updateItem, logActivity, nudge])

    const handleDelete = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        removeItem(id)
        logActivity('Deleted task', id, task.title)
        if (selectedId === id) {
            setSelectedId(null)
            setNudgePhase('idle')
        }
        if (threadTask?.id === id) setThreadTask(null)
    }, [tasks, removeItem, logActivity, selectedId, threadTask])

    const handleCyclePriority = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        const cycle: Record<string, 'low' | 'medium' | 'high'> = { low: 'medium', medium: 'high', high: 'low' }
        const newPriority = cycle[task.priority]
        updateItem(id, { priority: newPriority } as Partial<TaskItem>)
        logActivity(`Changed priority to ${newPriority}`, id, task.title, `${task.priority} → ${newPriority}`)
    }, [tasks, updateItem, logActivity])

    const handleNudge = useCallback((task: TaskItem) => {
        if (selectedId === task.id) {
            setSelectedId(null)
            setNudgePhase('idle')
            return
        }
        setSelectedId(task.id)
        setNudgePhase('thinking')
        const statusLabel = STATUS_CONFIG[task.status].label
        nudge(
            `User clicked on task "${task.title}" (${statusLabel}, ${task.priority} priority). Briefly explain what this task involves and suggest next steps.`,
            { system: 'Be very brief, 1-2 sentences max. No tool calls.' }
        )
    }, [nudge, selectedId])

    const handleThread = useCallback((task: TaskItem) => {
        setThreadTask(task)
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
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: connected ? T.green : T.red }}>
                    {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                    {connected ? 'Live' : 'Disconnected'}
                </div>
            </div>

            {/* Board columns */}
            <div className="flex-1 min-h-0 flex gap-6" style={{ padding: '24px' }}>
                <Column status="todo" tasks={grouped.todo} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onNudge={handleNudge} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} />
                <Column status="doing" tasks={grouped.doing} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onNudge={handleNudge} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} />
                <Column status="done" tasks={grouped.done} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onNudge={handleNudge} onThread={handleThread} selectedId={selectedId} nudgePhase={nudgePhase} />
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between" style={{ borderTop: `1px solid ${T.border}`, padding: '8px 24px', background: T.surface }}>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    Click card to inspect · <MessageCircle size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> to chat · Agent sees all changes
                </span>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    {(state?.activity?.length || 0)} actions logged
                </span>
            </div>

            {/* Floating Thread Chat */}
            {threadTask && <ThreadPanel task={threadTask} sessionId={sessionId} onClose={() => setThreadTask(null)} />}
        </div>
    )
}
