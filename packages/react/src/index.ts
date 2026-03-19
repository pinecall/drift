/**
 * @drift/react — Public API
 * 
 * import { DriftProvider, useWindow, useChat, useDrift } from '@drift/react';
 */

// Provider
export { DriftProvider, useDriftContext } from './provider.tsx';

// Hooks
export { useWindow, type UseWindowReturn } from './use-window.ts';
export { useWorkspace, type UseWorkspaceReturn } from './use-workspace.ts';
export { useChat, type UseChatReturn, type NudgeOptions } from './use-chat.ts';
export { useThread, type UseThreadReturn, type ThreadOptions } from './use-thread.ts';
export { useDrift, type UseDriftReturn } from './use-drift.ts';
export { useSessions, type UseSessionsReturn, type SessionInfo } from './use-sessions.ts';
export { useStreamBuffer, type StreamBufferOptions } from './use-stream-buffer.ts';
export { useMarkdown, type UseMarkdownOptions, type UseMarkdownReturn } from './use-markdown.ts';

// Utilities
export { parseMarkdown } from './markdown.ts';

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
