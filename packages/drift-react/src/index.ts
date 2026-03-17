/**
 * drift-react — Public API
 * 
 * import { DriftProvider, useWindow, useChat, useDrift } from 'drift-react';
 */

// Provider
export { DriftProvider, useDriftContext } from './provider.tsx';

// Hooks
export { useWindow, type UseWindowReturn } from './use-window.ts';
export { useChat, type UseChatReturn, type NudgeOptions } from './use-chat.ts';
export { useDrift, type UseDriftReturn } from './use-drift.ts';
export { useSessions, type UseSessionsReturn, type SessionInfo } from './use-sessions.ts';

// Types
export type {
    AgentInfo,
    AgentConfig,
    WindowItem,
    FileEntry,
    ChatMessage,
    ToolCallInfo,
    ServerEvent,
    ClientMessage,
} from './types.ts';
