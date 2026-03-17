/**
 * Local re-exports from drift-react package.
 * Components import from 'drift/react'; this file bridges to the package.
 */
export { DriftProvider, useDriftContext } from '../../../../packages/drift-react/src/provider.tsx'
export { useChat } from '../../../../packages/drift-react/src/use-chat.ts'
export { useThread } from '../../../../packages/drift-react/src/use-thread.ts'
export { useWindow } from '../../../../packages/drift-react/src/use-window.ts'
export { useDrift } from '../../../../packages/drift-react/src/use-drift.ts'
export { useSessions } from '../../../../packages/drift-react/src/use-sessions.ts'
export type { AgentInfo, AgentConfig, ChatMessage, ToolCallInfo, WindowItem, MessagePart, ServerEvent, ClientMessage } from '../../../../packages/drift-react/src/types.ts'
export type { UseChatReturn } from '../../../../packages/drift-react/src/use-chat.ts'
export type { UseThreadReturn, ThreadOptions } from '../../../../packages/drift-react/src/use-thread.ts'
export type { UseWindowReturn } from '../../../../packages/drift-react/src/use-window.ts'
export type { SessionInfo } from '../../../../packages/drift-react/src/use-sessions.ts'
