import { useState, memo } from 'react'
import { Plus, MessageSquare, Trash2, Bot } from 'lucide-react'
import { useSessions, type SessionInfo } from 'drift/react'
import { T } from '../lib/theme'

// ── Session Item ──
const SessionItem = memo(function SessionItem({ session, isActive, onClick, onDelete }: {
    session: SessionInfo; isActive: boolean; onClick: () => void; onDelete: () => void;
}) {
    const [hovered, setHovered] = useState(false)
    const age = _timeAgo(session.createdAt)
    const preview = session.lastMessage?.slice(0, 50) || 'New conversation'

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '10px',
                border: 'none',
                background: isActive ? T.accent + '12' : hovered ? T.surface : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                position: 'relative',
            }}
        >
            <MessageSquare size={14} style={{
                color: isActive ? T.accent : T.t4,
                marginTop: '2px',
                flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{
                    fontSize: '12px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? T.t1 : T.t2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.4',
                }}>
                    {preview}
                </div>
                <div style={{
                    fontSize: '10px',
                    color: T.t4,
                    marginTop: '2px',
                }}>
                    {age}
                </div>
            </div>
            {hovered && !isActive && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: T.red + '12',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px',
                        cursor: 'pointer',
                        color: T.red,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Trash2 size={11} />
                </button>
            )}
        </button>
    )
})

// ── Sidebar ──
export function Sidebar({ activeSessionId, onSelectSession, onNewChat }: {
    activeSessionId: string;
    onSelectSession: (sessionId: string) => void;
    onNewChat: () => void;
}) {
    const { sessions, deleteSession } = useSessions()

    // Merge: always include the active session even if server hasn't seen it yet
    const allSessions: SessionInfo[] = (() => {
        const has = sessions.some(s => s.id === activeSessionId)
        if (has) return sessions
        return [
            ...sessions,
            { id: activeSessionId, agentName: '', createdAt: Date.now(), messageCount: 0 },
        ]
    })()

    const sorted = [...allSessions].sort((a, b) => b.createdAt - a.createdAt)

    return (
        <div style={{
            width: '260px',
            minWidth: '260px',
            display: 'flex',
            flexDirection: 'column',
            background: T.bg,
            borderRight: `1px solid ${T.border}`,
            height: '100%',
        }}>
            {/* Header */}
            <div style={{
                padding: '12px 14px',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                height: '48px',
                flexShrink: 0,
            }}>
                <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: T.accent + '12',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <Bot size={14} style={{ color: T.accent }} />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: T.t1, flex: 1 }}>Drift</span>
                <button
                    onClick={onNewChat}
                    style={{
                        background: 'none',
                        border: `1px solid ${T.border}`,
                        borderRadius: '8px',
                        padding: '5px 10px',
                        cursor: 'pointer',
                        color: T.t3,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = T.accent
                        e.currentTarget.style.color = T.accent
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = T.border
                        e.currentTarget.style.color = T.t3
                    }}
                >
                    <Plus size={12} />
                    New
                </button>
            </div>

            {/* Sessions List */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
            }}>
                {sorted.map(session => (
                    <SessionItem
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onClick={() => onSelectSession(session.id)}
                        onDelete={() => deleteSession(session.id)}
                    />
                ))}
            </div>
        </div>
    )
}

// ── Helpers ──
function _timeAgo(ts: number): string {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}
