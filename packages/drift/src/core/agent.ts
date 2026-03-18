/**
 * Drift — Base Agent class
 * 
 * The core of the framework. Subclass this to create agents:
 * 
 *   class MyAgent extends Agent {
 *     model = 'sonnet';
 *     prompt = 'You help with tasks.';
 * 
 *     @tool('Do something', { param: { type: 'string', description: '...' } })
 *     async doSomething({ param }) { return { success: true, result: '...' }; }
 *   }
 * 
 *   const result = await new MyAgent().run('Hello');
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { ToolRegistry, defineTool as _defineTool } from '../decorators/tool.ts';
import { resolvePrompt } from './prompt.ts';
import { Conversation } from './conversation.ts';
import { Cache } from './cache.ts';
import { Window } from './window.ts';
import { Workspace } from './workspace.ts';
import { Pricing } from './pricing.ts';
import { Provider } from '../provider/provider.ts';
import {
    getModel, getModelById, DEFAULT_MODEL,
    buildThinkingConfig, listModels,
} from '../provider/models.ts';
import { registerBuiltinTools, registerSelectedTools } from '../tools/index.ts';
import type { DispatchFn } from './trigger.ts';
import type { WorkspaceChangeEvent } from './workspace.ts';
import type {
    AgentResult, AgentOptions, ToolSchema, ToolDefinition,
    ModelConfig, Effort, ContentBlock, StreamToolCall,
    StreamResult, ToolContext, ToolCall, Message,
} from '../types.ts';

// ── StreamBuilder (fluent API for stream()) ─────────

export class StreamBuilder extends EventEmitter {
    constructor() {
        super();
        // Default error handler to prevent crashes
        this.on('error', () => {});
    }

    /** Text token received */
    onText(fn: (chunk: string) => void): this {
        this.on('text', fn);
        return this;
    }

    /** Thinking token received */
    onThinking(fn: (text: string) => void): this {
        this.on('thinking', fn);
        return this;
    }

    /** Tool about to execute */
    onTool(fn: (info: { name: string; params: Record<string, any> }) => void): this {
        this.on('tool', fn);
        return this;
    }

    /** Tool finished */
    onToolResult(fn: (info: { name: string; result: any; ms: number }) => void): this {
        this.on('tool:result', fn);
        return this;
    }

    /** Cost update */
    onCost(fn: (info: { turn: number; total: number }) => void): this {
        this.on('cost', fn);
        return this;
    }

    /** Stream complete */
    onDone(fn: (result: AgentResult) => void): this {
        this.on('done', fn);
        return this;
    }

    /** Error occurred */
    onError(fn: (err: any) => void): this {
        this.on('error', fn);
        return this;
    }
}

// ── Agent ───────────────────────────────────────────

export class Agent extends EventEmitter {
    // ── Configurable properties (override in subclass) ──

    /** Model: 'opus' | 'sonnet' | 'haiku' or full model ID */
    model: string = DEFAULT_MODEL;

    /** System prompt (auto-loaded from file if not set) */
    prompt?: string;

    /** Extended thinking */
    thinking: boolean = true;

    /** Thinking effort: low | medium | high | max */
    effort: Effort = 'low';

    /** Max agentic loop iterations */
    maxIterations: number = 25;

    /** Max output tokens (auto-capped to model limit) */
    maxTokens?: number;

    /** Web search tool */
    webSearch: boolean | Record<string, any> = false;

    /** Cache — controls Anthropic prompt caching breakpoints */
    cache: Cache = new Cache();

    /** Reactive context window (CodebaseWindow, TradingWindow, etc.) */
    window?: Window<any>;

    /** Shared workspace — injected by DriftServer, shared across all agents */
    workspace?: Workspace<any>;

    /** Which workspace slices this agent sees in its prompt. null/undefined = all. */
    workspaceSlices?: string[];

    /** Enable dispatch_agent tool — allows this agent to invoke other agents. */
    canDispatch: boolean = false;

    /**
     * Workspace slices to subscribe to (Blackboard pattern).
     * When any subscribed slice changes, this agent is auto-dispatched.
     * Internally generates Trigger instances during server startup.
     * 
     * Simple: `subscribes = ['prices', 'signals']`
     * With config: `subscribes = [{ slice: 'prices', cooldown: 30_000 }]`
     */
    subscribes?: (string | { slice: string; cooldown?: number })[];

    /** Default cooldown for workspace subscriptions in ms. Default: 5000. */
    subscribeCooldown: number = 5_000;

