/**
 * Local re-exports from drift/react package.
 * Components import from 'drift/react'; this file bridges to the package.
 */
export { DriftProvider, useDriftContext } from 'drift/react'
export { useChat } from 'drift/react'
export { useThread } from 'drift/react'
export { useWindow } from 'drift/react'
export { useWorkspace } from 'drift/react'
export { useDrift } from 'drift/react'
export { useSessions } from 'drift/react'
export { useStreamBuffer } from 'drift/react'
export type { AgentInfo, AgentConfig, ChatMessage, ToolCallInfo, WindowItem, ServerEvent, ClientMessage } from 'drift/react'
export type { UseChatReturn } from 'drift/react'
export type { UseThreadReturn, ThreadOptions } from 'drift/react'
export type { UseWindowReturn } from 'drift/react'
export type { SessionInfo } from 'drift/react'
export { useMarkdown, type UseMarkdownOptions, type UseMarkdownReturn } from 'drift/react'
export { parseMarkdown } from 'drift/react'
