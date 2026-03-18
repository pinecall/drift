/**
 * @drift/react — Shared Types
 */

// ── WebSocket Messages ──────────────────────────────

export interface ServerEvent {
    event: string;
    [key: string]: any;
}

export interface ClientMessage {
    action: string;
    [key: string]: any;
}

// ── Agent Config (runtime-mutable settings) ────────

export interface AgentConfig {
    model: string;
    modelName: string;
    thinking: boolean;
    effort: string;
    webSearch: boolean;
    maxIterations: number;
    tools: string[];
}

// ── Agent Info ──────────────────────────────────────

export interface AgentInfo {
    name: string;
    model: string;
    builtin: boolean;
    hasWindow: boolean;
    windowClass: string | null;
    isRunning?: boolean;
    config?: AgentConfig;
}

// ── Window ──────────────────────────────────────────

export interface WindowItem {
    id: string;
    [key: string]: any;
}

export interface FileEntry extends WindowItem {
    id: string;
    fullPath: string;
    content: string;
    lines: number;
    disabled: boolean;
    openedAt: number;
}

// ── Chat ────────────────────────────────────────────

/** Ordered segment within a message (text, thinking, or tool call) */
export interface MessagePart {
    type: 'text' | 'thinking' | 'tool';
    content?: string;
    /** Thinking active indicator */
    active?: boolean;
    /** Tool name */
    name?: string;
    params?: any;
    result?: any;
    ms?: number;
    status?: 'executing' | 'done' | 'error';
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    /** Ordered parts for rich rendering (text → tool → text...) */
    parts?: MessagePart[];
    /** Message lifecycle: streaming | tool | done | error */
    status?: string;
}

export interface ToolCallInfo {
    name: string;
    params: any;
    result?: any;
    ms?: number;
    status: 'executing' | 'done' | 'error';
}

