/**
 * Local re-exports from @drift/react package.
 * Components import from 'drift/react'; this file bridges to the package.
 */
export { DriftProvider, useDriftContext } from '../../../../packages/react/src/provider.tsx'
export { useChat } from '../../../../packages/react/src/use-chat.ts'
export { useThread } from '../../../../packages/react/src/use-thread.ts'
export { useWindow } from '../../../../packages/react/src/use-window.ts'
export { useWorkspace } from '../../../../packages/react/src/use-workspace.ts'
export { useDrift } from '../../../../packages/react/src/use-drift.ts'
export { useSessions } from '../../../../packages/react/src/use-sessions.ts'
export { useStreamBuffer } from '../../../../packages/react/src/use-stream-buffer.ts'
export type { AgentInfo, AgentConfig, ChatMessage, ToolCallInfo, WindowItem, MessagePart, ServerEvent, ClientMessage } from '../../../../packages/react/src/types.ts'
export type { UseChatReturn } from '../../../../packages/react/src/use-chat.ts'
export type { UseThreadReturn, ThreadOptions } from '../../../../packages/react/src/use-thread.ts'
export type { UseWindowReturn } from '../../../../packages/react/src/use-window.ts'
export type { SessionInfo } from '../../../../packages/react/src/use-sessions.ts'
