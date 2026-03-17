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
export { Window, type WindowItem, type WindowChangeEvent, type ChangeAction } from './core/window.ts';
export { MCP, type MCPServerConfig } from './core/mcp.ts';
export { Pricing } from './core/pricing.ts';
export { Provider } from './provider/provider.ts';
export { DriftServer } from './server/index.ts';

// JSX runtime for window rendering
export { render, Fragment } from './jsx-runtime.ts';

// Storage (pluggable persistence)
export { SQLiteStorage } from './core/sqlite-storage.ts';
export type { Storage, SessionData } from './core/storage.ts';

// Auth (pluggable authentication)
export { NoAuth, TokenAuth } from './core/auth.ts';
export type { DriftAuth, DriftUser } from './core/auth.ts';

// Windows (domain-specific)
export { CodebaseWindow, type FileEntry, type CodebaseWindowOptions } from './windows/codebase-window.tsx';

// Built-in agents
export { DeveloperAgent } from './agents/developer.ts';
export { DeveloperLiteAgent } from './agents/developer-lite.ts';
export { PlaywrightAgent } from './agents/playwright.ts';
export { ResearcherAgent } from './agents/researcher.ts';

export { resolvePrompt, classNameToKebab } from './core/prompt.ts';
export {
    MODELS, DEFAULT_MODEL,
    getModel, getModelById, listModels,
    buildThinkingConfig, getBetaHeaders,
} from './provider/models.ts';

// Built-in tool utilities
export {
    ALL_TOOLS, EDIT_TOOLS, FILESYSTEM_TOOLS, SHELL_TOOLS,
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
