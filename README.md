# Drift

Hyper-minimalist TypeScript agent framework. Class-based agents, `@tool` decorators, streaming, multi-turn conversations.

```typescript
import { Agent, tool } from 'drift';

class SearchAgent extends Agent {
    model = 'sonnet';

    @tool('Search the database', {
        query: { type: 'string', description: 'Search query' },
    })
    async search({ query }: { query: string }) {
        const results = await db.find(query);
        return { success: true, result: JSON.stringify(results) };
    }
}

const agent = new SearchAgent();
const result = await agent.run('Find all users named John');
console.log(result.text);   // "I found 3 users named John..."
console.log(result.cost);   // 0.003241
```

> **Requirements**: Node ≥ 20 · `ANTHROPIC_API_KEY` env var

---

## Table of Contents

- [Installation](#installation)
- [Agent](#agent)
  - [Class Properties](#class-properties)
  - [Constructor Options](#constructor-options)
  - [run()](#runsinput-options-promiseagentresult)
  - [stream()](#streaminput-eventemitter)
  - [abort()](#abort-void)
  - [switchModel()](#switchmodelmodelname-success-message-)
  - [registerTool()](#registertooltooldefinition-boolean)
  - [Accessors](#accessors)
  - [Events](#events)
- [Session](#session)
  - [Lifecycle](#lifecycle)
  - [Swap Agent](#swap-agent-keep-history)
  - [Persistence](#persistence)
  - [WebSocket Protocol](#websocket-protocol)
  - [React (useSessions)](#react-usesessions)
- [Built-in Agents (4)](#built-in-agents-4)
- [Multi-Turn Conversations](#multi-turn-conversations)
- [@tool Decorator](#tool-decorator)
  - [Syntax](#syntax)
  - [Parameter Schema Types](#parameter-schema-types)
  - [Required vs Optional Parameters](#required-vs-optional-parameters)
  - [Tool Return Value](#tool-return-value)
  - [Inheritance](#inheritance)
  - [defineTool() — JS API](#definetool--js-api)
- [ToolRegistry](#toolregistry)
- [Conversation](#conversation)
- [Pricing](#pricing)
- [Cache](#cache)
- [Window](#window)
  - [Window Base Class](#window-base-class)
  - [State (React-like)](#state-react-like)
  - [Events](#events-1)
  - [CodebaseWindow](#codebasewindow)
  - [UI Sync (useWindow)](#ui-sync-usewindow)
  - [Custom Windows](#custom-windows)
  - [Serialization & Persistence](#serialization--persistence)
  - [Disabling (Token Saving)](#disabling-token-saving)
- [Drift Server](#drift-server)
  - [drift.config.json](#driftconfigjson)
  - [CLI](#cli)
  - [Dev Mode](#dev-mode)
  - [Static UI Serving](#static-ui-serving)
  - [WebSocket Protocol](#websocket-protocol)
- [drift-react](#drift-react)
  - [DriftProvider](#driftprovider)
  - [useChat()](#usechatagentname-options)
    - [nudge()](#nudge--ui-triggered-agent-explanations)
  - [useThread()](#usethreadoptions--contextual-mini-chats)
  - [useSessions()](#usesessions)
  - [useWindow()](#usewindow)
  - [useDrift()](#usedrift)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
- [Models](#models)
  - [Thinking Configuration](#thinking-configuration)
  - [Beta Headers](#beta-headers)
- [Prompt Resolution](#prompt-resolution)
- [Built-in Tools (16)](#built-in-tools-16)
  - [builtinTools — Selective Registration](#builtintools--selective-registration)
  - [Tool Filtering](#tool-filtering)
- [Web Search](#web-search)
- [Provider](#provider)
- [Types Reference](#types-reference)
- [Authentication](#authentication)
  - [Quick Protect (SecretAuth)](#quick-protect-standalone-apps)
  - [Token Validation (TokenAuth)](#token-validation-jwt-api-keys)
  - [Custom Auth](#custom-auth-nextauth-clerk-etc)
  - [Per-Agent Access Control](#per-agent-access-control)
- [Embedding (attach)](#embedding-attach)
- [Persistence](#persistence)
- [Project Structure](#project-structure)
- [Examples](#examples)
- [Development](#development)

---

## Installation

```bash
git clone <repo>
cd drift
nvm use 24 
npm install
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Run an example:

```bash
npx tsx examples/basic/quick.ts
```

---

## Agent

The core class. Extend it to create agents with custom tools and configuration.

```typescript
import { Agent, tool } from 'drift';

class MyAgent extends Agent {
    model = 'sonnet';
    prompt = 'You are a helpful assistant.';

    @tool('Greet someone', {
        name: { type: 'string', description: 'Name to greet' },
    })
    async greet({ name }: { name: string }) {
        return { success: true, result: `Hello, ${name}!` };
    }
}
```

`Agent` extends Node.js `EventEmitter`, so you can listen to events on any agent instance.

### Class Properties

Override these in your subclass to configure the agent:

| Property | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `'sonnet'` | Model name: `'opus'`, `'sonnet'`, `'haiku'`, or full model ID like `'claude-sonnet-4-6'` |
| `prompt` | `string \| undefined` | `undefined` | System prompt. If not set, auto-loaded from `prompts/` directory (see [Prompt Resolution](#prompt-resolution)) |
| `thinking` | `boolean` | `true` | Enable extended thinking (chain-of-thought) |
| `effort` | `Effort` | `'low'` | Thinking effort: `'low'` \| `'medium'` \| `'high'` \| `'max'` |
| `maxIterations` | `number` | `25` | Max agentic loop iterations (tool call → response cycles) |
| `maxTokens` | `number \| undefined` | Model's max | Max output tokens per API call. Auto-capped to model limit |
| `webSearch` | `boolean \| WebSearchConfig` | `false` | Enable Claude web search tool (see [Web Search](#web-search)) |
| `cache` | `Cache` | `new Cache()` | Prompt caching config (see [Cache](#cache)) |
| `builtinTools` | `string[]` | `[]` | Built-in tools to register: categories (`'all'`, `'edit'`, `'filesystem'`, `'shell'`) or individual names (see [builtinTools](#builtintools--selective-registration)) |
| `allowedTools` | `string[] \| null` | `null` | Whitelist of tool names to enable. `null` = all tools |
| `disabledTools` | `string[] \| null` | `null` | Blacklist of tool names to disable |
| `thinkingBudget` | `number \| null` | `null` | Manual thinking token budget (Haiku only) |

### Constructor Options

Every class property can also be set via constructor `AgentOptions`:

```typescript
const agent = new MyAgent({
    model: 'haiku',
    prompt: 'Override the class prompt',
    thinking: false,
    effort: 'high',
    maxIterations: 10,
    maxTokens: 4096,
    webSearch: { max_uses: 3, allowed_domains: ['docs.anthropic.com'] },
    allowedTools: ['create_file', 'list_dir', 'greet'],
    disabledTools: null,
    thinkingBudget: 50000,
    apiKey: 'sk-ant-...',          // Default: ANTHROPIC_API_KEY env var
    cwd: '/path/to/project',       // Default: process.cwd()
});
```

Constructor options override class properties. Class properties override defaults.

### `run(input, options?): Promise<AgentResult>`

Send a message and wait for the complete response. The agent will loop through tool calls automatically until it produces a final text response or hits `maxIterations`.

```typescript
const result = await agent.run('Create a file called hello.txt with "Hello World"');
```

**Options:**

| Option | Type | Description |
|---|---|---|
| `timeout` | `number` | Auto-abort after N milliseconds |

**Returns `AgentResult`:**

```typescript
{
    text: string;         // Final response text
    ok: boolean;          // true if completed without error/abort
    cost: number;         // Total USD cost for this run
    duration: number;     // Wall time in milliseconds
    model: string;        // Model name used (e.g. 'Sonnet 4.6')
    toolCalls: ToolCall[];// All tools called: [{ name, input }]
    aborted: boolean;     // Whether run was aborted
    error?: string;       // Error message if failed
}
```

**With timeout:**

```typescript
const result = await agent.run('Long task...', { timeout: 30000 });
if (result.aborted) console.log('Timed out');
```

### `stream(input): StreamBuilder`

Start streaming and receive tokens in real-time. Returns a chainable `StreamBuilder`.

**Fluent API (ActiveRecord-style):**

```typescript
agent.stream('Write a poem about TypeScript')
    .onText(chunk => process.stdout.write(chunk))
    .onThinking(text => console.log('💭', text))
    .onTool(({ name, params }) => console.log(`Calling ${name}...`))
    .onToolResult(({ name, ms }) => console.log(`${name} done in ${ms}ms`))
    .onCost(({ total }) => console.log(`Total: $${total}`))
    .onDone(result => console.log('Final:', result.text))
    .onError(err => console.error('Error:', err));
```

**StreamBuilder methods:**

| Method | Callback Signature | Description |
|---|---|---|
| `.onText(fn)` | `(chunk: string)` | Text token received |
| `.onThinking(fn)` | `(text: string)` | Thinking token received |
| `.onTool(fn)` | `({ name, params })` | Tool about to execute |
| `.onToolResult(fn)` | `({ name, result, ms })` | Tool finished |
| `.onCost(fn)` | `({ turn, total })` | Cost update |
| `.onDone(fn)` | `(result: AgentResult)` | Stream complete |
| `.onError(fn)` | `(err: any)` | Error occurred |

All methods return `this` for chaining. `StreamBuilder` extends `EventEmitter`, so `.on('text', ...)` still works too.

### `abort(): void`

Abort the current `run()` or `stream()`. Safe to call at any time.

```typescript
// Abort after 5 seconds
setTimeout(() => agent.abort(), 5000);
const result = await agent.run('Long running task...');
console.log(result.aborted); // true
```

### `switchModel(modelName): { success, message }`

Switch the model at runtime. Pricing recalculates automatically.

```typescript
agent.switchModel('opus');
// { success: true, message: 'Switched to Opus 4.6' }

agent.switchModel('gpt-4');
// { success: false, message: 'Unknown model: gpt-4. Available: opus, sonnet, haiku' }
```

If the new model doesn't support 1M context, `extendedContext` is auto-disabled.

### `registerTool(tool: ToolDefinition): boolean`

Register a tool dynamically at runtime (instead of using `@tool` decorator):

```typescript
agent.registerTool({
    name: 'fetch_url',
    description: 'Fetch content from a URL',
    schema: {
        url: { type: 'string', description: 'URL to fetch' },
    },
    required: ['url'],
    execute: async (params, ctx) => {
        const res = await fetch(params.url);
        const text = await res.text();
        return { success: true, result: text.slice(0, 5000) };
    },
});
```

### Accessors

Read-only properties on agent instances:

```typescript
agent.modelConfig    // ModelConfig — current model configuration object
agent.conversation   // Conversation — message history manager
agent.pricing        // Pricing — per-session cost tracker
agent.tools          // ToolRegistry — all registered tools
agent.cost           // number — total cost in USD (shortcut for pricing.totalCost())
agent.cwd            // string — working directory
```

### Events

`Agent` extends `EventEmitter`. Subscribe with `agent.on(event, handler)`:

| Event | Payload | Description |
|---|---|---|
| `text:start` | `{}` | A new text output block begins |
| `text:delta` | `{ chunk: string }` | Text token received from API |
| `thinking:start` | `{}` | A new thinking block begins |
| `thinking:delta` | `{ text: string }` | Thinking token received |
| `tool:start_stream` | `{ toolId: string, name: string }` | Tool call starts streaming from API |
| `tool:execute` | `{ name: string, params: object }` | Tool is about to be executed locally |
| `tool:result` | `{ name: string, result: ToolResult, ms: number }` | Tool execution complete |
| `cost` | `{ turnCost: number, totalCost: number, turns: number, usage: ApiUsage }` | Cost recorded for API turn |
| `response:end` | `{}` | API response stream fully consumed |
| `error` | `{ message: string, status?: number, recoverable: boolean }` | Error occurred. Agent has a default handler so errors don't crash the process — override with your own `.on('error', ...)` |

---

## Session

A `Session` owns a `Conversation` and delegates execution to an `Agent`. Agents are stateless — history lives in the session. Multiple sessions can run in parallel with the same or different agents.

### Lifecycle

```typescript
import { Session } from 'drift';

const session = new Session(agent);       // auto-generates UUID
await session.run('Hello!');              // agent runs with session's conversation
await session.run('Follow-up question');  // same history, multi-turn
session.clear();                          // reset conversation
```

### Swap Agent (keep history)

```typescript
session.swap(otherAgent);
await session.run('Continue with different model');
```

### Persistence

Sessions are **automatically persisted** by `DriftServer` when using a `Storage` backend (SQLite by default):

- **Saved after each `chat:send`** — session metadata, full message history, and window state
- **Restored on server restart** — sessions re-appear with their conversation history intact
- **Deleted** via `sessions:delete` WebSocket action or when `storage.deleteSession(id)` is called

```
User sends message → Session.run() → Agent processes
                                       ↓
                              Conversation updated
                                       ↓
                    storage.saveSession() + storage.saveMessages()
                                       ↓
Server restart → storage.listSessions() → sessions restored with history
```

To disable persistence: `new DriftServer({ storage: false })`.

### WebSocket Protocol

The server manages sessions via these WS actions:

| Action | Payload | Response Event | Description |
|--------|---------|---------------|-------------|
| `sessions:list` | — | `sessions:list` | List all active sessions |
| `sessions:create` | `{ agent }` | `sessions:created` | Create new session for agent |
| `sessions:delete` | `{ sessionId }` | `sessions:deleted` | Delete session + persisted data |
| `chat:send` | `{ sessionId, agent, message }` | `chat:done` | Send message (auto-creates session) |
| `chat:history` | `{ sessionId }` | `chat:history` | Get full conversation history |
| `chat:clear` | `{ sessionId }` | `chat:cleared` | Clear conversation |
| `chat:swap` | `{ sessionId, agent }` | `chat:swapped` | Swap agent within session |

If `chat:send` is called without an existing `sessionId`, a new session is created automatically.

### React (`useSessions()`)

```typescript
import { useSessions } from 'drift-react';

function SessionList() {
    const { sessions, createSession, deleteSession } = useSessions();

    return sessions.map(s => (
        <div key={s.id}>
            {s.agentName} — {s.messageCount} msgs
            <button onClick={() => deleteSession(s.id)}>Delete</button>
        </div>
    ));
}
```

### API Reference

| Method/Property | Type | Description |
|---|---|---|
| `run(message)` | `Promise<AgentResult>` | Run agent with session's conversation |
| `stream(message)` | `StreamBuilder` | Stream agent with session's conversation |
| `swap(agent)` | `void` | Replace agent, keep conversation |
| `abort()` | `void` | Abort current run |
| `clear()` | `void` | Clear conversation history |
| `toJSON()` | `SessionData` | Serialize for persistence |
| `id` | `string` | Session UUID |
| `agent` | `Agent` | Current agent |
| `conversation` | `Conversation` | Session's conversation |
| `isRunning` | `boolean` | Whether a run is in progress |
| `createdAt` | `number` | Creation timestamp |

---

## Built-in Agents (4)

Drift ships with 4 pre-configured agents. Each has a baked-in system prompt and selective built-in tools.

| Agent | `builtinTools` | Description |
|---|---|---|
| `DeveloperAgent` | `['all']` (16 tools) | Full developer — edit, filesystem, shell |
| `DeveloperLiteAgent` | `['edit', 'filesystem']` (11) | Edit + filesystem — no shell access |
| `PlaywrightAgent` | `['edit', 'filesystem']` + MCP browser_* | Browser automation via Playwright MCP |
| `ResearcherAgent` | 6 read-only tools | Code investigation — no editing |


### DeveloperAgent

Full coding agent with all 16 built-in tools.

```typescript
import { DeveloperAgent } from 'drift';

const agent = new DeveloperAgent();
const result = await agent.run('Add error handling to auth.ts');
```

**Defaults:** `model = 'sonnet'`, `thinking = true`, `effort = 'low'`, `maxIterations = 25`, `builtinTools = ['all']`

Extend with custom tools (they combine with built-in tools):

```typescript
class MyDevAgent extends DeveloperAgent {
    model = 'opus';

    @tool('Deploy to staging', { env: { type: 'string', description: 'Target env' } })
    async deploy({ env }: { env: string }) {
        return { success: true, result: `Deployed to ${env}` };
    }
}
```

### DeveloperLiteAgent

Safer version — edit + filesystem tools only, no shell access:

```typescript
import { DeveloperLiteAgent } from 'drift';
const agent = new DeveloperLiteAgent();
await agent.run('Refactor the auth module');
```

### PlaywrightAgent

Browser automation powered by Playwright MCP. Must call `connect()` before use:

```typescript
import { PlaywrightAgent } from 'drift';

const agent = new PlaywrightAgent();
await agent.connect();  // spawns Playwright MCP server, discovers browser_* tools

const result = await agent.run('Go to example.com and fill the login form');
await agent.close();    // cleanup
```

Custom MCP command:

```typescript
await agent.connect({ command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless'] });
```

### ResearcherAgent

Read-only code investigation. Cannot edit files or run shell commands:

```typescript
import { ResearcherAgent } from 'drift';

const agent = new ResearcherAgent();
const result = await agent.run('How does the auth flow work?');
// → Structured investigation report with file:line references
```

**Tools:** `open_files`, `close_files`, `find_by_name`, `grep_search`, `list_dir`, `project_tree`

---

## Multi-Turn Conversations

The same agent instance maintains conversation history across multiple `run()` calls:

```typescript
const agent = new MyAgent();

await agent.run('Save a note called "shopping" with "milk, bread, eggs"');
await agent.run('What did I just save?');  // Remembers the previous turn
await agent.run('Show me all my notes');   // Full context of all turns

// Access history
console.log(agent.conversation.length);     // Number of messages
console.log(agent.conversation.messages);   // Full message array (readonly)
console.log(agent.cost);                    // Accumulated cost across all turns
```

The agent sends the full conversation history on each API call, so the LLM has context of all previous turns. Conversation auto-truncates at 100 messages (keeps first + last 6).

To start fresh: `agent.conversation.clear()`.

---

## @tool Decorator

Mark class methods as tools that the LLM can call. This is the primary way to give agents capabilities.

### Syntax

```typescript
@tool(description, schema, required?)
```

| Argument | Type | Description |
|---|---|---|
| `description` | `string` | What the tool does — shown to the LLM |
| `schema` | `ToolSchema` | Parameter definitions: `{ paramName: ToolParamSchema }` |
| `required` | `string[]` | Optional: which params are required. Default: all keys in schema |

### Parameter Schema Types

Each parameter is defined with `{ type, description }` and optional constraints:

```typescript
class MyAgent extends Agent {
    @tool('Process data', {
        // String parameter
        name: { type: 'string', description: 'Resource name' },

        // Number parameter
        count: { type: 'number', description: 'How many items' },

        // Boolean parameter
        force: { type: 'boolean', description: 'Skip confirmation' },

        // Array parameter
        tags: { type: 'array', description: 'Tags to apply', items: { type: 'string' } },

        // Object parameter
        config: { type: 'object', description: 'Additional configuration' },

        // String with enum constraint
        status: { type: 'string', description: 'Filter by status', enum: ['active', 'archived', 'draft'] },
    })
    async processData(params: {
        name: string;
        count: number;
        force?: boolean;
        tags?: string[];
        config?: Record<string, any>;
        status?: 'active' | 'archived' | 'draft';
    }) {
        return { success: true, result: `Processed ${params.name}` };
    }
}
```

`ToolParamSchema` fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'string' \| 'number' \| 'boolean' \| 'array' \| 'object'` | ✅ | Parameter type |
| `description` | `string` | ✅ | Shown to the LLM |
| `items` | `{ type: string }` | Only for `array` | Array element type |
| `enum` | `string[]` | No | Allowed values (string type only) |

### Required vs Optional Parameters

By default, **all schema keys are required**. Override with the third `required` argument:

```typescript
@tool('Search for documents', {
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Max results to return' },
    page:  { type: 'number', description: 'Pagination page number' },
    sort:  { type: 'string', description: 'Sort field', enum: ['date', 'relevance'] },
}, ['query'])  // ← Only 'query' is required
async search({ query, limit = 10, page = 1, sort = 'relevance' }) { ... }
```

Pass an empty array `[]` to make all parameters optional:

```typescript
@tool('List all items', {
    category: { type: 'string', description: 'Filter by category' },
}, [])  // ← All params optional
async listItems({ category }: { category?: string }) { ... }
```

### Tool Return Value

Tools **must** return `{ success: boolean, result: string }`:

```typescript
// Success — result text is shown to the LLM
return { success: true, result: 'File created at /path/to/file.txt' };

// Error — result text is shown to the LLM as an error, it may retry
return { success: false, result: 'Error: file not found at that path' };
```

The `result` string is what the LLM sees. Make it descriptive — the LLM uses this to decide its next action.

### Inheritance

Tools are inherited through the class prototype chain:

```typescript
class BaseAgent extends Agent {
    @tool('Shared health check', {
        url: { type: 'string', description: 'URL to check' },
    })
    async healthCheck({ url }: { url: string }) {
        return { success: true, result: `${url}: healthy` };
    }
}

class DeployAgent extends BaseAgent {
    @tool('Deploy a service', {
        service: { type: 'string', description: 'Service name' },
        version: { type: 'string', description: 'Version tag' },
    })
    async deploy({ service, version }: { service: string; version: string }) {
        return { success: true, result: `Deployed ${service}@${version}` };
    }
    // ✅ Also has healthCheck from BaseAgent
}
```

### defineTool() — JS API

For JavaScript projects or environments without decorator support, use `defineTool()`:

```typescript
import { Agent, defineTool } from 'drift';

class MyAgent extends Agent {
    async myMethod({ query }: { query: string }) {
        return { success: true, result: `Found: ${query}` };
    }
}

// Register without decorators
defineTool(MyAgent, 'myMethod', 'Search for things', {
    query: { type: 'string', description: 'Search query' },
});

// Optional: specify required params
defineTool(MyAgent, 'otherMethod', 'Other action', {
    name: { type: 'string', description: 'Name' },
    force: { type: 'boolean', description: 'Force' },
}, ['name']);  // only name is required
```

> **Note**: Decorator metadata is collected lazily on first `run()`, `stream()`, or `tools` access. This handles both TC39 stage-3 and legacy `experimentalDecorators` runtimes automatically.

---

## ToolRegistry

Manages all registered tools — both built-in and custom. Accessible via `agent.tools`.

```typescript
const registry = agent.tools;

// Query
registry.has('create_file')             // boolean — is tool registered?
registry.list()                          // string[] — all registered tool names
registry.size                            // number — total tool count

// Schemas (Claude API format)
registry.getSchemas()                    // { name, description, input_schema }[]

// Register a raw tool definition
registry.register({
    name: 'my_tool',
    description: 'Does something useful',
    schema: { input: { type: 'string', description: 'Input data' } },
    required: ['input'],
    execute: async (params, ctx) => ({ success: true, result: 'done' }),
});

// Filter
registry.setFilters(
    ['list_dir', 'grep_search'],    // allowedTools whitelist (null = all)
    ['shell_execute'],               // disabledTools blacklist (null = none)
);

// Execute a tool directly
const result = await registry.execute('my_tool', { input: 'hello' }, { cwd: '/tmp' });
// Throws if tool not found or required param missing
```

`registerDecoratedTools(instance)` collects `@tool` metadata from the instance and registers all decorated methods. Called automatically by the agent.

---

## Conversation

Message history manager. Auto-deduplicates, groups tool results, smart trim. Accessible via `agent.conversation`.

```typescript
const conv = agent.conversation;

// Read state
conv.length                              // number — message count
conv.messages                            // readonly Message[] — full history
conv.maxMessages                         // number — max before auto-trim (default: 100)
conv.autoTrim                            // boolean — auto-trim enabled (default: true)

// Modify
conv.addUser('Hello');                   // Add a user message
conv.addAssistant([                      // Add an assistant message (content blocks)
    { type: 'text', text: 'Hi there!' },
]);
conv.addToolResult(                      // Add a tool result
    'toolu_01XYZ',                       // tool_use_id from API
    'create_file',                       // tool name
    'File created successfully',         // result text
    false,                               // isError
);

// Build messages for API call
conv.buildMessages()                     // Message[] — API-ready array

// Smart trim — keeps last N messages, preserves tool pairs
conv.trim(20)                            // TrimStats { before, after, removed }

// Reset
conv.clear()                             // Clear all history
```

### Smart Trim

The `trim()` method intelligently trims old messages while preserving API-required invariants:

```typescript
const stats = agent.conversation.trim(10); // Keep last ~10 messages
console.log(stats); // { before: 45, after: 12, removed: 33 }
```

**Trim rules:**
1. Never orphans `tool_result` — walks backwards to include the paired `tool_use` assistant message
2. Never starts on an assistant message with `tool_use` — includes its preceding user message
3. Always starts on a `user` message (API requirement)
4. Post-trim cleanup removes any orphan `tool_result` messages at the start

**Auto-trim:** When `autoTrim` is enabled (default), the conversation automatically trims to 75% of `maxMessages` when the limit is exceeded. This creates runway so it doesn't trim on every message.

```typescript
// Configure auto-trim
const agent = new MyAgent();
agent.conversation.maxMessages = 50;  // Trim at 50 messages
agent.conversation.autoTrim = true;   // Enable (default)
// When history exceeds 50 msgs → auto-trims to ~37 msgs
```

**Automatic behaviors:**

| Behavior | Description |
|---|---|
| **Dedup** | Consecutive identical user messages are collapsed to one |
| **Tool result grouping** | Multiple tool results from one turn are grouped into a single user message |
| **User-first** | `buildMessages()` ensures the first message has role `user` |
| **Auto-trim** | Trims to 75% capacity when `maxMessages` exceeded (preserving tool pairs) |

---

## Pricing

Per-session cost tracking with per-turn breakdown and cache savings. Accessible via `agent.pricing`.

```typescript
const pricing = agent.pricing;

// Read
pricing.totalCost()                     // number — total USD cost
pricing.formatCost()                    // string — "$0.0034" or "$1.25"
pricing.turns                           // PricingTurn[] — per-turn records
pricing.totals                          // { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, cost }

// Modify
pricing.setModel(newModelConfig)        // Recalculate pricing for a different model
pricing.reset()                         // Clear all tracking

// Shortcut
agent.cost                              // Same as agent.pricing.totalCost()
```

Each `PricingTurn`:

```typescript
{
    cost: number;            // USD cost for this single turn
    inputTokens: number;     // Input tokens consumed
    outputTokens: number;    // Output tokens generated
    cacheWriteTokens: number;// Tokens written to cache
    cacheReadTokens: number; // Tokens read from cache
    cacheSavings: number;    // USD saved by cache hits
}
```

Pricing uses standard rates for all context sizes (1M context is GA — no surcharge).

---

## Models

Three Claude models supported. Use short names or full IDs.

| Short Name | Full ID | Max Output | Context | Thinking | Input/MTok | Output/MTok |
|---|---|---|---|---|---|---|
| `opus` | `claude-opus-4-6` | 128K | **1M** | Adaptive | $5.00 | $25.00 |
| `sonnet` | `claude-sonnet-4-6` | 64K | **1M** | Adaptive | $3.00 | $15.00 |
| `haiku` | `claude-haiku-4-5-20251001` | 64K | 200K | Manual budget | $1.00 | $5.00 |

**Default model**: `sonnet`

```typescript
import {
    getModel,            // (name) → ModelConfig | null
    getModelById,        // (fullId) → ModelConfig | null
    listModels,          // () → ['opus', 'sonnet', 'haiku']
    MODELS,              // Record<string, ModelConfig>
    DEFAULT_MODEL,       // 'sonnet'
} from 'drift';

getModel('opus')                        // ModelConfig for Opus
getModel('SONNET')                      // Case-insensitive
getModelById('claude-opus-4-6')         // By full ID
```

### Thinking Configuration

```typescript
import { buildThinkingConfig } from 'drift';

// Opus/Sonnet: adaptive thinking (no budget needed)
buildThinkingConfig(opusModel, { thinking: true, effort: 'high' })
// → { type: 'adaptive' }

// Haiku: manual budget
buildThinkingConfig(haikuModel, { thinking: true, effort: 'medium' })
// → { type: 'enabled', budget_tokens: 32000 }

// Effort → token budgets for Haiku:
// low: 10,000  |  medium: 32,000  |  high: 50,000  |  max: 80% of maxTokens

// Custom budget (overrides effort)
buildThinkingConfig(haikuModel, { thinking: true, thinkingBudget: 50000 })
// → { type: 'enabled', budget_tokens: 50000 }

// Disabled
buildThinkingConfig(anyModel, { thinking: false })
// → null
```

### Beta Headers

```typescript
import { getBetaHeaders } from 'drift';

getBetaHeaders(opusModel, { thinking: true })
// → [] (Opus handles interleaved thinking natively)

getBetaHeaders(haikuModel, { thinking: true })
// → ['interleaved-thinking-2025-05-14'] (Haiku needs beta header)

// 1M context is GA for Opus/Sonnet — no beta header needed
getBetaHeaders(sonnetModel, { thinking: true })
// → []
```

---

## Prompt Resolution

Prompts resolve in priority order:

| Priority | Source | Condition |
|---|---|---|
| 1️⃣ | **File** | Matching file exists in `prompts/` directory |
| 2️⃣ | **Inline** | `prompt` class property is set |
| 3️⃣ | **Default** | Built-in: `"You are a helpful AI assistant..."` |

**File search order** (for `BookingAgent` in `cwd`):

1. `prompts/booking.txt` — kebab-case, `Agent` suffix stripped
2. `prompts/@booking.txt` — PineCode `@` convention
3. `prompts/BookingAgent.txt` — exact class name

**Class name → kebab name conversion:**

```typescript
import { classNameToKebab } from 'drift';

classNameToKebab('BookingAgent')       // → 'booking'
classNameToKebab('MyCustomAgent')      // → 'my-custom'
classNameToKebab('DataPipelineAgent')  // → 'data-pipeline'
classNameToKebab('CodeReviewBot')      // → 'code-review-bot'
classNameToKebab('Scanner')           // → 'scanner'
classNameToKebab('Agent')             // → 'agent' (kept as-is)
```

**Example file structure:**

```
my-project/
├── prompts/
│   ├── booking.txt              ← BookingAgent
│   ├── @code-review.txt         ← CodeReviewAgent
│   └── DataPipeline.txt         ← DataPipelineAgent (exact name fallback)
└── agents/
    ├── booking.ts
    └── code-review.ts
```

**Programmatic access:**

```typescript
import { resolvePrompt } from 'drift';

const { prompt, source } = resolvePrompt('BookingAgent', undefined, '/my-project');
// source: 'file' | 'inline' | 'default'
```

---

## Built-in Tools (16)

Every agent gets 16 built-in tools automatically. Organized in 3 categories:

### Edit Tools (3)

| Name | Description | Key Params |
|---|---|---|
| `replace` | Replace lines in a file with content verification | `filePath`, `startLine`, `endLine`, `newContent`, `startLineContent?`, `endLineContent?` |
| `insert_after` | Insert content after a specific line | `filePath`, `afterLine`, `content` |
| `insert_before` | Insert content before a specific line | `filePath`, `beforeLine`, `content` |

### Filesystem Tools (8)

| Name | Description | Key Params |
|---|---|---|
| `create_file` | Create a new file with content | `filePath`, `content` |
| `delete_file` | Delete a file | `filePath` |
| `open_files` | Open/read file contents | `filePaths` |
| `close_files` | Close files from agent context | `filePaths` |
| `find_by_name` | Find files matching a glob pattern | `pattern`, `path?` |
| `grep_search` | Search file contents with regex | `pattern`, `path?` |
| `list_dir` | List directory contents | `path` |
| `project_tree` | Display full project tree structure | _(none)_ |

### Shell Tools (5)

| Name | Description | Key Params |
|---|---|---|
| `shell_execute` | Run a command and return output | `command` |
| `shell_start` | Start a background process | `command`, `name?` |
| `shell_read` | Read output from a background process | `processId` |
| `shell_write` | Write to a background process stdin | `processId`, `input` |
| `shell_stop` | Kill a background process | `processId` |

### `builtinTools` — Selective Registration

By default, agents start with **no built-in tools** (`builtinTools = []`). Opt in using categories or individual names:

```typescript
// Categories
builtinTools = ['all']              // all 16 tools
builtinTools = ['edit']             // replace, insert_after, insert_before (3)
builtinTools = ['filesystem']       // create_file, delete_file, open_files, close_files,
                                    // find_by_name, grep_search, list_dir, project_tree (8)
builtinTools = ['shell']            // shell_execute, shell_start, shell_read, shell_write, shell_stop (5)

// Individual tools
builtinTools = ['grep_search', 'list_dir', 'open_files']

// Mix categories + individual
builtinTools = ['edit', 'shell_execute']   // 3 edit tools + 1 shell tool
```

`builtinTools` combines with `@tool` decorators — both are registered:

```typescript
class TradingAgent extends Agent {
    builtinTools = [];  // no built-in tools, only custom

    @tool('Get stock price', { symbol: { type: 'string', description: 'Ticker' } })
    async getPrice({ symbol }: { symbol: string }) { ... }
}
```

### Tool Filtering

After tool registration, further filter with whitelist/blacklist:

```typescript
// Whitelist — only these tools are available
class SafeAgent extends Agent {
    builtinTools = ['all'];
    allowedTools = ['list_dir', 'grep_search', 'open_files'];
}

// Blacklist — everything except these
class RestrictedAgent extends Agent {
    builtinTools = ['all'];
    disabledTools = ['delete_file', 'shell_execute', 'shell_start'];
}
```

---

## Web Search

Enable Claude's built-in web search:

```typescript
// Simple — enable with defaults
class SearchAgent extends Agent {
    webSearch = true;
}

// Configured
class SearchAgent extends Agent {
    webSearch = {
        max_uses: 5,                              // Max searches per run
        allowed_domains: ['docs.anthropic.com'],   // Only these domains
        blocked_domains: ['reddit.com'],           // Never these domains
    };
}
```

`WebSearchConfig` fields:

| Field | Type | Description |
|---|---|---|
| `max_uses` | `number` | Max web searches per API call |
| `allowed_domains` | `string[]` | Restrict to these domains only |
| `blocked_domains` | `string[]` | Never search these domains |
| `user_location` | `Record<string, string>` | User location hints |

---

## Cache

The `Cache` class manages Anthropic prompt caching — adds `{ cache_control: { type: 'ephemeral' } }` breakpoints to system prompts and tool schemas.

**How it works:**
- Breakpoints mark the end of a cacheable prefix
- The API caches everything from the start up to each breakpoint
- Cache TTL: 5 minutes (refreshed on each hit)
- Cache reads cost **90% less** than fresh input tokens
- Cache writes cost **25% more** than fresh input tokens

```typescript
import { Cache } from 'drift';

// Default: both prompt and tools cached
const cache = new Cache();                    // Cache(prompt, tools)

// Custom
const cache = new Cache({ prompt: false });   // Cache(tools)
const cache = new Cache({ prompt: false, tools: false }); // Cache(disabled)

// Methods
cache.applyToSystem(systemBlocks);    // Adds breakpoint to last system block
cache.applyToTools(toolSchemas);      // Adds breakpoint to last tool schema
cache.toString();                     // "Cache(prompt, tools)"
```

**Usage on Agent:**

```typescript
class MyAgent extends Agent {
    // Agents have caching enabled by default
    // Override to disable:
    cache = new Cache({ prompt: false });
}

// Or at runtime:
agent.cache.prompt = false;
agent.cache.tools = true;
```

| Property | Type | Default | Description |
|---|---|---|---|
| `prompt` | `boolean` | `true` | Cache system prompt (most static content) |
| `tools` | `boolean` | `true` | Cache tool schemas (static across turns) |

---

## Window

Reactive context container for agents. Two data layers:
- **`items`**: `Map<string, T>` — collection of domain objects (files, positions, articles)
- **`state`**: `S` — arbitrary state with React-like `setState()` shallow merge

Every mutation emits a `'change'` event with a full snapshot — UI syncs with a single listener.

### Window Base Class

```typescript
import { Window, type WindowItem } from 'drift';

const win = new Window<MyItem, MyState>(initialState);

// ── Items CRUD ──
win.add('key', { id: 'key', value: 42 });    // add or replace
win.update('key', { value: 99 });             // shallow merge
win.remove('key');                            // returns boolean
win.get('key');                               // T | undefined
win.has('key');                               // boolean
win.list();                                   // T[]
win.keys();                                   // string[]
win.clear();                                  // remove all
win.size;                                     // number
```

**Agent integration** — set `window` on any agent. The agent calls `render()` each turn and injects the result into the system prompt:

```typescript
import { Agent, CodebaseWindow } from 'drift';

class MyAgent extends Agent {
    prompt = 'You are a code assistant.';
    builtinTools = ['all'];
    window = new CodebaseWindow({ cwd: '/my/project' });
}
```

> `DeveloperAgent` and `DeveloperLiteAgent` create a `CodebaseWindow` automatically.

### State (React-like)

Arbitrary state object with shallow merge — like React's `useState`:

```typescript
// Initial state via constructor
const win = new Window({ theme: 'dark', count: 0, user: null });

// Read state
console.log(win.state.theme);  // 'dark'

// Update state (shallow merge, emits 'change')
win.setState({ count: 1 });
win.setState({ user: 'alice' });
// state is now { theme: 'dark', count: 1, user: 'alice' }
```

State is included in every change event and in serialization:

```typescript
win.on('change', (event) => {
    console.log(event.state);  // always the latest full state
});
```

### Events

Every mutation emits `'change'` with a `WindowChangeEvent`:

```typescript
win.on('change', (event) => {
    event.action;   // 'add' | 'remove' | 'update' | 'clear' | 'setState'
    event.id;       // item id (for add/remove/update)
    event.item;     // full item (for add/update)
    event.patch;    // partial patch (for update/setState)
    event.items;    // T[] — current items snapshot
    event.state;    // S — current state snapshot
});
```

### CodebaseWindow

`Window<FileEntry>` subclass for code editing agents. Reads files from disk, renders numbered code in `<window>` XML.

```typescript
import { CodebaseWindow } from 'drift';

const win = new CodebaseWindow({ cwd: '/my/project', maxFileLines: 5000 });

// ── File operations ──
win.open('src/index.ts');       // read from disk → add to items
win.close('src/index.ts');      // remove from items
win.refresh('src/index.ts');    // re-read from disk
win.refreshAll();               // returns string[] of changed paths
win.disable('src/index.ts');    // exclude from render() but keep open
win.enable('src/index.ts');     // re-include in render()

// ── Stats ──
win.stats();  // { files: 2, totalLines: 150, openFiles: ['src/a.ts', 'src/b.ts'] }

// ── Grep results with TTL ──
win.addGrepResults('TODO', [
    { file: 'src/auth.ts', line: 42, content: '// TODO: add validation' },
], 3);  // visible for 3 turns, then auto-expires
```

**`render()` output** (injected into agent's system prompt each turn):

```xml
<window>
📂 Open files (2): src/index.ts, src/auth.ts
⚠️  These files AUTO-REFRESH after every edit. Do NOT re-open them.
Use the line numbers below for all edit operations.

┌─ src/index.ts (15 lines) ─┐
   1| import { Router } from './router';
   2| import { authMiddleware } from './auth';
   3|
   4| const app = new Router();
  ...
  15| app.listen(3000);
└────────────────────────────────────────┘

┌─ src/auth.ts (42 lines) ─┐
   1| export function authMiddleware(req, res, next) {
  ...
└────────────────────────────────────────┘

📊 Window: 2 file(s), 57 lines total
</window>
```

**`FileEntry` type:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Relative path (key) |
| `fullPath` | `string` | Absolute path on disk |
| `content` | `string` | File contents |
| `lines` | `number` | Line count |
| `disabled` | `boolean` | Excluded from `render()` |
| `openedAt` | `number` | Timestamp when opened |

### UI Sync (`useWindow`)

Window changes flow from agent to UI in real-time via WebSocket:

```
Agent tool modifies window → Window emits 'change'
                                    ↓
             DriftServer broadcasts 'window:changed' to all WS clients
                                    ↓
              useWindow() receives event → React state updates → UI re-renders
```

**Server-side** — handled automatically by `DriftServer`. Windows are shared across agents of the same class, and all changes are broadcast to every connected client.

**Client-side** — `useWindow()` from `drift-react` gives you reactive state:

```typescript
import { useWindow } from 'drift-react';

function Board() {
    const { items, state, updateItem, removeItem, setState } = useWindow<TaskItem, BoardState>();

    return items.map(task => (
        <div key={task.id} draggable
            onDragEnd={() => updateItem(task.id, { status: 'done' })}
        >
            {task.title}
            <button onClick={() => removeItem(task.id)}>×</button>
        </div>
    ));
}
```

**`useWindow()` API:**

| Property/Method | Type | Description |
|---|---|---|
| `items` | `T[]` | All window items (reactive) |
| `state` | `S` | Window state (reactive) |
| `open(path)` | `void` | Open a file/item |
| `close(path)` | `void` | Close a file/item |
| `refresh(path?)` | `void` | Refresh one or all items |
| `disable(path)` | `void` | Exclude from agent prompt but keep open |
| `enable(path)` | `void` | Re-include in agent prompt |
| `setState(patch)` | `void` | Update window state (shallow merge) |
| `updateItem(id, patch)` | `void` | Update an item by id |
| `removeItem(id)` | `void` | Remove an item by id |
| `size` | `number` | Number of items |

The WS protocol for windows:

| Client Action | Server Event | Description |
|---|---|---|
| `window:open` | `window:changed` | Open file → broadcasts items |
| `window:close` | `window:changed` | Close file → broadcasts items |
| `window:refresh` | `window:changed` | Re-read file(s) from disk |
| `window:disable` | `window:changed` | Exclude from render() |
| `window:enable` | `window:changed` | Re-include in render() |
| `window:setState` | `window:changed` | Update window state |
| `window:item:update` | `window:changed` | Patch an item |
| `window:item:remove` | `window:changed` | Remove an item |

On connect, the server sends a `window:changed` event with `action: 'sync'` containing the full current state.

### Custom Windows

Extend `Window<T, S>` for any domain. Override `render()` to control what the agent sees:

```typescript
import { Window, type WindowItem } from 'drift';

interface Position extends WindowItem {
    id: string;        // ticker symbol
    symbol: string;
    qty: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
}

interface PortfolioState {
    balance: number;
    strategy: string;
}

class TradingWindow extends Window<Position, PortfolioState> {
    constructor() {
        super({ balance: 100_000, strategy: 'momentum' });
    }

    render(): string {
        if (this.size === 0) return '<portfolio>\nNo open positions.\n</portfolio>';

        const rows = this.list().map(p =>
            `  ${p.symbol}: ${p.qty} @ $${p.entryPrice} → $${p.currentPrice} (${p.pnl > 0 ? '+' : ''}$${p.pnl.toFixed(2)})`
        );
        return (
            `<portfolio>\n` +
            `Balance: $${this.state.balance.toLocaleString()} | Strategy: ${this.state.strategy}\n\n` +
            rows.join('\n') +
            `\n</portfolio>`
        );
    }
}
```

#### JSX Rendering

Window `render()` methods can use **TSX syntax** with Drift's built-in JSX runtime — no React required. Name the file `.tsx` and add the pragma:

```tsx
/** @jsx jsx */
/** @jsxFrag Fragment */
import { Window, type WindowItem, render } from 'drift';
import { jsx, Fragment } from 'drift/jsx-runtime';

class TradingWindow extends Window<Position, PortfolioState> {
    render(): string {
        return render(
            <window name="portfolio">
                <line>Balance: ${this.state.balance.toLocaleString()} | Strategy: {this.state.strategy}</line>
                <br />
                {this.list().map(p => (
                    <line>  {p.symbol}: {p.qty} @ ${p.entryPrice} → ${p.currentPrice} ({p.pnl > 0 ? '+' : ''}${p.pnl.toFixed(2)})</line>
                ))}
            </window>
        );
    }
}
```

**Built-in JSX tags:**

| Tag | Output |
|---|---|
| `<window name="x">` | `<x>\n...\n</x>` — named XML wrapper |
| `<section title="x">` | `── x ──\n...` — titled section |
| `<text>` | Renders children as-is (no wrapping) |
| `<line>` | Children + newline |
| `<br />` | Newline |
| `<hr />` | `────────────────────────` |
| `<>...</>` | Fragment (no wrapper) |
| `<other>` | `<other>\n...\n</other>` (generic XML) |

The JSX runtime (`packages/drift/src/jsx-runtime.ts`) is ~60 lines and renders to strings — no DOM, no React, just formatted text for agent prompts.

### Serialization

Persist window state across sessions:

```typescript
// Save
const snapshot = window.toJSON();
fs.writeFileSync('window.json', JSON.stringify(snapshot));
// → { items: [[id, item], ...], state: { ... }, turn: 5 }

// Restore
const data = JSON.parse(fs.readFileSync('window.json', 'utf8'));
window.loadJSON(data);
```

**Full API:**

| Method | Returns | Description |
|---|---|---|
| `add(id, item)` | `void` | Add or replace item |
| `remove(id)` | `boolean` | Remove item |
| `update(id, patch)` | `void` | Shallow merge fields |
| `get(id)` | `T \| undefined` | Get item |
| `has(id)` | `boolean` | Check existence |
| `list()` | `T[]` | All items |
| `keys()` | `string[]` | All ids |
| `clear()` | `void` | Remove all |
| `setState(patch)` | `void` | Shallow merge state |
| `render()` | `string` | System prompt content (override) |
| `renderMetadata()` | `string` | Short summary (override) |
| `toJSON()` | `object` | Serialize for persistence |
| `loadJSON(data)` | `void` | Restore from serialized |
| `nextTurn()` | `void` | Advance turn counter |
| `on('change', cb)` | `this` | Subscribe to mutations |

| Property | Type | Description |
|---|---|---|
| `state` | `Readonly<S>` | Current state |
| `size` | `number` | Item count |
| `turn` | `number` | Current turn |

### Serialization & Persistence

Window state is **automatically persisted** by `DriftServer` when a `Storage` backend is configured (SQLite by default):

```
Agent tool modifies window → saveWindow(sessionId, className, window.toJSON())
                                                  ↓
Server restart → loadWindow(sessionId, className) → window.loadJSON(data)
                                                  ↓
                              WS broadcasts 'window:changed' → UI in sync
```

What gets persisted:
- All items (`Map<string, T>` → `[id, item][]`)
- State object (`S`)
- Turn counter

Manual serialization:

```typescript
// Save
const snapshot = window.toJSON();
// → { items: [[id, item], ...], state: { ... }, turn: 5 }

// Restore
window.loadJSON(data);  // replaces items, state, and turn
```

### Disabling (Token Saving)

Files/items can be **disabled** — they stay open but are excluded from `render()`, saving token usage:

```typescript
// Server-side
win.disable('src/large-file.ts');  // still in items, but render() skips it
win.enable('src/large-file.ts');   // back in render()

// Client-side (via useWindow)
const { disable, enable } = useWindow();
disable('src/large-file.ts');  // sends WS action, server disables, broadcasts
```

The agent won't see disabled items in its prompt, but they're preserved for when you need them again. Useful for large files that consume too many tokens.

---

## Drift Server

HTTP + WebSocket server that exposes agents and windows to any UI. Serves a React build as static files.

### drift.config.json

```json
{
    "port": 3100,
    "include": ["developer", "researcher"],
    "ui": "./ui/dist",
    "preload": ["src/index.ts", "src/auth.ts"]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3100` | Server port |
| `include` | `string[]` | `[]` | Built-in agents to load (`developer`, `developer-lite`, `researcher`, `playwright`) |
| `agentsDir` | `string` | `"./agents"` | Custom agents auto-discovered from this directory |
| `windowsDir` | `string` | `"./windows"` | Custom windows auto-discovered from this directory |
| `ui` | `string \| null` | `null` | Path to static UI build (served by the server) |
| `preload` | `string[]` | `[]` | Files to pre-load into the window on startup (relative to cwd) |

**Agent discovery:**

```
my-project/
├── agents/                ← custom agents (auto-discovered)
│   ├── analyst.ts
│   └── trader.ts
├── windows/               ← custom windows (auto-discovered)
│   └── portfolio.ts
├── ui/dist/               ← React build (served by drift server)
├── drift.config.json
└── server.ts
```

**Shared windows:** agents with the same window class share one instance. Developer includes `CodebaseWindow` by default — no need to declare it in config.

### CLI

```bash
drift server              # reads drift.config.json from CWD
drift server --port 4000  # override port
drift dev                 # WS server + Vite dev server (HMR)
drift dev --port 3200     # WS on 3200, Vite on 3201
```

### Dev Mode

`drift dev` starts two servers for development with hot module replacement:

1. **Drift WS server** on port N — agents, WebSocket, API
2. **Vite dev server** on port N+1 — React app with HMR

```bash
cd examples/with-react-tasks
npx tsx ../../bin/drift.ts dev --port 3200
```

Output:
```
  ⚡ Drift Server running on http://localhost:3200
  🔥 Starting Vite dev server on port 3201...
     Proxying WebSocket → ws://localhost:3200
  ✨ Dev mode ready → http://localhost:3201
```

**How it works:**
- Detects `vite.config.ts` in the project directory
- Spawns Vite with `DRIFT_WS_PORT` env var
- The React app reads `import.meta.env.VITE_DRIFT_WS_PORT` to connect WebSocket directly to the drift server port
- Edit React components → instant HMR update, no rebuild needed
- No proxy needed — the React app connects to the WS port directly

If no `vite.config.ts` is found, `drift dev` falls back to API-only mode (same as `drift server`).

**Programmatic usage:**

```typescript
import { DriftServer } from 'drift';

const server = new DriftServer(import.meta.dirname!);
const { wsPort, viteUrl } = await server.startDev();
// wsPort: 3200, viteUrl: 'http://localhost:3201'
```

### Static UI Serving

Set `"ui"` in config to serve a React build from the same server:

```json
{ "ui": "./ui/dist" }
```

The server serves static files with proper MIME types, SPA fallback (non-file routes → `index.html`), and CORS headers.

```
http://localhost:3100/           → ui/dist/index.html
http://localhost:3100/health     → { status: "ok", agents: [...] }
http://localhost:3100/api/agents → agent list with window info
ws://localhost:3100              → WebSocket
```

### Programmatic Usage

```typescript
import { DriftServer } from 'drift';

const server = new DriftServer({
    port: 3100,
    include: ['developer'],
    ui: './ui/dist',
});

await server.start();
// ⚡ Drift Server running on http://localhost:3100

server.getAgent('developer');   // Agent instance
server.windows;                 // Map<string, Window>
await server.stop();
```

### WebSocket Protocol

All messages are JSON: `{ action, ...payload }` (client→server) and `{ event, ...payload }` (server→client). All chat/session actions include `sessionId` for multi-session support.

**Client → Server:**

| Action | Payload | Description |
|---|---|---|
| `chat:send` | `{ agent, message, sessionId? }` | Run agent (creates session if needed) |
| `chat:abort` | `{ agent, sessionId? }` | Abort run |
| `chat:history` | `{ agent, sessionId? }` | Get full history (parts-formatted) |
| `chat:clear` | `{ agent, sessionId? }` | Clear conversation |
| `chat:swap` | `{ agent, sessionId }` | Swap agent within a session |
| `chat:settings` | `{ agent, model?, thinking?, effort?, webSearch? }` | Change agent config at runtime |
| `sessions:list` | `{}` | List all sessions |
| `sessions:create` | `{ agent? }` | Create a new empty session |
| `sessions:delete` | `{ sessionId }` | Delete a session |
| `window:open` | `{ path }` | Open file |
| `window:close` | `{ path }` | Close file |
| `window:refresh` | `{ path? }` | Refresh file(s) |
| `window:disable` | `{ path }` | Disable file |
| `window:enable` | `{ path }` | Enable file |
| `window:setState` | `{ patch }` | Update state |
| `window:item:update` | `{ agent?, id, patch }` | Update a window item (shallow merge) |
| `window:item:remove` | `{ agent?, id }` | Remove a window item |
| `agents:list` | `{}` | List agents (includes config) |
| `agents:detail` | `{ agent }` | Get full agent config |
| `models:list` | `{}` | List available models |

**Server → Client:**

| Event | Payload | Description |
|---|---|---|
| `chat:started` | `{ agent, sessionId }` | New assistant turn started |
| `chat:text` | `{ agent, sessionId, delta, full }` | Streaming text |
| `chat:thinking` | `{ agent, sessionId, thinking }` | Thinking content |
| `chat:tool` | `{ agent, sessionId, name, params }` | Tool executing |
| `chat:tool:result` | `{ agent, sessionId, name, result, ms }` | Tool result |
| `chat:done` | `{ agent, sessionId, result }` | Run complete |
| `chat:error` | `{ agent, sessionId, error }` | Error |
| `chat:swapped` | `{ sessionId, agent, config }` | Agent swapped in session |
| `chat:settings:updated` | `{ agent, config }` | Agent config changed (broadcast) |
| `sessions:list` | `{ sessions }` | All sessions (sent on connect) |
| `sessions:created` | `{ session }` | New session created |
| `sessions:updated` | `{ session }` | Session metadata updated |
| `sessions:deleted` | `{ sessionId }` | Session deleted |
| `window:changed` | `{ action, items, state }` | Window mutation |
| `agents:list` | `{ agents: [...] }` | Agent info with config |
| `agents:detail` | `{ agent, config }` | Full agent config response |
| `models:list` | `{ models: [{ name, id, displayName }] }` | Available models |

**Session metadata shape** (in `sessions:list`, `sessions:created`, `sessions:updated`):

```typescript
{
    id: string;            // Session UUID
    agentName: string;     // Agent class name
    createdAt: number;     // Timestamp
    messageCount: number;  // Number of messages
    lastMessage?: string;  // Preview of last message (max 100 chars)
    isRunning: boolean;    // Whether a run is in progress
}
```

---

## drift-react

React hooks library for building UIs on top of Drift agents. Connects to a `DriftServer` via WebSocket and provides real-time reactive state for chat, windows, and settings.

> Full API reference: [`drift-react/README.md`](drift-react/README.md)

```bash
npm install drift-react
```

### DriftProvider

Wrap your app with the WebSocket provider:

```tsx
import { DriftProvider } from 'drift-react';

<DriftProvider url="ws://localhost:3100" reconnect={true} reconnectDelay={2000}>
    <App />
</DriftProvider>
```

Auto-reconnects on disconnect. All hooks below require this provider.

### useChat(agentName, options?)

Full chat with parts-based streaming, tool calls, sessions, and runtime settings.

```tsx
const chat = useChat('developer');                          // auto-generated sessionId
const chat = useChat('developer', { sessionId: 'abc-123' }); // use specific session
```

**Key concept:** everything is a message. The last assistant message in `messages[]` IS the live streaming message — no separate streaming state. Messages use an ordered `parts` array for rich rendering:

```tsx
import { useChat, type ChatMessage, type MessagePart } from 'drift-react';

function Chat({ sessionId }: { sessionId: string }) {
    const { messages, send, abort, clear, isStreaming, lastError, sessionId: sid, activeAgent, swap } = useChat('developer', { sessionId });

    return (
        <div>
            {messages.map((msg, i) => (
                <div key={i}>
                    <strong>{msg.role}</strong>
                    {msg.parts?.map((part, j) => {
                        if (part.type === 'text')     return <Markdown key={j} content={part.content} />;
                        if (part.type === 'thinking') return <ThinkingBlock key={j} active={part.active} text={part.content} />;
                        if (part.type === 'tool')     return <ToolChip key={j} name={part.name} status={part.status} ms={part.ms} />;
                        return null;
                    })}
                </div>
            ))}
            <input onKeyDown={e => { if (e.key === 'Enter') { send(e.currentTarget.value); e.currentTarget.value = ''; } }} />
            {isStreaming && <button onClick={abort}>Stop</button>}
        </div>
    );
}
```

**Session support:** When `sessionId` changes (e.g., user switches sessions in a sidebar), the hook automatically clears local messages and requests history from the server. Events are filtered by `sessionId` so multiple `useChat` instances don't interfere.

| Return | Type | Description |
|---|---|---|
| `messages` | `ChatMessage[]` | Full history (includes in-progress assistant message) |
| `send(text)` | `void` | Send message |
| `nudge(prompt, opts?)` | `void` | Trigger a nudge (UI-driven agent explanation). Auto-aborts current run. |
| `abort()` | `void` | Abort run |
| `clear()` | `void` | Clear history |
| `requestHistory()` | `void` | Request full history from server |
| `isStreaming` | `boolean` | Agent running? |
| `lastError` | `string \| null` | Last error |
| `config` | `AgentConfig \| null` | Current agent config |
| `updateSettings(patch)` | `void` | Change agent settings at runtime |
| `sessionId` | `string` | Current session ID |
| `activeAgent` | `string` | Current agent name (may change after `swap`) |
| `swap(agentName)` | `void` | Swap agent within the session |

#### nudge() — UI-Triggered Agent Explanations

Nudge lets the UI trigger agent responses from interactions (clicks, drags, etc.):

```tsx
const { nudge } = useChat('task-agent', { sessionId });

// Card click → agent explains
nudge(
    `User clicked task "${task.title}". Explain briefly.`,
    { system: 'Be brief, 1-2 sentences. No tool calls.' }
);

// Move → quick acknowledgment with a fast model
nudge(
    `User moved "${task.title}" to Done.`,
    { model: 'haiku', ephemeral: true, system: 'One sentence ack.' }
);
```

**`NudgeOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | agent's model | Override model for this nudge |
| `ephemeral` | `boolean` | `false` | Don't save to conversation history |
| `system` | `string` | `'Respond briefly and helpfully.'` | System instruction for this nudge |

**Server behavior:**
- Auto-aborts current agent run if streaming (interrupt mode)
- Message prefixed with `[NUDGE from UI]` so agent knows it's UI-triggered
- Polls until session stops before starting (prevents race conditions)
- Sends `chat:started`/`chat:text`/`chat:done` events with `nudge: true` flag

### useThread(options) — Contextual Mini-Chats

Contextual conversations scoped to an entity (card, item, etc.). Each thread has its own conversation history, isolated from the main chat. Internally, a thread is a sub-session with id `${parentSession}::thread::${threadId}`.

```tsx
import { useThread } from 'drift-react';

function TaskCard({ task, sessionId }) {
    const thread = useThread({
        agent: 'task-agent',
        threadId: `card:${task.id}`,
        parentSession: sessionId,
        context: `Task: "${task.title}" — ${task.description} (${task.status})`,
        system: 'Help the user understand this task. Be concise.',
    });

    return (
        <div>
            {/* Thread messages */}
            {thread.messages.map((msg, i) => (
                <div key={i}>{msg.role}: {msg.content}</div>
            ))}

            {/* Send a message */}
            <input onKeyDown={e => {
                if (e.key === 'Enter') {
                    thread.send(e.currentTarget.value);
                    e.currentTarget.value = '';
                }
            }} />

            {thread.isStreaming && <span>typing...</span>}
        </div>
    );
}
```

**`ThreadOptions`:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `agent` | `string` | yes | Which agent to use |
| `threadId` | `string` | yes | Unique thread identifier (e.g. `'card:task-1'`) |
| `parentSession` | `string` | yes | Parent session ID — thread inherits window access |
| `context` | `string` | yes | Context injected into the agent's system prompt |
| `model` | `string` | no | Model override for this thread |
| `system` | `string` | no | Custom system instruction |

**`UseThreadReturn`:**

| Return | Type | Description |
|---|---|---|
| `messages` | `ChatMessage[]` | Thread conversation messages |
| `send(text)` | `void` | Send a message in this thread |
| `abort()` | `void` | Abort current streaming response |
| `clear()` | `void` | Clear thread history |
| `isStreaming` | `boolean` | Agent is responding? |
| `open()` | `void` | Open the thread panel |
| `close()` | `void` | Close the thread panel |
| `toggle()` | `void` | Toggle open/closed |
| `minimize()` | `void` | Minimize (keep history, hide panel) |
| `isOpen` | `boolean` | Panel visible? |
| `isMinimized` | `boolean` | Is minimized? |
| `hasHistory` | `boolean` | Has any previous messages? |
| `sessionId` | `string` | Thread session ID |
| `lastError` | `string \| null` | Last error |

**How threads work:**

1. Thread creates a sub-session with id `${parentSession}::thread::${threadId}`
2. The agent gets the `context` injected as a `[THREAD context: ...]` prefix
3. The agent also sees the shared window (same `render()` output as main chat)
4. Thread messages don't appear in the main chat
5. Thread sessions are persisted (messages + session metadata survive restart)
6. Auto-requests history on mount — previous thread messages are restored

**WebSocket protocol (`thread:send`):**

```json
// Client → Server
{
    "action": "thread:send",
    "agent": "task-agent",
    "sessionId": "abc123::thread::card:task-1",
    "parentSession": "abc123",
    "threadId": "card:task-1",
    "context": "Task: \"Fix bug\" — status: todo",
    "message": "What does this task involve?",
    "model": "haiku",          // optional
    "system": "Be concise."    // optional
}

// Server → Client (same events as chat)
{ "event": "chat:started", "sessionId": "abc123::thread::card:task-1" }
{ "event": "chat:text",    "sessionId": "abc123::thread::card:task-1", "delta": "This task..." }
{ "event": "chat:done",    "sessionId": "abc123::thread::card:task-1", "result": { ... } }
```

**Thread history (`thread:history`):**

```json
// Client → Server
{ "action": "thread:history", "agent": "task-agent", "sessionId": "abc123::thread::card:task-1" }

// Server → Client
{ "event": "chat:history", "sessionId": "abc123::thread::card:task-1", "messages": [...] }
```

### useSessions()

Track and manage all server sessions. Subscribes to session lifecycle events.

```tsx
import { useSessions, type SessionInfo } from 'drift-react';

function Sidebar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
    const { sessions, createSession, deleteSession } = useSessions();

    return (
        <div>
            <button onClick={() => createSession('developer')}>+ New</button>
            {sessions.map(s => (
                <div key={s.id} onClick={() => onSelect(s.id)}>
                    {s.lastMessage || 'New conversation'}
                </div>
            ))}
        </div>
    );
}
```

| Return | Type | Description |
|---|---|---|
| `sessions` | `SessionInfo[]` | All known sessions |
| `createSession(agent?)` | `void` | Create a new session on the server |
| `deleteSession(id)` | `void` | Delete a session |
| `refreshSessions()` | `void` | Re-fetch sessions from server |

**`SessionInfo`:**

```typescript
interface SessionInfo {
    id: string;
    agentName: string;
    createdAt: number;
    messageCount: number;
    lastMessage?: string;
    isRunning?: boolean;
}
```

### useWindow()

★ Reactive window state. Items and state auto-sync via WebSocket:

```tsx
import { useWindow } from 'drift-react';

function FileExplorer() {
    const { items, state, open, close, refresh, disable, enable, setState, updateItem, removeItem, size } = useWindow();

    return (
        <ul>
            {items.map(file => (
                <li key={file.id}>
                    {file.id} ({file.lines} lines)
                    <button onClick={() => close(file.id)}>✕</button>
                </li>
            ))}
        </ul>
    );
}
```

**With custom windows** (bidirectional reactivity):

```tsx
import { useWindow, type WindowItem } from 'drift-react';

interface Task extends WindowItem { id: string; title: string; status: 'todo' | 'doing' | 'done'; }
interface BoardState { userActivity: { action: string; taskId?: string; at: number }[] }

function TaskBoard() {
    const { items, state, updateItem, removeItem, setState } = useWindow<Task, BoardState>();

    function handleMove(taskId: string, newStatus: string) {
        updateItem(taskId, { status: newStatus });
        setState({ userActivity: [...(state.userActivity || []), { action: 'moved', taskId, at: Date.now() }] });
    }

    return (
        <div>
            {items.map(task => (
                <div key={task.id}>
                    {task.title} [{task.status}]
                    <button onClick={() => handleMove(task.id, 'done')}>✅ Done</button>
                    <button onClick={() => removeItem(task.id)}>🗑 Delete</button>
                </div>
            ))}
        </div>
    );
}
```

Every `updateItem`/`removeItem`/`setState` call sends a WebSocket message → server updates the `Window` instance → broadcasts `window:changed` to all clients → all UIs re-render. The agent sees the latest state on its next `run()` via `window.render()`.

| Return | Type | Description |
|---|---|---|
| `items` | `T[]` | Window items (reactive) |
| `state` | `S` | Window state (reactive) |
| `open(path)` | `void` | Open file |
| `close(path)` | `void` | Close file |
| `refresh(path?)` | `void` | Refresh one/all |
| `disable(path)` | `void` | Exclude from prompt |
| `enable(path)` | `void` | Re-include |
| `setState(patch)` | `void` | Update window state |
| `updateItem(id, patch)` | `void` | Update item (shallow merge) |
| `removeItem(id)` | `void` | Remove item |
| `size` | `number` | Item count |

### useDrift()

Connection status and agent management:

```tsx
import { useDrift } from 'drift-react';

function Header() {
    const { connected, agents, activeAgent, setActiveAgent, refreshAgents } = useDrift();

    return (
        <header>
            <span>{connected ? '🟢' : '🔴'}</span>
            <select value={activeAgent} onChange={e => setActiveAgent(e.target.value)}>
                {agents.map(a => <option key={a.name}>{a.name}</option>)}
            </select>
        </header>
    );
}
```

---

## MCP (Model Context Protocol)

Connect to any MCP server (stdio, HTTP, SSE) and use its tools with any agent.

```typescript
import { MCP, Agent } from 'drift';

const mcp = new MCP();

// stdio — spawns child process
await mcp.connect('playwright', {
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
});

// HTTP — remote server
await mcp.connect('my-api', {
    url: 'http://localhost:4000/mcp',
});

// SSE — legacy remote server
await mcp.connect('legacy', {
    url: 'http://10.0.82.6:5000/sse',
    transport: 'sse',
});
```

**Register MCP tools with an agent:**

```typescript
const agent = new Agent({ prompt: 'Use browser tools to test the app.' });

// Register all tools from a specific server
for (const tool of mcp.getTools('playwright')) {
    agent.registerTool(tool);
}

// Or register all tools from all servers
for (const tool of mcp.getAllTools()) {
    agent.registerTool(tool);
}

await agent.run('Navigate to example.com');
```

**API:**

| Method | Returns | Description |
|---|---|---|
| `connect(name, config)` | `string[]` | Connect to server, returns tool names |
| `disconnect(name)` | `void` | Disconnect a server |
| `disconnectAll()` | `void` | Disconnect all servers |
| `getTools(name)` | `ToolDefinition[]` | Tools from one server |
| `getAllTools()` | `ToolDefinition[]` | Tools from all servers |
| `isConnected(name)` | `boolean` | Check connection |
| `listServers()` | `string[]` | Connected server names |

**MCPServerConfig:**

| Field | Type | Description |
|---|---|---|
| `command` | `string` | Command for stdio (e.g. `'npx'`) |
| `args` | `string[]` | Args for stdio |
| `env` | `Record<string, string>` | Extra env vars (stdio only) |
| `url` | `string` | URL for HTTP/SSE |
| `transport` | `'stdio' \| 'http' \| 'sse'` | Force transport type |
| `headers` | `Record<string, string>` | Extra HTTP headers |

> **Tip:** Use `PlaywrightAgent` for the most common MCP use case — it handles connect/disconnect automatically.

---

## Provider

Low-level Anthropic API wrapper. Usually not needed directly — the agent manages this internally.

```typescript
import { Provider } from 'drift';

const provider = new Provider();                      // Reads ANTHROPIC_API_KEY from env
const provider = new Provider('sk-ant-...');          // Explicit API key

// Create a streaming API call
const stream = await provider.createStream(
    { model: 'claude-sonnet-4-6', max_tokens: 8192, messages: [...], system: [...] },
    modelConfig,
    { thinking: true },
);

// Iterate stream events
for await (const event of stream) {
    // event.type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | ...
}
```

The provider automatically adds beta headers when needed (interleaved thinking for Haiku).

---

## Types Reference

All types are exported from `drift`:

```typescript
import type {
    // ── Tool Types ──
    ToolSchema,              // { [paramName: string]: ToolParamSchema }
    ToolParamSchema,         // { type, description, items?, enum? }
    ToolDefinition,          // { name, description, schema, required, execute }
    ToolResult,              // { success: boolean, result: string }
    ToolContext,             // { cwd: string, window?, diffTracker?, ... }
    ToolCall,                // { name: string, input: Record<string, any> }

    // ── Agent Types ──
    AgentResult,             // { text, ok, cost, duration, model, toolCalls, aborted, error? }
    AgentOptions,            // Constructor options (model, prompt, thinking, effort, ...)

    // ── Model Types ──
    ModelConfig,             // Full model config (id, name, pricing, thinking mode, ...)
    Effort,                  // 'low' | 'medium' | 'high' | 'max'

    // ── Message Types ──
    Message,                 // { role: 'user' | 'assistant', content: string | ContentBlock[] }
    ContentBlock,            // TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock
    TextBlock,               // { type: 'text', text, cache_control? }
    ThinkingBlock,           // { type: 'thinking', thinking, signature? }
    ToolUseBlock,            // { type: 'tool_use', id, name, input }
    ToolResultBlock,         // { type: 'tool_result', tool_use_id, content, is_error? }

    // ── API Types ──
    ApiUsage,                // { input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }
    PricingTurn,             // { cost, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, cacheSavings }

    // ── Web Search ──
    WebSearchConfig,         // { max_uses?, allowed_domains?, blocked_domains?, user_location? }

    // ── Context Types ──
    WindowContext,           // File context window interface
    WindowFile,              // { path, content, lines, disabled }
    DiffTracker,             // { record(), printToolDiff() }
    DiffEntry,               // { filePath, fullPath, operation, oldContent, newContent, description }
} from 'drift';
```

---

## Authentication

Pluggable auth adapter — same pattern as Storage. Three built-in strategies, or bring your own.

Unauthorized connections are rejected with WebSocket close code `4001`.

### Quick Protect (standalone apps)

**No existing auth system? Use `SecretAuth`** — just a shared secret key:

```bash
# .env
DRIFT_SECRET=my-super-secret-key-123
```

```typescript
import { DriftServer, SecretAuth } from 'drift';

// Reads DRIFT_SECRET from env automatically
const server = new DriftServer({ auth: new SecretAuth() });

// Or pass it explicitly
const server = new DriftServer({ auth: new SecretAuth('my-secret') });
```

Client connects with:
```typescript
// Browser
const ws = new WebSocket('ws://localhost:3100?secret=my-super-secret-key-123');

// Or via header (Node.js clients)
const ws = new WebSocket('ws://localhost:3100', {
    headers: { Authorization: 'Bearer my-super-secret-key-123' },
});
```

With `drift-react`:
```typescript
// Pass secret in the WebSocket URL
<DriftProvider url="ws://localhost:3100?secret=my-super-secret-key-123">
```

### Token Validation (JWT, API keys)

**Have your own tokens?** Use `TokenAuth` with a custom verify function:

```typescript
import { DriftServer, TokenAuth } from 'drift';
import jwt from 'jsonwebtoken';

const server = new DriftServer({
    auth: new TokenAuth(token => {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!);
        return { id: decoded.sub, role: decoded.role };
    }),
});
```

`TokenAuth` extracts tokens from: URL `?token=xxx`, `Authorization: Bearer xxx`, or `Sec-WebSocket-Protocol` header.

### Custom Auth (NextAuth, Clerk, etc.)

**App already has auth?** Implement the `DriftAuth` interface:

```typescript
const server = new DriftServer({
    auth: {
        authenticate(req) {
            const session = getServerSession(req);  // NextAuth, Clerk, etc.
            if (!session) throw new Error('Not authenticated');
            return { id: session.user.id, email: session.user.email };
        },
    },
});
```

### Per-Agent Access Control

To restrict which agents a user can access, check `msg.agent` in `authorize()`:

```typescript
auth: {
    authenticate(req) { /* ... */ },
    authorize(user, action, msg) {
        const allowed = getAllowedAgents(user);  // your logic
        if (msg.agent && !allowed.includes(msg.agent)) {
            throw new Error('Unauthorized');
        }
        return true;
    },
}

### `DriftAuth` Interface

```typescript
interface DriftAuth {
    authenticate(req: IncomingMessage): Promise<DriftUser> | DriftUser;
    authorize?(user: DriftUser, action: string, msg: any): Promise<boolean> | boolean;
}

interface DriftUser {
    id: string;
    [key: string]: any;  // add roles, email, etc.
}
```

| Adapter | Use Case | Token Source |
|---------|----------|-------------|
| `NoAuth` | Development (default) | None |
| `SecretAuth` | Standalone apps | `?secret=` / Bearer / `DRIFT_SECRET` env |
| `TokenAuth` | JWT, API keys | `?token=` / Bearer / custom verify |
| Custom | NextAuth, Clerk, etc. | Whatever your app uses |

---

## Embedding (attach)

Embed DriftServer in an existing HTTP server (Next.js, Express, Fastify, etc.):

```typescript
import { createServer } from 'http';
import { DriftServer, TokenAuth } from 'drift';

// Your existing HTTP server
const httpServer = createServer(myApp);

// Attach Drift (WS only, no listen)
const drift = new DriftServer({ auth: new TokenAuth(verify) });
await drift.attach(httpServer);

httpServer.listen(3000);
```

### Next.js Custom Server

```typescript
import { createServer } from 'http';
import next from 'next';
import { DriftServer } from 'drift';

const app = next({ dev: true });
const handle = app.getRequestHandler();

await app.prepare();
const httpServer = createServer((req, res) => handle(req, res));

const drift = new DriftServer();
await drift.attach(httpServer);

httpServer.listen(3000);
```

---

## Persistence

Sessions, conversation history, and window state are persisted to SQLite by default. Survives server restarts.

```typescript
// Default: SQLite at .drift/drift.db (auto-created)
const server = new DriftServer();

// Custom path
const server = new DriftServer({
    storage: new SQLiteStorage('/path/to/data.db'),
});

// Disable persistence
const server = new DriftServer({ storage: false });

// Custom backend (implement Storage interface)
const server = new DriftServer({ storage: new RedisStorage() });
```

### What's Persisted

| Data | When Saved | Restored |
|------|------------|----------|
| Session metadata | After each `chat:send`, `chat:nudge`, `thread:send` | On server start |
| Conversation messages | After each `chat:send`, `chat:nudge`, `thread:send` | When session loads |
| **Window state** | After every UI mutation + after agent runs | **Automatically on server start** |
| Thread messages | After each `thread:send` | Via `thread:history` on hook mount |

### Window Persistence

Window state (items + state + turn counter) is persisted to the `window_state` table using the `__shared__` key:

**When it saves:**
- After every UI mutation (`window:item:update`, `window:item:remove`, `window:setState`) — immediate
- After every `chat:send` and `chat:nudge` run completes — in the `finally` block

**When it restores:**
- On server startup, `_restoreSessions()` loads window state from `__shared__` key ONCE before restoring sessions
- `window.loadJSON(data)` clears existing items and replaces with persisted state
- If no saved data exists, seed data from the window constructor remains

**Serialization format:**

```typescript
// window.toJSON() → saved to window_state.state as JSON
{
    items: [
        ["task-1", { id: "task-1", title: "Fix bug", status: "done", ... }],
        ["task-2", { id: "task-2", title: "Add tests", status: "todo", ... }],
    ],
    state: { filter: "all", activity: [...] },
    turn: 5
}
```

**SQLite schema (`window_state`):**

```sql
CREATE TABLE window_state (
    session_id    TEXT NOT NULL,     -- '__shared__' for shared windows
    window_class  TEXT NOT NULL,     -- e.g. 'TaskBoardWindow'
    state         TEXT NOT NULL,     -- JSON blob from toJSON()
    PRIMARY KEY (session_id, window_class)
);
```

> The `__shared__` key has a pseudo-session in the `sessions` table to satisfy the FK constraint.

### Custom Storage Adapter

```typescript
import type { Storage, SessionData } from 'drift';
import type { Message } from 'drift';

class RedisStorage implements Storage {
    saveSession(data: SessionData): Promise<void> { ... }
    loadSession(id: string): Promise<SessionData | null> { ... }
    listSessions(): Promise<SessionData[]> { ... }
    deleteSession(id: string): Promise<void> { ... }
    saveMessages(sessionId: string, messages: Message[]): Promise<void> { ... }
    loadMessages(sessionId: string): Promise<Message[]> { ... }
    saveWindow(sessionId: string, windowClass: string, data: any): Promise<void> { ... }
    loadWindow(sessionId: string, windowClass: string): Promise<any | null> { ... }
    close(): Promise<void> { ... }
}
```

---

## Project Structure

```
drift/
├── packages/
│   ├── drift/                    # Core framework
│   │   └── src/
│   │       ├── index.ts          # Public API barrel exports
│   │       ├── types.ts          # All type definitions
│   │       ├── core/             # Agent, Session, Conversation, Window, Cache, Pricing, Prompt
│   │       ├── agents/           # 4 built-in agents (Developer, DeveloperLite, Playwright, Researcher)
│   │       ├── server/           # DriftServer, WebSocket handler, config loader, vite-dev
│   │       ├── provider/         # Anthropic API client + model configs
│   │       ├── decorators/       # @tool decorator + ToolRegistry
│   │       ├── windows/          # CodebaseWindow
│   │       └── tools/            # 16 built-in tools (edit, filesystem, shell)
│   └── drift-react/              # React hooks (drift/react)
│       └── src/
│           ├── index.ts          # Public API barrel exports
│           ├── provider.tsx      # DriftProvider — WebSocket context
│           ├── use-chat.ts       # useChat() — streaming, tools, sessions, nudge
│           ├── use-thread.ts     # useThread() — contextual mini-chats
│           ├── use-sessions.ts   # useSessions() — session lifecycle
│           ├── use-window.ts     # useWindow() — reactive window state
│           ├── use-drift.ts      # useDrift() — connection + agents
│           └── types.ts          # Shared types
├── bin/
│   └── drift.ts                  # CLI — `drift server`, `drift dev`
├── test/
│   ├── run.ts                    # Zero-dep test runner
│   ├── unit/                     # 172 unit tests
│   └── integration/              # 11 integration tests
├── examples/
│   ├── basic/                    # 8 standalone script examples
│   └── task-board/               # Full React app — task board + session sidebar
├── .nvmrc                        # Node version
├── package.json                  # Single npm package with subpath exports
├── tsconfig.json
└── README.md
```

---

## Examples

```bash
node --import tsx examples/basic/<file>.ts
```

| File | Shows |
|---|---|
| `quick.ts` | Minimal agent — inline prompt, single `run()` |
| `custom-tools.ts` | `@tool` decorator: inheritance, typed params, required vs optional |
| `streaming.ts` | `stream()` API — real-time token output |
| `builtin-tools.ts` | Auto-loaded prompt file + built-in filesystem tools |
| `thinking.ts` | Extended thinking mode + calculator tool |
| `define-tool.ts` | `defineTool()` JS API — no decorators needed |
| `multi-turn.ts` | 5-turn conversation with context memory |
| `server.ts` | `DriftServer` — programmatic server with agents + window |
| `task-board/` | Full React app — bidirectional window reactivity, multi-session sidebar |

---

## Development

```bash
nvm use 24                               
npm test                                    # 172 unit tests (~0.5s)
npm run test:integration                    # + 11 real Haiku API tests (~30s, needs ANTHROPIC_API_KEY)
npm run test:verbose                        # Show per-assertion details
npm run typecheck                           # tsc --noEmit

# Filter tests
node --import tsx test/run.ts --filter prompt
node --import tsx test/run.ts --integration --filter streaming
```

**Native TypeScript**: Uses `node --import tsx` (Node 20+ loader API). All imports use `.ts` extensions directly — no build step needed. TypeScript runs natively.

**Dependencies**: `@anthropic-ai/sdk`, `ws`. Dev: `typescript`, `tsx`, `@types/node`.
