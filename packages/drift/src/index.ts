/**
 * Drift — Public API
 * 
 * import { Agent, tool, DeveloperAgent, MCP, Window, CodebaseWindow } from 'drift';
 */

export { Agent, StreamBuilder } from './core/agent.ts';
export { Session } from './core/session.ts';
export { tool, ToolRegistry, defineTool } from './decorators/tool.ts';
export { Conversation, type TrimStats } from './core/conversation.ts';
export { Cache } from './core/cache.ts';
export { Window, type WindowItem, type WindowChangeEvent, type ChangeAction } from './state/window.ts';
export { Workspace, type WorkspaceChangeEvent, type WorkspaceAction } from './state/workspace.ts';
export { Trigger, TriggerManager, type DispatchFn, type DispatchResult, type DispatchOptions } from './coordination/trigger.ts';
export { Pipeline, PipelineManager, type PipelineStep, type PipelineContext, type PipelineResult, type PipelineStepResult } from './coordination/pipeline.ts';
export { TaskBoard, DEFAULT_COLUMNS, type Card, type BoardState, type CardInput, type Column } from './coordination/taskboard.ts';
export { MCP, type MCPServerConfig } from './core/mcp.ts';
export { Pricing } from './core/pricing.ts';
export { Provider } from './provider/provider.ts';
export { DriftServer } from './server/index.ts';

// JSX runtime for window rendering
export { jsx, render, Fragment } from './jsx-runtime.ts';

// Storage (pluggable persistence)
export { SQLiteStorage } from './storage/sqlite-storage.ts';
export type { Storage, SessionData } from './storage/storage.ts';

// Auth (pluggable authentication)
export { NoAuth, TokenAuth, SecretAuth } from './auth/auth.ts';
export type { DriftAuth, DriftUser } from './auth/auth.ts';

// Windows (domain-specific)
export { CodebaseWindow, type FileEntry, type CodebaseWindowOptions } from './windows/codebase-window.tsx';

// Built-in agents
export { DeveloperAgent } from './agents/developer.ts';
export { DeveloperLiteAgent } from './agents/developer-lite.ts';
export { PlaywrightAgent } from './agents/playwright.ts';
export { ResearcherAgent } from './agents/researcher.ts';
export { ManagerAgent } from './agents/manager.ts';

export { resolvePrompt, classNameToKebab } from './core/prompt.ts';
export {
    MODELS, DEFAULT_MODEL,
    getModel, getModelById, listModels,
    buildThinkingConfig, getBetaHeaders,
} from './provider/models.ts';

// Built-in tool utilities
export {
    ALL_TOOLS, EDIT_TOOLS, FILESYSTEM_TOOLS, SHELL_TOOLS, BOARD_TOOLS,
    CATEGORIES, TOOL_NAMES, CATEGORY_NAMES,
    registerBuiltinTools, registerSelectedTools,
} from './tools/index.ts';

// Re-export all types
export type {
    ToolSchema, ToolParamSchema, ToolDefinition, ToolResult, ToolContext,
    AgentResult, AgentOptions, ToolCall,
    ModelConfig, Effort,
    Message, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
    ApiUsage, PricingTurn,
    WebSearchConfig,
    WindowContext, WindowFile, DiffTracker, DiffEntry,
} from './types.ts';
