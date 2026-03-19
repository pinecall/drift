import { Search, Pen, Palette, CheckCircle, Loader, Clock } from 'lucide-react'
import { parseMarkdown, useMarkdown, type AgentStreamEntry } from 'drift/react'

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

const phaseConfig: Record<string, { color: string; bg: string; border: string; icon: any; label: string }> = {
    pending:     { color: '#666',    bg: '#111118', border: '#1e1e2e', icon: Clock,       label: 'Queued' },
    researching: { color: '#3b82f6', bg: '#0c1529', border: '#1a3060', icon: Search,      label: 'Researching...' },
    writing:     { color: '#f59e0b', bg: '#1a1508', border: '#3d3010', icon: Pen,         label: 'Writing...' },
    polishing:   { color: '#10b981', bg: '#0a1a14', border: '#1a3d2e', icon: Palette,     label: 'Polishing...' },
    done:        { color: '#8b5cf6', bg: '#13102a', border: '#2a2050', icon: CheckCircle, label: 'Complete ✅' },
}

const phaseSteps = ['pending', 'researching', 'writing', 'polishing', 'done'];

export function SlideCard({ slide, stream }: { slide: Slide; stream?: AgentStreamEntry }) {
    const config = phaseConfig[slide.phase] || phaseConfig.pending
    const Icon = config.icon
    const isWorking = ['researching', 'writing', 'polishing'].includes(slide.phase)
    const currentStep = phaseSteps.indexOf(slide.phase)

    // Determine what to stream: show live stream text if agent is actively streaming
    const isStreaming = stream?.isStreaming ?? false
    const streamField = stream?.field
    const streamText = stream?.text || ''

    return (
        <div style={{
            background: config.bg,
            border: `1px solid ${config.border}`,
            borderRadius: '14px',
            padding: '20px',
            transition: 'all 0.5s ease',
            position: 'relative',
            overflow: 'hidden',
            animation: 'slideIn 0.4s ease-out',
        }}>
            {/* Top shimmer bar when working */}
            {isWorking && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: `linear-gradient(90deg, transparent, ${config.color}, transparent)`,
                    animation: 'shimmer 1.5s ease-in-out infinite',
                }} />
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <div>
                    <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px', fontWeight: 600, letterSpacing: '0.5px' }}>
                        SLIDE {slide.order}
                    </div>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#eee' }}>
                        {slide.title}
                    </h3>
                </div>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: config.color,
                    background: `${config.color}18`,
                    border: `1px solid ${config.color}35`,
                }}>
                    {isWorking ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Icon size={13} />}
                    {config.label}
                </div>
            </div>

            {/* Phase progress dots */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', alignItems: 'center' }}>
                {phaseSteps.map((phase, i) => (
                    <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{
                            width: i <= currentStep ? '10px' : '8px',
                            height: i <= currentStep ? '10px' : '8px',
                            borderRadius: '50%',
                            background: i < currentStep ? config.color
                                : i === currentStep ? (isWorking ? config.color : config.color)
                                : '#222',
                            border: i === currentStep && isWorking ? `2px solid ${config.color}` : 'none',
                            animation: i === currentStep && isWorking ? 'pulse 1.5s infinite' : 'none',
                            transition: 'all 0.3s ease',
                        }} />
                        {i < phaseSteps.length - 1 && (
                            <div style={{
                                width: '16px',
                                height: '2px',
                                background: i < currentStep ? config.color : '#222',
                                transition: 'all 0.3s ease',
                            }} />
                        )}
                    </div>
                ))}
                <span style={{ fontSize: '10px', color: '#555', marginLeft: '4px' }}>
                    {currentStep + 1}/{phaseSteps.length}
                </span>
            </div>

            {/* Brief */}
            <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px 0', lineHeight: 1.5, fontStyle: 'italic' }}>
                "{slide.brief}"
            </p>

            {/* Active agent badge */}
            {slide.agent && (
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '12px',
                    padding: '6px 12px',
                    background: `${config.color}10`,
                    border: `1px solid ${config.color}25`,
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: config.color,
                    fontWeight: 500,
                }}>
                    <span style={{ animation: 'pulse 1s infinite' }}>🤖</span>
                    {slide.agent} working...
                </div>
            )}

            {/* Content sections — show streaming text OR saved content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Live streaming section — shows while agent is actively generating */}
                {isStreaming && streamText && (
                    <StreamingSection
                        field={streamField || ''}
                        text={streamText}
                        color={
                            streamField === 'research' ? '#3b82f6' :
                            streamField === 'content' ? '#f59e0b' :
                            '#10b981'
                        }
                    />
                )}

                {/* Saved content sections */}
                {slide.research && !(isStreaming && streamField === 'research') && (
                    <ContentSection
                        emoji="🔍"
                        label="Research"
                        content={slide.research}
                        color="#3b82f6"
                        expanded={!slide.content}
                    />
                )}
                {slide.content && !(isStreaming && streamField === 'content') && (
                    <ContentSection
                        emoji="✍️"
                        label="Content"
                        content={slide.content}
                        color="#f59e0b"
                        expanded={!slide.finalContent}
                    />
                )}
                {slide.finalContent && !(isStreaming && streamField === 'finalContent') && (
                    <ContentSection
                        emoji="✅"
                        label="Final"
                        content={slide.finalContent}
                        color="#8b5cf6"
                        expanded={true}
                    />
                )}
            </div>
        </div>
    )
}

/** Live streaming content — uses useMarkdown with streaming animation */
function StreamingSection({ field, text, color }: { field: string; text: string; color: string }) {
    const { html } = useMarkdown(text, { streaming: true, charsPerFrame: 6 })
    const label = field === 'research' ? '🔍 Researching...' :
                  field === 'content' ? '✍️ Writing...' :
                  '✨ Polishing...'

    return (
        <div style={{
            background: '#0a0a12',
            borderRadius: '8px',
            padding: '10px 12px',
            borderLeft: `3px solid ${color}`,
            animation: 'fadeIn 0.5s ease-out',
        }}>
            <div style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                color: color,
                marginBottom: '8px',
                fontWeight: 600,
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
            }}>
                {label}
                <Loader size={10} style={{ animation: 'spin 1s linear infinite', marginLeft: '4px' }} />
            </div>
            <div
                className="drift-md"
                style={{ fontSize: '13px', lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    )
}

function ContentSection({ emoji, label, content, color, expanded }: {
    emoji: string; label: string; content: string; color: string; expanded: boolean;
}) {
    return (
        <div style={{
            background: '#0a0a12',
            borderRadius: '8px',
            padding: expanded ? '10px 12px' : '8px 12px',
            borderLeft: `3px solid ${color}`,
            animation: 'fadeIn 0.5s ease-out',
            cursor: expanded ? 'default' : 'pointer',
        }}>
            <div style={{ 
                fontSize: '10px', 
                textTransform: 'uppercase', 
                color: '#666', 
                marginBottom: expanded ? '8px' : 0,
                fontWeight: 600,
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
            }}>
                {emoji} {label}
                {!expanded && <span style={{ color: '#444' }}> (click to expand)</span>}
            </div>
            {expanded && (
                <div
                    className="drift-md"
                    style={{
                        fontSize: '13px',
                        lineHeight: 1.7,
                    }}
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
                />
            )}
        </div>
    )
}
