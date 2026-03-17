import { useCallback, useMemo } from 'react'
import { useWindow } from 'drift/react'
import { ArrowRight, Trash2, Circle, Flame, Zap, Leaf, LayoutGrid, Wifi, WifiOff } from 'lucide-react'
import { useDriftContext } from 'drift/react'
import { T } from '../lib/theme'

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
    todo: { label: 'Todo', emoji: '📋', color: T.t3, bg: T.t3 + '08', border: T.t3 + '20' },
    doing: { label: 'In Progress', emoji: '🔄', color: T.amber, bg: T.amber + '08', border: T.amber + '20' },
    done: { label: 'Done', emoji: '✅', color: T.green, bg: T.green + '08', border: T.green + '20' },
}

const PRIORITY_CONFIG = {
    high: { icon: Flame, color: T.red, label: 'High' },
    medium: { icon: Zap, color: T.amber, label: 'Medium' },
    low: { icon: Leaf, color: T.green, label: 'Low' },
}

const STATUS_CYCLE: Record<string, 'todo' | 'doing' | 'done'> = {
    todo: 'doing',
    doing: 'done',
    done: 'todo',
}

// ── Task Card ──
function TaskCard({ task, onMove, onDelete, onCyclePriority }: {
    task: TaskItem
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
}) {
    const priority = PRIORITY_CONFIG[task.priority]
    const PriorityIcon = priority.icon
    const nextStatus = STATUS_CYCLE[task.status]
    const nextLabel = STATUS_CONFIG[nextStatus].label

    return (
        <div className="group rounded-xl transition-all duration-200"
            style={{
                background: T.surfaceAlt,
                border: `1px solid ${T.border}`,
                padding: '14px 16px',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderLit; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.transform = 'translateY(0)' }}>

            {/* Header: priority + actions */}
            <div className="flex items-center justify-between mb-2">
                <button onClick={() => onCyclePriority(task.id)}
                    className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-opacity hover:opacity-80"
                    style={{ background: priority.color + '15', color: priority.color, border: `1px solid ${priority.color}20` }}>
                    <PriorityIcon size={10} />
                    {priority.label}
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onMove(task.id, nextStatus)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] cursor-pointer transition-colors"
                        style={{ color: T.t3, background: T.surface }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.accent; e.currentTarget.style.background = T.accent + '10' }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.t3; e.currentTarget.style.background = T.surface }}
                        title={`Move to ${nextLabel}`}>
                        <ArrowRight size={10} /> {nextLabel}
                    </button>
                    <button onClick={() => onDelete(task.id)}
                        className="p-1 rounded-md cursor-pointer transition-colors"
                        style={{ color: T.t4 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red}
                        onMouseLeave={e => e.currentTarget.style.color = T.t4}
                        title="Delete task">
                        <Trash2 size={11} />
                    </button>
                </div>
            </div>

            {/* Title */}
            <div className="text-[13px] font-medium mb-1" style={{ color: T.t1 }}>{task.title}</div>

            {/* Description */}
            {task.description && (
                <div className="text-[11px] leading-relaxed" style={{ color: T.t3 }}>{task.description}</div>
            )}

            {/* ID badge */}
            <div className="mt-2 text-[9px] font-mono" style={{ color: T.t4 }}>{task.id}</div>
        </div>
    )
}

// ── Column ──
function Column({ status, tasks, onMove, onDelete, onCyclePriority }: {
    status: 'todo' | 'doing' | 'done'
    tasks: TaskItem[]
    onMove: (id: string, status: 'todo' | 'doing' | 'done') => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
}) {
    const config = STATUS_CONFIG[status]

    return (
        <div className="flex-1 min-w-0 flex flex-col">
            {/* Column header */}
            <div className="flex items-center gap-2 mb-4 px-1">
                <span className="text-[14px]">{config.emoji}</span>
                <span className="text-[13px] font-semibold" style={{ color: config.color }}>{config.label}</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: config.bg, color: config.color }}>
                    {tasks.length}
                </span>
            </div>

            {/* Cards */}
            <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0" style={{ paddingBottom: '12px' }}>
                {tasks.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-[12px] rounded-xl"
                        style={{ border: `1px dashed ${T.border}`, color: T.t4 }}>
                        <Circle size={12} className="mr-2" /> No tasks
                    </div>
                )}
                {tasks.map(task => (
                    <TaskCard key={task.id} task={task}
                        onMove={onMove} onDelete={onDelete} onCyclePriority={onCyclePriority} />
                ))}
            </div>
        </div>
    )
}

// ── Main Board ──
export function Board() {
    const { items, state, updateItem, removeItem, setState } = useWindow<TaskItem, BoardState>()
    const { connected } = useDriftContext()

    const tasks = items as TaskItem[]

    // Group tasks by status
    const grouped = useMemo(() => {
        const g = { todo: [] as TaskItem[], doing: [] as TaskItem[], done: [] as TaskItem[] }
        for (const t of tasks) {
            if (g[t.status]) g[t.status].push(t)
        }
        // Sort by priority within each column
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        for (const col of Object.values(g)) {
            col.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
        }
        return g
    }, [tasks])

    // Record user activity + perform action
    const logActivity = useCallback((action: string, taskId?: string, taskTitle?: string, detail?: string) => {
        const entry: Activity = { source: 'user', action, taskId, taskTitle, detail, at: Date.now() }
        const existing = (state?.activity || []) as Activity[]
        // Keep last 50 activities
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
    }, [tasks, updateItem, logActivity])

    const handleDelete = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        removeItem(id)
        logActivity('Deleted task', id, task.title)
    }, [tasks, removeItem, logActivity])

    const handleCyclePriority = useCallback((id: string) => {
        const task = tasks.find(t => t.id === id)
        if (!task) return
        const cycle: Record<string, 'low' | 'medium' | 'high'> = { low: 'medium', medium: 'high', high: 'low' }
        const newPriority = cycle[task.priority]
        updateItem(id, { priority: newPriority } as Partial<TaskItem>)
        logActivity(`Changed priority to ${newPriority}`, id, task.title, `${task.priority} → ${newPriority}`)
    }, [tasks, updateItem, logActivity])

    return (
        <div className="flex-1 flex flex-col min-h-0" style={{ background: T.bg }}>
            {/* Header */}
            <div className="flex items-center shrink-0" style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '0 24px', height: '48px', gap: '12px' }}>
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: T.accent + '12' }}>
                    <LayoutGrid size={13} style={{ color: T.accent }} />
                </div>
                <span className="text-[13px] font-medium" style={{ color: T.t1 }}>Task Board</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: T.surfaceAlt, color: T.t3 }}>
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
                <Column status="todo" tasks={grouped.todo} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} />
                <Column status="doing" tasks={grouped.doing} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} />
                <Column status="done" tasks={grouped.done} onMove={handleMove} onDelete={handleDelete} onCyclePriority={handleCyclePriority} />
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between" style={{ borderTop: `1px solid ${T.border}`, padding: '8px 24px', background: T.surface }}>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    Click priority badge to cycle • Hover card for actions • Agent sees all your changes
                </span>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                    {(state?.activity?.length || 0)} actions logged (user + agent)
                </span>
            </div>
        </div>
    )
}
