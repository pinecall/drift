/**
 * Local re-exports from drift-react package.
 * Components import from 'drift/react'; this file bridges to the package.
 */
export { DriftProvider, useDriftContext } from '../../../../drift-react/src/provider.tsx'
export { useChat } from '../../../../drift-react/src/use-chat.ts'
export { useWindow } from '../../../../drift-react/src/use-window.ts'
export { useDrift } from '../../../../drift-react/src/use-drift.ts'
export { useSessions } from '../../../../drift-react/src/use-sessions.ts'
export type { AgentInfo, AgentConfig, ChatMessage, ToolCallInfo, WindowItem, MessagePart, ServerEvent, ClientMessage } from '../../../../drift-react/src/types.ts'
export type { UseChatReturn } from '../../../../drift-react/src/use-chat.ts'
export type { UseWindowReturn } from '../../../../drift-react/src/use-window.ts'
export type { SessionInfo } from '../../../../drift-react/src/use-sessions.ts'
