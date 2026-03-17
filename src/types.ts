/**
 * Drift — Type definitions
 */

// ── Tool Types ──────────────────────────────────────

export interface ToolParamSchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    items?: { type: string };
    enum?: string[];
}

export interface ToolSchema {
    [paramName: string]: ToolParamSchema;
}

export interface ToolDefinition {
    name: string;
    description: string;
    schema: ToolSchema;
    required: string[];
    execute: (params: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
    success: boolean;
    result: string;
}

export interface ToolContext {
    cwd: string;
    window?: any;   // Window<any, any> — kept as `any` to avoid circular import
    diffTracker?: DiffTracker;
    conversation?: any;
    [key: string]: any;
}

// ── Window Context (legacy interface — use Window<T,S> class instead) ──

export interface WindowFile {
    path: string;
    content: string;
    lines: number;
    disabled: boolean;
}

export interface WindowContext {
    files: Map<string, WindowFile>;
    open(filePath: string): void;
    close(filePath: string): void;
    refresh(filePath: string): void;
    refreshAll(): void;
    has(filePath: string): boolean;
    buildContent(): string;
    buildMetadata(): string;
    stats(): { files: number; totalLines: number };
    nextTurn(): void;
}

// ── Diff Tracker ────────────────────────────────────

export interface DiffEntry {
    filePath: string;
    fullPath: string;
    operation: string;
    oldContent: string | null;
    newContent: string;
    description: string;
}

export interface DiffTracker {
    record(entry: DiffEntry): void;
    printToolDiff(entry: DiffEntry): void;
}

// ── Model Types ─────────────────────────────────────

export interface ModelPricing {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
}


export interface ModelConfig {
    id: string;
    name: string;
    shortName: string;
    maxOutputTokens: number;
    contextWindow: number;
    thinkingMode: 'adaptive' | 'enabled';
    thinkingPreserved: boolean;
    interleavedThinkingAuto: boolean;
    pricing: ModelPricing;
}

export type ThinkingConfig =
    | { type: 'adaptive' }
    | { type: 'enabled'; budget_tokens: number }
    | null;

export type Effort = 'low' | 'medium' | 'high' | 'max';

// CacheConfig removed — replaced by Cache class

// ── Agent Config ────────────────────────────────────

export interface AgentOptions {
    model?: string;
    prompt?: string;
    thinking?: boolean;
    effort?: Effort;
    maxIterations?: number;
    maxTokens?: number;
    webSearch?: boolean | WebSearchConfig;
    allowedTools?: string[] | null;
    disabledTools?: string[] | null;
    apiKey?: string;
    cwd?: string;
    thinkingBudget?: number | null;
}

export interface WebSearchConfig {
    max_uses?: number;
    allowed_domains?: string[];
    blocked_domains?: string[];
    user_location?: Record<string, string>;
}

// ── Agent Result ────────────────────────────────────

export interface AgentResult {
    text: string;
    cost: number;
    toolCalls: ToolCall[];
    aborted: boolean;
    ok: boolean;
    error?: string;
    duration: number;
    model: string;
}

export interface ToolCall {
    name: string;
    input: Record<string, any>;
}

// ── Messages ────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export interface TextBlock {
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
}

export interface ThinkingBlock {
    type: 'thinking';
    thinking: string;
    signature?: string;
}

export interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, any>;
}

export interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
    role: MessageRole;
    content: string | ContentBlock[];
}

// ── Stream Events ───────────────────────────────────

export interface StreamToolCall {
    id: string;
    name: string;
    inputJson: string;
}

export interface StreamResult {
    text: string;
    assistantContent: ContentBlock[];
    toolCalls: StreamToolCall[];
    usage: ApiUsage | null;
}

export interface ApiUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

// ── Pricing ─────────────────────────────────────────

export interface PricingTurn {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    cacheSavings: number;
}
