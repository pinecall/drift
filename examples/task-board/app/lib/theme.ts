/** Theme tokens — warm indigo palette with agent colors */
export const T = {
    bg: '#0f1117',
    surface: '#161821',
    surfaceAlt: '#1c1e2a',
    border: '#282c3c',
    borderLit: '#363b50',
    t1: '#e8e6f0',
    t2: '#b4b0cc',
    t3: '#8882a8',
    t4: '#5c577a',
    accent: '#818cf8',
    green: '#34d399',
    red: '#fb7185',
    amber: '#fbbf24',
    purple: '#a78bfa',
    cyan: '#22d3ee',
    pink: '#f472b6',
    orange: '#fb923c',
} as const

/** Agent-specific colors */
export const AGENT_COLORS: Record<string, { color: string; bg: string; icon: string; label: string }> = {
    'task-agent': { color: '#818cf8', bg: '#818cf812', icon: '⚡', label: 'Task Agent' },
    'planner':    { color: '#22d3ee', bg: '#22d3ee12', icon: '📋', label: 'Planner' },
    'reviewer':   { color: '#f472b6', bg: '#f472b612', icon: '🔍', label: 'Reviewer' },
}

export function getAgentStyle(name: string) {
    return AGENT_COLORS[name] || { color: T.t3, bg: T.surfaceAlt, icon: '🤖', label: name }
}