    /**
     * Custom handler for workspace slice changes (Blackboard pattern).
     * Return the dispatch message, or null to skip the dispatch.
     * If not defined, a default message with the slice name and value is used.
     */
    onSliceChange?(slice: string, value: any, event: WorkspaceChangeEvent): string | null;

    /** Built-in tools to register. Categories: 'edit' | 'filesystem' | 'shell' | 'all', or individual names. Empty = none */
    builtinTools: string[] = [];

    /** Tool whitelist (null = all) */
    allowedTools: string[] | null = null;

    /** Tool blacklist (null = none) */
    disabledTools: string[] | null = null;

    /** Thinking budget (Haiku only) */
    thinkingBudget: number | null = null;

    /** @internal Dispatch function — injected by DriftServer for canDispatch agents. */
    _dispatchFn?: DispatchFn;

    // ── Internal state ──

    private _registry: ToolRegistry;
    private _conversation: Conversation;
    private _pricing: Pricing;
    private _provider: Provider;
    private _modelConfig: ModelConfig;
    private _resolvedPrompt: string = '';
    private _cwd: string;
    private _currentStream: any = null;
    private _aborted: boolean = false;
    private _lastWindowHash: string | null = null;
    private _maxTokensResolved: number;
    private _apiKey?: string;
    private _decoratorsCollected: boolean = false;

    constructor(options: AgentOptions = {}) {
        super();

        // Default error handler — prevents ERR_UNHANDLED_ERROR crash
        // Users can override by adding their own .on('error', ...) handler
        this.on('error', () => {});

        // Apply runtime options over class properties
        if (options.model) this.model = options.model;
        if (options.prompt) this.prompt = options.prompt;
        if (options.thinking !== undefined) this.thinking = options.thinking;
        if (options.effort) this.effort = options.effort;
        if (options.maxIterations) this.maxIterations = options.maxIterations;
        if (options.maxTokens) this.maxTokens = options.maxTokens;
        if (options.webSearch !== undefined) this.webSearch = options.webSearch;
        if (options.allowedTools) this.allowedTools = options.allowedTools;
        if (options.disabledTools) this.disabledTools = options.disabledTools;
        if (options.thinkingBudget) this.thinkingBudget = options.thinkingBudget;

        this._apiKey = options.apiKey;
        this._cwd = options.cwd || process.cwd();

        // Resolve model config
        this._modelConfig = getModel(this.model) || getModelById(this.model) || getModel(DEFAULT_MODEL)!;
        this._maxTokensResolved = Math.min(
            this.maxTokens || this._modelConfig.maxOutputTokens,
            this._modelConfig.maxOutputTokens
        );

        // Resolve prompt (file → inline → default)
        const className = this.constructor.name;
        const resolution = resolvePrompt(className, this.prompt, this._cwd);
        this._resolvedPrompt = resolution.prompt;

        // Create provider
        this._provider = new Provider(this._apiKey);

        // Create pricing tracker
        this._pricing = new Pricing(this._modelConfig);

        // Create conversation
        this._conversation = new Conversation();

        // Create tool registry
        this._registry = new ToolRegistry();
        this._registry.setFilters(this.allowedTools, this.disabledTools);

        // Register built-in tools (selective)
        if (this.builtinTools.length > 0) {
            if (this.builtinTools.includes('all')) {
                registerBuiltinTools(this._registry);
            } else {
                registerSelectedTools(this._registry, this.builtinTools);
            }
        }

        // NOTE: @tool decorated methods are collected lazily via _ensureDecorators()
        // because TC39 addInitializer runs AFTER super() returns.
    }

    // ── Public API ──────────────────────────────────────

    /**
     * Run the agent with a prompt and return the result.
     * Uses the agent's internal conversation (standalone mode).
     */
    async run(input: string, options: { timeout?: number } = {}): Promise<AgentResult> {
        return this.runWithConversation(input, this._conversation, options);
    }

