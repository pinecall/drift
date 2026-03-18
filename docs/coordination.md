# Coordination — Inter-Agent Communication

> **Deep reference** for Dispatch, Trigger, and Pipeline coordination primitives. For quick usage, see the [README Coordination section](../README.md#coordination).

---

## Table of Contents

- [Overview](#overview)
- [Dispatch](#dispatch)
  - [How It Works](#how-it-works)
  - [DispatchFn Signature](#dispatchfn-signature)
  - [DispatchResult](#dispatchresult)
  - [DispatchOptions](#dispatchoptions)
  - [Using Dispatch from Agents](#using-dispatch-from-agents)
  - [Using Dispatch from UI](#using-dispatch-from-ui)
  - [Session Management](#session-management)
  - [WebSocket Events](#websocket-events)
- [Trigger](#trigger)
  - [Trigger Base Class](#trigger-base-class)
  - [Override Mode (condition + run)](#override-mode)
  - [StateMachine Mode (field + on)](#statemachine-mode)
  - [Auto-Discovery](#auto-discovery)
  - [Trigger Lifecycle](#trigger-lifecycle)
  - [TriggerManager](#triggermanager)
  - [WebSocket Actions](#websocket-actions)
- [Pipeline](#pipeline)
  - [Pipeline Class](#pipeline-class)
  - [Step Styles](#step-styles)
  - [Lifecycle Hooks](#lifecycle-hooks)
  - [PipelineContext](#pipelinecontext)
  - [PipelineManager](#pipelinemanager)
  - [Pipeline WebSocket Actions](#pipeline-websocket-actions)
- [Agent Subscribes (Blackboard)](#agent-subscribes-blackboard)
  - [Simple Subscription](#simple-subscription)
  - [Custom Handler](#custom-handler)
  - [Per-Slice Config](#per-slice-config)
  - [How It Works](#how-it-works-1)
- [TaskBoard (Kanban)](#taskboard-kanban)
  - [Card Type](#card-type)
  - [Dependencies](#dependencies)
  - [Human Review Gates](#human-review-gates)
  - [Per-Card Context](#per-card-context)
  - [WebSocket Protocol (Board)](#websocket-protocol-board)
- [Architecture](#architecture)
  - [Data Flow](#data-flow)
  - [Where Things Live](#where-things-live)
- [Patterns & Best Practices](#patterns--best-practices)
  - [Supervisor Pattern](#supervisor-pattern)
  - [Review Pipeline](#review-pipeline)
  - [Watch & React](#watch--react)
- [Configuration](#configuration)
- [Testing](#testing)

---

## Overview

Drift's coordination layer lets agents communicate and react to changes without direct coupling. Two primitives:

| Primitive | Purpose | Who Uses It |
|-----------|---------|-------------|
| **Dispatch** | Invoke an agent programmatically | Other agents (via `dispatch_agent` tool), triggers, pipelines, or the UI |
| **Trigger** | React to state changes and dispatch agents | Defined in `triggersDir/`, auto-discovered on startup |
| **Pipeline** | Sequential agent chains | Defined in `pipelinesDir/`, auto-discovered on startup |
| **Agent Subscribes** | Agent-centric workspace subscriptions | Declared on Agent via `subscribes`, auto-generates Triggers |
| **TaskBoard** | Kanban task coordination | `TaskBoard` class, columns, card assignment, dependencies, human review |

All three share the same underlying `DispatchFn` — they're consumers, the WS handler is the provider.

---

## Dispatch

### How It Works

```
caller (agent / trigger / UI)
  → dispatch('reviewer', 'Review task X')
    → resolves Agent from agentMap
    → creates Session (ID: __dispatch__:reviewer:1710753600123)
    → broadcast 'dispatch:started' to all WS clients
    → session.run(message)
      → agent loop (tools, thinking, streaming)
    → broadcast 'dispatch:done' with result summary
    → persist session + messages to SQLite
    → return DispatchResult
```

Dispatch creates a **real Session** — the dispatched agent has full access to tools, thinking, and the shared Window/Workspace. Results are persisted and visible in session history.

### DispatchFn Signature

```typescript
type DispatchFn = (
    agentName: string,
    message: string,
    options?: DispatchOptions,
) => Promise<DispatchResult>;
```

### DispatchResult

```typescript
interface DispatchResult {
    text: string;              // Agent's final response text
    cost: number;              // API cost in USD
    toolCalls: ToolCallInfo[]; // Tools the agent called
    sessionId: string;         // Internal session ID (__dispatch__:...)
    aborted: boolean;          // Whether the agent was aborted
}
```

### DispatchOptions

```typescript
interface DispatchOptions {
    sessionId?: string;   // Custom session ID (default: auto-generated)
    silent?: boolean;     // Don't broadcast to WS clients (default: false)
    timeout?: number;     // Max execution time in ms
    source?: string;      // Who triggered this: 'trigger:auto-review', 'agent:PlannerAgent', 'ui'
}
```

### Using Dispatch from Agents

Set `canDispatch = true` on your agent — it automatically gets a `dispatch_agent` tool:

```typescript
import { Agent, tool } from 'drift';

class SupervisorAgent extends Agent {
    model = 'sonnet';
    canDispatch = true;  // ← enables dispatch_agent tool

    prompt = `You coordinate work between agents.
Available agents: task-agent, reviewer.
Use dispatch_agent to delegate tasks.`;
}
```

The agent can then use `dispatch_agent` like any other tool:

```
Agent thinking: "The user wants me to review all tasks. I'll dispatch the reviewer."
Tool call: dispatch_agent({ agent: 'reviewer', message: 'Review all done tasks for quality' })
Tool result: "Reviewed 3 tasks. All pass quality checks..."
Agent: "I dispatched the reviewer and all tasks passed quality checks."
```

**What happens internally:**
1. Agent's `_ensureDecorators()` registers the `dispatch_agent` tool (schema: `agent` + `message`)
2. Tool's `execute()` calls `ctx.dispatch(agent, message)` — same `DispatchFn` from the WS handler
3. Dispatch is **blocking** for the calling agent (it awaits the result)
4. The result text is returned as the tool result

### Using Dispatch from UI

Send a `dispatch:run` WebSocket action:

```json
{
    "action": "dispatch:run",
    "agent": "reviewer",
    "message": "Review all completed tasks",
    "silent": false,
    "timeout": 30000
}
```

Response event:
```json
{
    "event": "dispatch:result",
    "agent": "reviewer",
    "result": {
        "text": "Reviewed 3 tasks...",
        "cost": 0.005,
        "toolCalls": [...],
        "sessionId": "__dispatch__:reviewer:1710753600123",
        "aborted": false
    }
}
```

### Session Management

- Dispatch sessions use IDs prefixed with `__dispatch__:` (e.g., `__dispatch__:reviewer:1710753600123`)
- Each dispatch creates a **new session** by default (fresh conversation)
- Pass `sessionId` option to reuse an existing session (multi-turn dispatch)
- Dispatch sessions are persisted to SQLite just like regular sessions
- They appear in `sessions:list` and can be queried with `chat:history`

### WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `dispatch:started` | Server → All Clients | `{ agent, sessionId, source }` |
| `dispatch:done` | Server → All Clients | `{ agent, sessionId, source, result: { text, cost } }` |
| `dispatch:error` | Server → All Clients | `{ agent, sessionId, source, error }` |
| `dispatch:result` | Server → Sender | `{ agent, result: DispatchResult }` |

`dispatch:started`/`done`/`error` are **broadcast** to all clients (unless `silent: true`).
`dispatch:result` is sent **only to the requesting client** (response to `dispatch:run`).

---

## Trigger

### Trigger Base Class

Triggers are classes that extend `Trigger`:

```typescript
import { Trigger } from 'drift';

class MyTrigger extends Trigger {
    watch = 'window' as const;  // 'window' or 'workspace'
    cooldown = 10_000;           // ms between firings (0 = no cooldown)
    enabled = true;              // can be toggled at runtime
}
```

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string?` | Class name (kebab) | Unique identifier |
| `watch` | `'window' \| 'workspace'` | `'window'` | What change events to listen to |
| `cooldown` | `number` | `0` | Min ms between firings |
| `enabled` | `boolean` | `true` | Active/inactive toggle |
| `field` | `string?` | — | StateMachine mode: field to track |
| `on` | `Record<string, handler>` | — | StateMachine mode: handlers per value |

**Injected at runtime by DriftServer:**

| Property | Type | Description |
|----------|------|-------------|
| `workspace` | `Workspace?` | Shared workspace reference |
| `window` | `Window?` | First shared window reference |

**Protected API (available in subclasses):**

| Method | Description |
|--------|-------------|
| `this.dispatch(agent, message, options?)` | Dispatch an agent |
| `this.select(key)` | Read a workspace slice (shortcut for `this.workspace.select(key)`) |

### Override Mode

Implement `condition()` + `run()` for full control:

```typescript
class StaleTaskAlert extends Trigger {
    watch = 'window' as const;
    cooldown = 60_000;  // max once per minute

    condition(event: any): boolean {
        // Only fire on window updates
        return event.action === 'update' && event.item?.status === 'todo';
    }

    async run(event: any): Promise<void> {
        const stats = this.select('stats');
        if (stats?.remaining > 10) {
            await this.dispatch('planner',
                `There are ${stats.remaining} pending tasks. Prioritize and suggest next actions.`
            );
        }
    }
}
```

### StateMachine Mode

Use `field` + `on` for declarative state transitions — no need to override `condition()` or `run()`:

```typescript
class TaskLifecycle extends Trigger {
    watch = 'window' as const;
    cooldown = 15_000;
    field = 'status';   // Watch the 'status' field on window items

    on = {
        'done': async (event: any) => {
            await this.dispatch('reviewer',
                `Task "${event.item.title}" completed. Review for quality.`
            );
        },
        'doing': async (event: any) => {
            await this.dispatch('task-agent',
                `Task "${event.item.title}" started. Set up tracking.`
            );
        },
        'blocked': async (event: any) => {
            await this.dispatch('planner',
                `Task "${event.item.title}" is blocked. Suggest alternatives.`
            );
        },
    };
}
```

**How it works internally:**
1. Default `condition()` checks: `event.action === 'update' && field in event.patch`
2. Default `run()` extracts `event.item[field]` value and calls matching `on[value]` handler
3. If no handler matches the value, nothing happens (silent skip)

### Auto-Discovery

Triggers are auto-discovered from `triggersDir` (default: `./triggers`), just like agents from `agentsDir`:

```
my-project/
├── agents/           ← agentsDir
│   ├── task-agent.ts
│   └── reviewer.ts
├── triggers/         ← triggersDir
│   ├── auto-review.ts
│   └── stale-alert.ts
└── drift.config.json
```

**Discovery rules:**
1. Scans `triggersDir` for `.ts` and `.js` files
2. Looks for `export default` or any export that `instanceof Trigger`
3. Auto-names from class name if `name` is not set (`AutoReviewTrigger` → `auto-review-trigger`)
4. Injects `workspace`, `window`, and `_dispatchFn` references

### Trigger Lifecycle

```
DriftServer.start()
  → loadTriggers(config)               // scan triggersDir/
  → inject workspace, window, dispatch  // wire dependencies
  → triggerManager.add(trigger)         // register

Window/Workspace change event fires
  → triggerManager.evaluate(source, event)
    → for each trigger:
      → skip if disabled
      → skip if watch !== source
      → call trigger.condition(event)
      → skip if false
      → check cooldown (Date.now() - lastFired < cooldown)
      → skip if too soon
      → fire! trigger.run(event)  // async, non-blocking
      → emit 'fired' event
      → broadcast 'trigger:fired' to WS clients
```

### TriggerManager

Internal class that manages the trigger registry:

```typescript
import { TriggerManager } from 'drift';

const manager = new TriggerManager();
manager.add(trigger);
manager.remove('trigger-name');
manager.enable('trigger-name');
manager.disable('trigger-name');
manager.get('trigger-name');  // Trigger | undefined
manager.list();                // Trigger[]

// Evaluate all triggers against an event
await manager.evaluate('window', changeEvent);

// Listen for firings
manager.on('fired', ({ trigger, source }) => {
    console.log(`Trigger ${trigger} fired from ${source}`);
});
```

### WebSocket Actions

| Action | Payload | Response Event |
|--------|---------|---------------|
| `trigger:list` | — | `trigger:list` with array of `{ name, watch, cooldown, enabled }` |
| `trigger:enable` | `{ name }` | — |
| `trigger:disable` | `{ name }` | — |

| Event | Payload | Description |
|-------|---------|-------------|
| `trigger:fired` | `{ trigger, source }` | Broadcast when a trigger fires |

---

## Pipeline

### Pipeline Class

Pipelines are classes that extend `Pipeline`:

```typescript
import { Pipeline } from 'drift';

class MyPipeline extends Pipeline {
    steps = ['agent-a', 'agent-b', 'agent-c'];
}
```

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string?` | Class name (kebab) | Unique identifier |
| `steps` | `(string \| PipelineStep)[]` | `[]` | Steps to execute sequentially |

**Injected by DriftServer:** `workspace`, `window`, `_dispatchFn`.

**Protected API:** `this.dispatch()`, `this.select(key)`.

### Step Styles

**Simple (string) — agent name, default message passing:**

```typescript
steps = ['planner', 'task-agent', 'reviewer'];
// Step 0 gets original input
// Step 1 gets step 0's response text
// Step 2 gets step 1's response text
```

**Full control (PipelineStep objects):**

```typescript
interface PipelineStep {
    agent: string;
    message?: (ctx: PipelineContext) => string;   // custom message builder
    condition?: (ctx: PipelineContext) => boolean; // skip if false
    timeout?: number;                              // step-specific timeout
}
```

Example:

```typescript
steps = [
    { agent: 'scanner',  message: (ctx) => `Scan ${ctx.input}` },
    { agent: 'analyzer', message: (ctx) => `Analyze:\n${ctx.prev.text}` },
    { agent: 'executor', message: (ctx) => `Execute:\n${ctx.prev.text}`,
                         condition: (ctx) => !ctx.prev.text.includes('REJECT') },
];
```

### Lifecycle Hooks

| Hook | Signature | Returns | Description |
|------|-----------|---------|-------------|
| `beforeStep` | `(step, ctx)` | `string \| void` | Return string to override message |
| `afterStep` | `(step, ctx)` | `void` | Called after each successful step |
| `onError` | `(step, error, ctx)` | `'abort' \| 'skip' \| 'retry'` | Error handling (default: `'abort'`) |

```typescript
class SafePipeline extends Pipeline {
    steps = ['scanner', 'analyzer', 'executor'];

    afterStep(step, ctx) {
        this.workspace?.setSlice('progress', `Step ${step + 1} done`);
    }

    onError(step, error, ctx) {
        return step < 2 ? 'abort' : 'skip';  // critical steps abort, others skip
    }
}
```

### PipelineContext

```typescript
interface PipelineContext {
    input: string;              // Original pipeline input
    prev: DispatchResult;       // Previous step's result (empty for step 0)
    results: DispatchResult[];  // All completed step results
    step: number;               // Current step index (0-based)
    stepName: string;           // Current agent name
    aborted: boolean;           // Whether pipeline is aborted
}
```

### PipelineManager

```typescript
import { PipelineManager } from 'drift';

const manager = new PipelineManager();
manager.add(pipeline);
manager.remove('name');
manager.get('name');
manager.list();

const result = await manager.run('name', 'input');

manager.on('started', (data) => { ... });
manager.on('step', (data) => { ... });
manager.on('done', (data) => { ... });
manager.on('error', (data) => { ... });
```

### Pipeline WebSocket Actions

| Action/Event | Direction | Payload |
|-------------|-----------|--------|
| `pipeline:run` | Client → Server | `{ pipeline, input, silent? }` |
| `pipeline:list` | Client → Server | — |
| `pipeline:started` | Server → All | `{ pipeline, steps[] }` |
| `pipeline:step` | Server → All | `{ pipeline, step, agent, status }` |
| `pipeline:done` | Server → All | `{ pipeline, result }` |
| `pipeline:error` | Server → All | `{ pipeline, step, error }` |
| `pipeline:result` | Server → Sender | `{ pipeline, result: PipelineResult }` |

---

## Agent Subscribes (Blackboard)

Declare `subscribes` on an Agent class to auto-dispatch it when specific workspace slices change. This is syntactic sugar over Trigger — internally, `DriftServer.start()` generates Trigger instances from agent subscriptions.

### Simple Subscription

```typescript
import { Agent } from 'drift';

class MarketAgent extends Agent {
    model = 'haiku';
    prompt = 'You analyze market data.';

    // When 'prices' or 'signals' change → auto-dispatch this agent
    subscribes = ['prices', 'signals'];
    subscribeCooldown = 10_000;  // default: 5000ms
}
```

Default dispatch message:
```
Workspace slice "prices" was updated:

{"btc": 67000, "eth": 3200}
```

### Custom Handler

Override `onSliceChange()` to customize the dispatch message or skip entirely:

```typescript
class ExecutorAgent extends Agent {
    model = 'haiku';
    subscribes = ['signals'];

    onSliceChange(slice: string, value: any, event: WorkspaceChangeEvent): string | null {
        if (slice === 'signals' && value?.action === 'BUY') {
            return `New BUY signal: ${JSON.stringify(value)}. Execute if risk is acceptable.`;
        }
        return null;  // null = skip dispatch entirely
    }
}
```

### Per-Slice Config

Use objects instead of strings for per-slice cooldown control:

```typescript
class AlertAgent extends Agent {
    subscribes = [
        { slice: 'alerts',  cooldown: 0 },       // every change
        { slice: 'metrics', cooldown: 60_000 },   // max once per minute
    ];
}
```

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `subscribes` | `(string \| { slice, cooldown? })[]` | — | Workspace slices to watch |
| `subscribeCooldown` | `number` | `5000` | Default cooldown in ms |
| `onSliceChange()` | `(slice, value, event) => string \| null` | — | Custom message builder |

### How It Works

```
DriftServer.start()
  → for each agent with subscribes:
    → for each subscribed slice:
      → create Trigger { name: '__subscribe__:agentName:sliceName', watch: 'workspace' }
      → condition: event.slice === sliceName
      → run: onSliceChange() or default message → dispatch(agentName, message)
      → add to TriggerManager

Workspace.setSlice('prices', newData)
  → emit 'change' → TriggerManager.evaluate()
    → __subscribe__:market:prices fires
      → checks cooldown
      → builds message (custom or default)
      → dispatch('market', message)
```

Subscription triggers are named `__subscribe__::{agent}:{slice}` and appear alongside regular triggers in `trigger:list`.

---

## TaskBoard (Kanban)

Kanban-style task coordination with columns, agent assignment, dependencies, human review gates, and per-card context. Extends `Window<Card, BoardState>` — inherits items CRUD, events, persistence, and prompt rendering.

```typescript
import { TaskBoard, DriftServer } from 'drift';

const board = new TaskBoard();  // default columns
const server = new DriftServer({ taskboard: board });

// Planner adds cards
board.addCard({ title: 'Implement auth', assignee: 'coder', priority: 1 });
board.addCard({ title: 'Write tests', assignee: 'tester', dependsOn: ['card-1'] });
board.addCard({ title: 'Review PR', requiresHumanReview: true, dependsOn: ['card-2'] });
```

Default columns: `todo` → `in_progress` → `in_review` → `qa` → `done`

Custom: `new TaskBoard(['backlog', 'sprint', 'review', 'done'])`

### Card Type

```typescript
interface Card {
    id: string;                     // auto-generated
    title: string;
    description?: string;
    column: string;                 // current column
    assignee?: string;              // agent name
    dependsOn?: string[];           // card IDs that must be DONE first
    requiresHumanReview?: boolean;  // pause at IN_REVIEW for human approval
    context?: string;               // accumulated context
    priority?: number;              // 1 (Critical) - 5 (Lowest), default: 3
    labels?: string[];
    createdAt: number;
    updatedAt: number;
    result?: string;                // final output when done
}
```

**Methods:**

| Method | Description |
|--------|-------------|
| `addCard(input)` | Create card in TODO, auto-dispatch if assigned |
| `moveCard(id, column)` | Move to column, unblock dependents if DONE |
| `assignCard(id, agent)` | Assign + emit `card:assigned` |
| `unassignCard(id)` | Remove assignee |
| `appendContext(id, text)` | Accumulate context text |
| `setResult(id, result)` | Set output + auto-advance (DONE or IN_REVIEW) |
| `approveCard(id)` | Move from IN_REVIEW → next column |
| `rejectCard(id, reason?)` | Move back to TODO with reason in context |
| `byColumn(col)` | Query cards by column |
| `byAssignee(agent)` | Query cards by agent |
| `isBlocked(id)` | Check if dependencies are met |
| `getReady()` | Get TODO cards with all deps satisfied |
| `blocked()` / `unblocked()` | Query blocked/unblocked cards |

### Dependencies

```typescript
board.addCard({ title: 'Backend', assignee: 'coder' });      // card-1
board.addCard({ title: 'Frontend', dependsOn: ['card-1'] }); // blocked until card-1 DONE
board.addCard({ title: 'Deploy', dependsOn: ['card-1', 'card-2'] }); // needs both
```

**Auto-unblock flow:**
```
card-1 done → card-2 unblocks → card:assigned emitted → tester dispatched
                                  (card-1 result is in dispatch message)
card-2 done → card-3 still blocked (card-1 done but checking all deps)
              card-3 unblocks when ALL deps done
```

Dependency results are automatically included in the dispatch message via `<dependency_results>` XML.

### Human Review Gates

```typescript
board.addCard({ title: 'Review PR', requiresHumanReview: true, assignee: 'coder' });

// Agent finishes work:
board.setResult(cardId, 'Implementation done');  // → moves to IN_REVIEW (not DONE)

// Human reviews in UI:
board.approveCard(cardId);                       // → moves to QA
// or
board.rejectCard(cardId, 'Missing tests');        // → moves to TODO + reason in context
```

### Per-Card Context

Each card accumulates context that is passed to the dispatched agent:

```typescript
board.appendContext(cardId, 'File: src/auth.ts preloaded');  // custom context
board.appendContext(cardId, 'Previous attempt failed: timeout');  // accumulates

// When agent is dispatched, it receives:
// 1. Card title + description
// 2. Priority
// 3. Results from dependency cards (if any)
// 4. Card's own accumulated context
```

### WebSocket Protocol (Board)

**Actions (Client → Server):**

| Action | Payload | Description |
|--------|---------|-------------|
| `board:addCard` | `{ card: CardInput }` | Add new card |
| `board:moveCard` | `{ id, column }` | Move card to column |
| `board:assignCard` | `{ id, agent }` | Assign to agent |
| `board:approveCard` | `{ id }` | Human approval |
| `board:rejectCard` | `{ id, reason? }` | Human rejection |
| `board:list` | — | Get all cards by column |

**Events (Server → Client):**

| Event | Payload | When |
|-------|---------|------|
| `board:changed` | Window change event | Any board mutation |
| `board:cardAdded` | `{ card }` | Card created (sent to sender) |
| `board:moved` | `{ card, from, to }` | Card moved between columns |
| `board:unblocked` | `{ card }` | Card dependencies satisfied |
| `board:approved` | `{ card }` | Human approved card |
| `board:rejected` | `{ card, reason }` | Human rejected card |

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        DriftServer                              │
│                                                                 │
│  ┌──────────┐    window.on('change')    ┌────────────────────┐  │
│  │  Window   │──────────────────────────►│  TriggerManager    │  │
│  │ (shared)  │                          │   ├─ Trigger A      │  │
│  └──────────┘                           │   ├─ Trigger B      │  │
│                                         │   └─ Trigger C      │  │
│  ┌──────────┐  workspace.on('change')   │                     │  │
│  │Workspace │──────────────────────────►│  evaluate(event)    │  │
│  │ (global)  │                          │    ↓ condition()     │  │
│  └──────────┘                           │    ↓ run()          │  │
│                                         └────────┬───────────┘  │
│                                                  │              │
│                                      ┌───────────▼───────────┐  │
│  ┌──────────┐                        │    dispatch()         │  │
│  │  Agent A  │◄──────────────────────│  (closure in ws.ts)   │  │
│  │canDispatch│──dispatch_agent──────►│                       │  │
│  └──────────┘                        │  • resolve agent      │  │
│                                      │  • create session     │  │
│  ┌──────────┐                        │  • run + persist      │  │
│  │  Agent B  │◄──────────────────────│  • broadcast events   │  │
│  └──────────┘                        └───────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  WebSocket Clients (UI)                                  │   │
│  │  • dispatch:run → dispatch()                             │   │
│  │  • trigger:list/enable/disable                           │   │
│  │  ← dispatch:started/done/error                           │   │
│  │  ← trigger:fired                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Where Things Live

| Concept | File | Owner |
|---------|------|-------|
| `Trigger` base class | `core/trigger.ts` | Framework |
| `TriggerManager` | `core/trigger.ts` | Framework |
| `Pipeline` base class | `core/pipeline.ts` | Framework |
| `PipelineManager` | `core/pipeline.ts` | Framework |
| `DispatchFn` / types | `core/trigger.ts` | Framework |
| `dispatch()` implementation | `server/ws.ts` | WS handler closure |
| `dispatch_agent` tool | `core/agent.ts` | Auto-registered per agent |
| `loadTriggers()` | `server/config.ts` | Auto-discovery |
| `loadPipelines()` | `server/config.ts` | Auto-discovery |
| Trigger/Pipeline wiring | `server/index.ts` | DriftServer.start() |
| User-defined triggers | `triggersDir/*.ts` | User project |
| User-defined pipelines | `pipelinesDir/*.ts` | User project |

---

## Patterns & Best Practices

### Supervisor Pattern

One coordinator agent orchestrates work across specialist agents:

```typescript
class SupervisorAgent extends Agent {
    model = 'sonnet';
    canDispatch = true;

    prompt = `You are a project supervisor. Available agents:
- task-agent: Creates and manages tasks
- reviewer: Reviews completed work for quality
- planner: Breaks down goals into actionable plans

Coordinate these agents to accomplish user goals.
Use dispatch_agent to delegate specific work.`;
}
```

### Review Pipeline

Trigger + Agent chain for automated quality control:

```typescript
// triggers/auto-review.ts
class AutoReview extends Trigger {
    watch = 'window' as const;
    cooldown = 15_000;
    field = 'status';

    on = {
        'done': async (e: any) => {
            await this.dispatch('reviewer',
                `Review task "${e.item.title}" for quality and completeness.`
            );
        },
    };
}
```

### Watch & React

Workspace-level trigger that reacts to cross-agent state:

```typescript
class MetricsAlert extends Trigger {
    watch = 'workspace' as const;
    cooldown = 120_000;  // max once per 2 minutes
    field = 'metrics';

    on = {
        // Any change to metrics slice
        '*': async (e: any) => {
            const metrics = this.select('metrics');
            if (metrics.remaining > 20) {
                await this.dispatch('planner',
                    `Backlog growing: ${metrics.remaining} tasks remaining. Re-prioritize.`
                );
            }
        },
    };
}
```

---

## Configuration

Add `triggersDir` and `pipelinesDir` to your `drift.config.json`:

```json
{
    "port": 3100,
    "agentsDir": "./agents",
    "triggersDir": "./triggers",
    "pipelinesDir": "./pipelines"
}
```

Defaults: `"./triggers"` / `"./pipelines"`. If the directory doesn't exist, nothing is loaded (no error).

---

## Testing

### Unit Testing Triggers

Triggers can be tested in isolation without a server:

```typescript
import { Trigger } from 'drift';
import type { DispatchFn } from 'drift';

class MyTrigger extends Trigger {
    watch = 'window' as const;
    field = 'status';
    on = { 'done': async (e) => await this.dispatch('reviewer', 'Review') };
}

// Mock dispatch
const calls: any[] = [];
const mockDispatch: DispatchFn = async (agent, msg) => {
    calls.push({ agent, msg });
    return { text: 'ok', cost: 0, toolCalls: [], sessionId: '__mock__', aborted: false };
};

const trigger = new MyTrigger();
trigger._dispatchFn = mockDispatch;
trigger.name = 'test';

// Simulate a window change event
await trigger._evaluate('window', {
    action: 'update',
    item: { id: '1', status: 'done', title: 'Test' },
    patch: { status: 'done' },
    items: [], state: {},
});

console.assert(calls.length === 1);
console.assert(calls[0].agent === 'reviewer');
```

### Integration Testing with Real API

```typescript
import { Agent, Session } from 'drift';
import type { DispatchFn } from 'drift';

const agents = new Map([['ping', new PingAgent()]]);

const dispatch: DispatchFn = async (name, msg, opts) => {
    const agent = agents.get(name)!;
    const session = new Session(agent, { id: `test:${Date.now()}` });
    const result = await session.run(msg, { timeout: 30_000 });
    return { text: result.text, cost: result.cost, toolCalls: [], sessionId: session.id, aborted: false };
};

const result = await dispatch('ping', 'Say hello');
console.assert(result.text.length > 0);
```
