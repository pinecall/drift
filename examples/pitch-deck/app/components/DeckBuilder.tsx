import { useWindow, useWorkspace } from 'drift/react'
import { SlideCard } from './SlideCard'
import { Activity, BarChart3, Users, Clock, Trash2 } from 'lucide-react'

interface Slide {
    id: string;
    title: string;
    brief: string;
    phase: 'pending' | 'researching' | 'writing' | 'polishing' | 'done';
    research?: string;
    content?: string;
    finalContent?: string;
    agent?: string;
    order: number;
}

interface DeckState {
    topic: string;
    totalSlides: number;
    completedSlides: number;
    activity: string[];
}

interface WorkspaceState {
    status: string;
    topic: string;
    totalSlides: number;
    slidesResearched: number;
    slidesWritten: number;
    slidesPolished: number;
    completedSlides: number;
    activity: string[];
}

export function DeckBuilder() {
    const { items: slides, state: deckState, removeItem, setState: setDeckState } = useWindow<Slide, DeckState>()
    const { state: ws, setState: setWs } = useWorkspace<WorkspaceState>()

    const sortedSlides = [...slides].sort((a, b) => (a.order || 0) - (b.order || 0))
    const phaseCount = (phase: string) => slides.filter(s => s.phase === phase).length
    const activeAgents = slides.filter(s => s.agent).map(s => `${s.agent} → ${s.title}`)

    const handleClear = () => {
        // Remove all slides from window
        for (const slide of slides) {
            removeItem(slide.id)
        }
        // Clear window state (activity feed)
        setDeckState({ topic: '', totalSlides: 0, completedSlides: 0, activity: [] } as any)
        // Reset workspace state
        if (setWs) {
            setWs({
                status: 'idle',
                topic: '',
                totalSlides: 0,
                slidesResearched: 0,
                slidesWritten: 0,
                slidesPolished: 0,
                completedSlides: 0,
                activity: [],
            } as any)
        }
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Dashboard Header */}
            <div style={{
                padding: '20px 28px',
                borderBottom: '1px solid #1a1a2e',
                background: '#0d0d14',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <BarChart3 size={22} color="#8b5cf6" />
                            {ws?.topic || 'Pitch Deck Builder'}
                        </h1>
                        <p style={{ color: '#666', fontSize: '13px', margin: '4px 0 0 0' }}>
                            {ws?.status === 'building' ? '🔄 Agents working in parallel...' :
                             ws?.status === 'done' ? '✅ Deck complete!' :
                             'Waiting for instructions...'}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {slides.length > 0 && (
                            <>
                                <div style={{
                                    background: '#1a1a2e',
                                    borderRadius: '10px',
                                    padding: '8px 16px',
                                    fontSize: '13px',
                                    color: '#aaa',
                                }}>
                                    {slides.filter(s => s.phase === 'done').length}/{slides.length} complete
                                </div>
                                <button onClick={handleClear} title="Clear all slides" style={{
                                    background: '#1a1a2e',
                                    border: '1px solid #252540',
                                    borderRadius: '10px',
                                    padding: '8px 12px',
                                    color: '#777',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    transition: 'all 0.2s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#252540'; e.currentTarget.style.color = '#777'; }}
                                >
                                    <Trash2 size={14} />
                                    Clear
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Phase Progress Bars */}
                {slides.length > 0 && (
                    <div style={{ display: 'flex', gap: '16px' }}>
                        <PhaseBar label="Research" count={phaseCount('researching')} done={ws?.slidesResearched || 0} total={slides.length} color="#3b82f6" emoji="🔍" />
                        <PhaseBar label="Writing" count={phaseCount('writing')} done={ws?.slidesWritten || 0} total={slides.length} color="#f59e0b" emoji="✍️" />
                        <PhaseBar label="Polish" count={phaseCount('polishing')} done={ws?.slidesPolished || 0} total={slides.length} color="#10b981" emoji="🎨" />
                        <PhaseBar label="Done" count={phaseCount('done')} done={phaseCount('done')} total={slides.length} color="#8b5cf6" emoji="✅" />
                    </div>
                )}

                {/* Active Agents */}
                {activeAgents.length > 0 && (
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <Users size={14} color="#666" />
                        {activeAgents.map((a, i) => (
                            <span key={i} style={{
                                background: '#1a1a2e',
                                border: '1px solid #252540',
                                borderRadius: '6px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                color: '#8b5cf6',
                                animation: 'pulse 2s infinite',
                            }}>
                                🤖 {a}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Slide Grid */}
                <div style={{
                    flex: 1,
                    padding: '24px',
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '16px',
                    alignContent: 'start',
                }}>
                    {sortedSlides.length === 0 && (
                        <div style={{
                            gridColumn: '1 / -1',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '300px',
                            color: '#444',
                        }}>
                            <BarChart3 size={48} strokeWidth={1} />
                            <p style={{ marginTop: '16px', fontSize: '15px' }}>Slides will appear here as agents build them</p>
                        </div>
                    )}
                    {sortedSlides.map(slide => (
                        <SlideCard key={slide.id} slide={slide} />
                    ))}
                </div>

                {/* Activity Feed */}
                <ActivityFeed activities={deckState?.activity || []} />
            </div>
        </div>
    )
}

function PhaseBar({ label, count, done, total, color, emoji }: {
    label: string; count: number; done: number; total: number; color: string; emoji: string;
}) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: '#888' }}>
                <span>{emoji} {label}</span>
                <span>{count > 0 ? `${count} active` : `${done}/${total}`}</span>
            </div>
            <div style={{ height: '4px', background: '#1a1a2e', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    borderRadius: '2px',
                    transition: 'width 0.5s ease',
                }} />
            </div>
        </div>
    )
}

function ActivityFeed({ activities }: { activities: string[] }) {
    return (
        <div style={{
            width: '280px',
            minWidth: '280px',
            borderLeft: '1px solid #1a1a2e',
            background: '#0d0d14',
            display: 'flex',
            flexDirection: 'column',
        }}>
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid #1a1a2e',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#aaa',
            }}>
                <Activity size={14} />
                Live Activity
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                {activities.length === 0 && (
                    <div style={{ color: '#444', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                        <Clock size={18} style={{ margin: '0 auto 8px' }} />
                        <p>Waiting for agents...</p>
                    </div>
                )}
                {[...activities].reverse().map((a, i) => (
                    <div key={i} style={{
                        padding: '6px 8px',
                        fontSize: '11px',
                        color: '#888',
                        borderBottom: '1px solid #111',
                        lineHeight: 1.5,
                    }}>
                        {a}
                    </div>
                ))}
            </div>
        </div>
    )
}