    /**
     * Run the agent with an external conversation (Session mode).
     * The session owns the conversation — agent is stateless w.r.t. history.
     */
    async runWithConversation(input: string, conversation: Conversation, options: { timeout?: number } = {}): Promise<AgentResult> {
        const start = Date.now();
        this._aborted = false;

        let timer: ReturnType<typeof setTimeout> | undefined;
        if (options.timeout) {
            timer = setTimeout(() => this.abort(), options.timeout);
        }

        try {
            const result = await this._process(input, conversation);
            return {
                ...result,
                ok: !result.error && !result.aborted,
                duration: Date.now() - start,
                model: this._modelConfig.name,
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Stream agent responses. Returns a chainable StreamBuilder.
     * Uses the agent's internal conversation (standalone mode).
     */
    stream(input: string): StreamBuilder {
        return this.streamWithConversation(input, this._conversation);
    }

    /**
     * Stream agent responses with an external conversation (Session mode).
     */
    streamWithConversation(input: string, conversation: Conversation): StreamBuilder {
        const builder = new StreamBuilder();

        (async () => {
            const start = Date.now();

            const handlers: Record<string, (...args: any[]) => void> = {
                'text:delta': ({ chunk }: any) => builder.emit('text', chunk),
                'thinking:delta': ({ text }: any) => builder.emit('thinking', text),
                'tool:execute': ({ name, params }: any) => builder.emit('tool', { name, params }),
                'tool:result': ({ name, result, ms }: any) => builder.emit('tool:result', { name, result, ms }),
                'cost': ({ turnCost, totalCost }: any) => builder.emit('cost', { turn: turnCost, total: totalCost }),
                'error': (err: any) => builder.emit('error', err),
            };

            for (const [event, handler] of Object.entries(handlers)) {
                this.on(event, handler);
            }

            try {
                const raw = await this._process(input, conversation);
                const result: AgentResult = {
                    ...raw,
                    ok: !raw.error && !raw.aborted,
                    duration: Date.now() - start,
                    model: this._modelConfig.name,
                };
                builder.emit('done', result);
            } catch (err) {
                builder.emit('error', err);
            } finally {
                for (const [event, handler] of Object.entries(handlers)) {
                    this.removeListener(event, handler);
                }
            }
        })().catch(err => builder.emit('error', err));

        return builder;
    }

    /**
     * Abort current processing.
     */
    abort(): void {
        this._aborted = true;
        if (this._currentStream?.controller) {
            this._currentStream.controller.abort();
            this._currentStream = null;
        }
    }

    /**
     * Switch model at runtime.
     */
    switchModel(modelName: string): { success: boolean; message: string } {
        const newConfig = getModel(modelName);
        if (!newConfig) {
            return { success: false, message: `Unknown model: ${modelName}. Available: ${listModels().join(', ')}` };
        }

        this._modelConfig = newConfig;
        this.model = newConfig.id;
        this._maxTokensResolved = Math.min(this._maxTokensResolved, newConfig.maxOutputTokens);
        this._pricing.setModel(newConfig);

        return { success: true, message: `Switched to ${newConfig.name}` };
    }

    /**
     * Register an external tool.
     */
    registerTool(tool: ToolDefinition): boolean {
        return this._registry.register(tool);
    }

    /**
     * JS-compatible static defineTool.
     */
    static defineTool(methodName: string, description: string, schema: ToolSchema, required?: string[]): void {
        _defineTool(this, methodName, description, schema, required);
    }

    // ── Accessors ───────────────────────────────────────

    get modelConfig(): ModelConfig { return this._modelConfig; }
    get conversation(): Conversation { return this._conversation; }
    get pricing(): Pricing { return this._pricing; }
    get tools(): ToolRegistry { this._ensureDecorators(); return this._registry; }
    get cost(): number { return this._pricing.totalCost(); }
    get cwd(): string { return this._cwd; }

    // ── Lazy Decorator Collection ────────────────────────

    /**
     * Collect @tool decorated methods from this instance.
     * Deferred because TC39 addInitializer runs AFTER super() returns.
     */
    private _ensureDecorators(): void {
        if (this._decoratorsCollected) return;
        this._decoratorsCollected = true;
        this._registry.registerDecoratedTools(this);

        // Auto-register dispatch_agent tool when canDispatch is enabled
        if (this.canDispatch) {
            this._registry.register({
                name: 'dispatch_agent',
                description: 'Dispatch another agent to perform a task. The dispatched agent runs with access to the shared window and workspace, and returns its response as text.',
                schema: {
                    agent: { type: 'string', description: 'Name of the agent to dispatch (e.g. "task-agent", "reviewer")' },
                    message: { type: 'string', description: 'Instruction/message for the dispatched agent' },
                },
                required: ['agent', 'message'],
                execute: async (params: Record<string, any>, ctx: ToolContext) => {
                    if (!ctx.dispatch) {
                        return { success: false, result: 'Dispatch not available — agent must be running inside a DriftServer' };
                    }
                    try {
                        const result = await ctx.dispatch(params.agent, params.message, {
                            source: `agent:${this.constructor.name}`,
                        });
                        return {
                            success: true,
                            result: result.aborted
                                ? `Agent "${params.agent}" was aborted.`
                                : result.text || '(no response)',
                        };
                    } catch (err: any) {
                        return { success: false, result: `Dispatch failed: ${err.message}` };
                    }
                },
            });
        }
    }

    // ── Agentic Loop ────────────────────────────────────

    private async _process(input: string, conversation?: Conversation): Promise<Omit<AgentResult, 'ok' | 'duration' | 'model'>> {
        this._ensureDecorators();
        this._aborted = false;

        // Use provided conversation or fall back to internal
        const conv = conversation || this._conversation;
        conv.addUser(input);

        const state = { finalText: '', totalCost: 0, allToolCalls: [] as ToolCall[], lastError: null as string | null };

        for (let iter = 0; iter < this.maxIterations; iter++) {
            if (this._aborted) {
                return { text: state.finalText, cost: state.totalCost, toolCalls: state.allToolCalls, aborted: true };
            }

            const iterResult = await this._runIteration(state, conv);

            if (iterResult === 'abort') {
                return { text: state.finalText, cost: state.totalCost, toolCalls: state.allToolCalls, aborted: true };
            }
            if (iterResult === 'break') break;
            if (iterResult === 'fatal') break;
        }

        this._currentStream = null;
        return {
            text: state.finalText,
            cost: state.totalCost,
            toolCalls: state.allToolCalls,
            aborted: false,
            error: state.lastError || undefined,
        };
    }

    private async _runIteration(state: {
        finalText: string;
        totalCost: number;
        allToolCalls: ToolCall[];
        lastError: string | null;
    }, conversation: Conversation): Promise<'continue' | 'break' | 'abort' | 'fatal'> {
         // Advance window turn counter
        if (this.window) this.window.nextTurn();

        const messages = conversation.buildMessages();
        const system = this._buildSystemPrompt();
        const tools = this._getToolSchemas();

        // Apply cache breakpoints
        this.cache.applyToTools(tools);

        const requestParams = this._buildRequestParams(system, messages, tools);

        try {
            const stream = await this._provider.createStream(
                requestParams,
                this._modelConfig,
                { thinking: this.thinking }
            );
            this._currentStream = stream;

            const result = await this._processStream(stream);
            this.emit('response:end', {});

            // Record cost
            if (result.usage) {
                const turn = this._pricing.record(result.usage);
                state.totalCost = this._pricing.totalCost();
                this.emit('cost', {
                    turnCost: turn.cost,
                    totalCost: state.totalCost,
                    turns: this._pricing.turns.length,
                    usage: result.usage,
                });
            }

            // Build assistant content
            for (const tool of result.toolCalls) {
                const parsed = JSON.parse(tool.inputJson || '{}');
                result.assistantContent.push({
                    type: 'tool_use',
                    id: tool.id,
                    name: tool.name,
                    input: parsed,
                });
                state.allToolCalls.push({ name: tool.name, input: parsed });
            }

            if (result.assistantContent.length > 0) {
                conversation.addAssistant(result.assistantContent);
            }
            if (result.text) state.finalText = result.text;

            // No tools = done
            if (result.toolCalls.length === 0) return 'break';

            // Execute tools
            await this._executeTools(result.toolCalls, conversation);

            if (this._aborted) {
                return 'abort';
            }
            return 'continue';

        } catch (err: any) {
            if (err.name === 'AbortError' || this._aborted) {
                return 'abort';
            }
            state.lastError = err.message;
            this.emit('error', { message: err.message, status: err.status, recoverable: false });
            return 'fatal';
        }
    }

    // ── Stream Processing ───────────────────────────────

    private async _processStream(stream: any): Promise<StreamResult> {
        const result: StreamResult = {
            text: '',
            assistantContent: [],
            toolCalls: [],
            usage: null,
        };

        let currentToolCall: StreamToolCall | null = null;

        for await (const event of stream) {
            if (this._aborted) break;

            switch (event.type) {
                case 'content_block_start': {
                    const block = event.content_block;
                    if (block.type === 'thinking') {
                        this.emit('thinking:start', {});
                    } else if (block.type === 'text') {
                        this.emit('text:start', {});
                    } else if (block.type === 'tool_use') {
                        currentToolCall = { id: block.id, name: block.name, inputJson: '' };
                        this.emit('tool:start_stream', { toolId: block.id, name: block.name });
                    }
                    break;
                }

                case 'content_block_delta': {
                    const delta = event.delta;
                    if (delta.type === 'thinking_delta') {
                        this.emit('thinking:delta', { text: delta.thinking });
                    } else if (delta.type === 'text_delta') {
                        result.text += delta.text;
                        this.emit('text:delta', { chunk: delta.text });
                    } else if (delta.type === 'input_json_delta' && currentToolCall) {
                        currentToolCall.inputJson += delta.partial_json;
                    }
                    break;
                }

                case 'content_block_stop': {
                    if (currentToolCall) {
                        result.toolCalls.push(currentToolCall);
                        currentToolCall = null;
                    }
                    break;
                }

                case 'message_delta': {
                    // stop_reason available here
                    break;
                }

                case 'message_start': {
                    if (event.message?.usage) {
                        result.usage = event.message.usage;
                    }
                    break;
                }

                case 'message_stop': {
                    break;
                }
            }

            // Capture usage from message_delta
            if (event.usage) {
                result.usage = {
                    ...result.usage,
                    ...event.usage,
                } as any;
            }
        }

        // Add text to assistant content
        if (result.text) {
            result.assistantContent.push({ type: 'text', text: result.text });
        }

        return result;
    }

    // ── Tool Execution ──────────────────────────────────

    private async _executeTools(toolCalls: StreamToolCall[], conversation: Conversation): Promise<void> {
        for (const toolCall of toolCalls) {
            if (this._aborted) break;

            const params = JSON.parse(toolCall.inputJson || '{}');
            this.emit('tool:execute', { name: toolCall.name, params });

            const start = Date.now();
            const ctx: ToolContext = { cwd: this._cwd, window: this.window, workspace: this.workspace, dispatch: this._dispatchFn };

            try {
                const result = await this._registry.execute(toolCall.name, params, ctx);
                const ms = Date.now() - start;

                this.emit('tool:result', { name: toolCall.name, result, ms });

                // Add tool result to conversation
                const resultText = typeof result === 'string'
                    ? result
                    : (result as any)?.result || JSON.stringify(result);
                conversation.addToolResult(toolCall.id, toolCall.name, resultText, !(result as any)?.success);

            } catch (err: any) {
                const ms = Date.now() - start;
                this.emit('tool:result', { name: toolCall.name, result: { success: false, result: err.message }, ms });
                conversation.addToolResult(toolCall.id, toolCall.name, `Error: ${err.message}`, true);
            }
        }
    }

    // ── System Prompt Building ───────────────────────────

    private _buildSystemPrompt(): any[] {
        const entries: any[] = [];

        // Block 1: Base prompt
        entries.push({ type: 'text', text: this._resolvedPrompt });

        // Block 2: Workspace slices (shared state — before window)
        if (this.workspace) {
            const workspaceContent = this.workspace.render(this.workspaceSlices);
            if (workspaceContent) {
                entries.push({ type: 'text', text: workspaceContent });
            }
        }

        // Block 3: Window content (if available)
        if (this.window) {
            const windowContent = this.window.render();
            if (windowContent) {
                entries.push({ type: 'text', text: windowContent });
            }
        }

        // Apply cache breakpoints to system blocks
        return this.cache.applyToSystem(entries);
    }

    // ── Tool Schemas ────────────────────────────────────

    private _getToolSchemas(): any[] {
        const schemas = this._registry.getSchemas();

        // Add web search if enabled
        if (this.webSearch) {
            const searchTool: any = {
                type: 'web_search_20250305',
                name: 'web_search',
            };
            if (typeof this.webSearch === 'object') {
                const ws = this.webSearch as Record<string, any>;
                if (ws.max_uses) searchTool.max_uses = ws.max_uses;
                if (ws.allowed_domains) searchTool.allowed_domains = ws.allowed_domains;
                if (ws.blocked_domains) searchTool.blocked_domains = ws.blocked_domains;
            }
            schemas.push(searchTool);
        }

        return schemas;
    }

    // ── Request Params ──────────────────────────────────

    private _buildRequestParams(system: any[], messages: Message[], tools: any[]): Record<string, any> {
        const params: Record<string, any> = {
            model: this._modelConfig.id,
            max_tokens: this._maxTokensResolved,
            system,
            messages,
            tools,
            stream: true,
        };

        // Thinking config
        const thinkingConfig = buildThinkingConfig(this._modelConfig, {
            thinking: this.thinking,
            maxTokens: this._maxTokensResolved,
            thinkingBudget: this.thinkingBudget,
            effort: this.effort,
        });
        if (thinkingConfig) {
            params.thinking = thinkingConfig;
        }

        // Effort (adaptive thinking only)
        if (this.thinking && this.effort && this.effort !== 'low' && this._modelConfig.thinkingMode === 'adaptive') {
            params.output_config = { effort: this.effort };
        }

        return params;
    }

    // ── Static hash util ────────────────────────────────

    static _quickHash(str: string): string {
        return crypto.createHash('md5').update(str).digest('hex');
    }
}
