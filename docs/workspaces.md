# Workspace — Shared Reactive State

> **Deep reference** for the `Workspace<S>` class. For the quick-start usage, see the [README](../README.md#workspace).

---

## Table of Contents

- [Overview](#overview)
- [Creating a Workspace](#creating-a-workspace)
- [Reading State](#reading-state)
  - [select()](#select)
  - [state (read-only)](#state-read-only)
  - [Versions](#versions)
- [Writing State](#writing-state)
  - [setSlice()](#setslice)
  - [setState()](#setstate)
  - [Optimistic Locking](#optimistic-locking)
- [Change Events](#change-events)
  - [WorkspaceChangeEvent](#workspacechangeevent)
  - [Listening to Changes](#listening-to-changes)
- [Agent Integration](#agent-integration)
  - [Injecting Workspace](#injecting-workspace)
  - [workspaceSlices (Prompt Filtering)](#workspaceslices-prompt-filtering)
  - [subscribes (Blackboard Pattern)](#subscribes-blackboard-pattern)
  - [Agent Tools](#agent-tools)
- [Prompt Rendering](#prompt-rendering)
  - [render()](#render)
  - [Filtering Slices](#filtering-slices)
- [Persistence](#persistence)
  - [toJSON / loadJSON](#tojson--loadjson)
  - [Automatic Persistence](#automatic-persistence)
- [WebSocket Protocol](#websocket-protocol)
  - [Actions (Client → Server)](#actions-client--server)
  - [Events (Server → Client)](#events-server--client)
- [Server Wiring](#server-wiring)
- [Architecture](#architecture)
- [Workspace vs Window](#workspace-vs-window)
- [Testing](#testing)

---

## Overview

`Workspace<S>` is a **shared reactive state container** for multi-agent collaboration. Unlike `Window` (items + state per-agent), Workspace is a **single flat state object** shared across **all** agents in the server.

Top-level keys are called **slices**. Each agent can read/write any slice, and declare which slices it sees in its system prompt via `workspaceSlices`.

**Key properties:**
- **Per-slice optimistic versioning** — prevents concurrent write conflicts
- **`structuredClone` on reads** — prevents accidental mutation of internal state
- **Change events** — real-time UI sync via WebSocket
- **Serialization** — automatic persistence to SQLite

---

## Creating a Workspace

```typescript
import { Workspace } from 'drift';

// Type-safe workspace with defined slices
interface TradingState {
    market: { btc: number; eth: number };
    signals: Array<{ action: string; symbol: string }>;
    portfolio: Record<string, number>;
}

const workspace = new Workspace<TradingState>('trading', {
    market: { btc: 0, eth: 0 },
    signals: [],
    portfolio: {},
});
```

**Constructor:** `new Workspace<S>(name: string, initialState: S)`

- `name` — unique identifier, used as the persistence key in SQLite
- `initialState` — full initial state object; each key becomes a versioned slice

All slices start at version `0`.

---

## Reading State

### select()

```typescript
const market = workspace.select('market');
// { btc: 67000, eth: 3200 }  — deep copy via structuredClone
```

Returns a **deep copy** (via `structuredClone`) of the slice. Safe to mutate without affecting internal state.

### state (read-only)

```typescript
const fullState = workspace.state;
// Readonly reference — do NOT mutate
```

Returns a `Readonly<S>` reference to the full state. Use `select()` for safe copies.

### Versions

```typescript
workspace.version('market');   // 3 — current version of 'market' slice
workspace.versions;             // { market: 3, signals: 1, portfolio: 0 }
```

Each write to a slice bumps its version by 1. Versions are used for [optimistic locking](#optimistic-locking).

---

## Writing State

### setSlice()

```typescript
const ok = workspace.setSlice('market', { btc: 67000, eth: 3200 });
// true — write succeeded, version bumped
```

**Signature:** `setSlice<K>(key: K, value: S[K], expectedVersion?: number): boolean`

- Replaces the slice atomically
- Bumps the version by 1
- Emits a `'change'` event with `action: 'setSlice'`
- Returns `true` on success, `false` on version mismatch (see [optimistic locking](#optimistic-locking))

### setState()

```typescript
workspace.setState({
    market: { btc: 68000, eth: 3300 },
    portfolio: { BTC: 0.5 },
});
// Shallow merge — signals is not affected
```

**Signature:** `setState(patch: Partial<S>): void`

- **Shallow merge** into state (like React's `setState`)
- Bumps version for **each changed key** in the patch
- Emits a `'change'` event with `action: 'setState'`

### Optimistic Locking

Prevent concurrent write conflicts by passing `expectedVersion`:

```typescript
const v = workspace.version('market');  // 3
const ok = workspace.setSlice('market', newData, v);

if (!ok) {
    // Another write happened first — version is now 4+
    // Re-read, merge, and retry
    const fresh = workspace.select('market');
    workspace.setSlice('market', { ...fresh, ...myChanges });
}
```

If `expectedVersion` doesn't match the current version, the write is **rejected** (returns `false`). Without `expectedVersion`, writes always succeed.

---

## Change Events

### WorkspaceChangeEvent

Every write emits a `'change'` event with this shape:

```typescript
interface WorkspaceChangeEvent<S> {
    action: 'setState' | 'setSlice' | 'sync';
    slice?: string;              // which slice changed (setSlice only)
    state: S;                    // current full state snapshot
    patch?: Partial<S>;          // patch applied (setState only)
    version?: number;            // version of the changed slice
    versions: Record<string, number>;  // all current versions
}
```

### Listening to Changes

```typescript
workspace.on('change', (event) => {
    console.log(`Action: ${event.action}`);
    if (event.action === 'setSlice') {
        console.log(`Slice "${event.slice}" updated to v${event.version}`);
    }
    if (event.action === 'setState') {
        console.log('Keys changed:', Object.keys(event.patch!));
    }
});
```

**How the server uses change events:**

```
Workspace.setSlice('prices', data)
  → emit 'change'
    → broadcast 'workspace:changed' to all WebSocket clients
    → debounced persist to SQLite (max 1x/100ms)
    → TriggerManager.evaluate('workspace', event)
      → fires matching Triggers (including agent.subscribes)
```

---

## Agent Integration

### Injecting Workspace

Workspace is injected into agents automatically by `DriftServer.start()`:

```typescript
// In your server setup
const workspace = new Workspace('board', { tasks: [], metrics: {} });

const server = new DriftServer({
    agentsDir: './agents',
    workspace,  // ← all agents get this.workspace
});
```

Every agent then has `this.workspace` available:

```typescript
class TaskAgent extends Agent {
    async doSomething() {
        const tasks = this.workspace?.select('tasks');
        this.workspace?.setSlice('tasks', [...tasks, newTask]);
    }
}
```

### workspaceSlices (Prompt Filtering)

Control which slices appear in an agent's system prompt:

```typescript
class ScannerAgent extends Agent {
    workspaceSlices = ['market', 'signals'];
    // Only 'market' and 'signals' are rendered in the prompt
    // 'portfolio' and other slices are hidden
}

class ReviewerAgent extends Agent {
    // workspaceSlices not set → ALL slices are rendered
}
```

This controls **visibility only** — the agent can still programmatically read/write any slice via tools.

### subscribes (Blackboard Pattern)

Auto-dispatch the agent when specific slices change:

```typescript
class MarketAgent extends Agent {
    subscribes = ['prices', 'signals'];
    subscribeCooldown = 10_000;  // default: 5000ms

    onSliceChange(slice: string, value: any): string | null {
        if (slice === 'prices' && value?.btc > 70_000) {
            return `BTC above 70k! Current: ${value.btc}`;
        }
        return null;  // skip dispatch
    }
}
```

See [Coordination → Agent Subscribes](./coordination.md#agent-subscribes-blackboard) for full docs.

### Agent Tools

Agents interact with workspace via built-in tools that are auto-registered:

| Tool | Description | Agent sees in prompt |
|------|-------------|---------------------|
| `workspace_read` | Read a workspace slice | Yes (auto-registered) |
| `workspace_write` | Write to a workspace slice | Yes (auto-registered) |

The workspace state is also rendered as XML in the system prompt (see [Prompt Rendering](#prompt-rendering)).

---

## Prompt Rendering

### render()

Workspace is rendered as XML and injected into the agent's system prompt:

```typescript
workspace.render();
```

Produces:

```xml
<workspace name="trading">
  <slice name="market" v="3">
{"btc": 67000, "eth": 3200}
  </slice>
  <slice name="signals" v="1">
[{"action": "BUY", "symbol": "BTC"}]
  </slice>
  <slice name="portfolio" v="0">
{}
  </slice>
</workspace>
```

Each `<slice>` tag includes the current version (`v="N"`) so the agent knows how fresh the data is.

### Filtering Slices

```typescript
workspace.render(['market', 'signals']);
// Only renders 'market' and 'signals' slices
```

This is what `workspaceSlices` on Agent uses internally — on each turn, the agent loop calls `workspace.render(agent.workspaceSlices)`.

---

## Persistence

### toJSON / loadJSON

```typescript
// Serialize
const data = workspace.toJSON();
// { name: 'trading', state: {...}, versions: { market: 3, ... } }

// Restore
workspace.loadJSON(data);
// State and versions are fully restored
```

`loadJSON` handles migration gracefully — if `versions` is missing (old data), all slices are initialized at version `0`.

### Automatic Persistence

When `DriftServer` has storage enabled, workspace state is automatically persisted:

1. **On change** — debounced at 100ms (max 10 writes/second to SQLite)
2. **On startup** — restored from SQLite via `storage.loadWorkspace(name)`

```
Workspace.setSlice('prices', data)
  → emit 'change'
    → clearTimeout(previous timer)
    → setTimeout(100ms) → storage.saveWorkspace(name, workspace.toJSON())
```

Persistence is transparent — no agent code needed.

---

## WebSocket Protocol

### Actions (Client → Server)

| Action | Payload | Description |
|--------|---------|-------------|
| `workspace:setState` | `{ patch: Partial<S> }` | Shallow merge into workspace state |
| `workspace:setSlice` | `{ slice: string, value: any }` | Replace a single slice |

### Events (Server → Client)

| Event | Payload | When |
|-------|---------|------|
| `workspace:changed` | `{ name, action, slice?, state, patch?, version?, versions }` | Any workspace write |

**On client connect**, the server sends the current workspace state as an initial `workspace:changed` event with `action: 'sync'`.

**React hook usage (@drift/react):**

```typescript
import { useDrift } from '@drift/react';

function Dashboard() {
    const { workspace } = useDrift();
    
    // workspace.state — full reactive state
    // workspace.versions — current versions
    // workspace.setState(patch) — send workspace:setState
    // workspace.setSlice(key, value) — send workspace:setSlice
}
```

---

## Server Wiring

```
DriftServer.start()
  1. Create workspace (from options.workspace)
  2. Inject into all agents: agent.workspace = workspace
  3. Restore from SQLite: workspace.loadJSON(saved)
  4. Pass to createWSHandler()
  5. Wire change events:
     → broadcast workspace:changed
     → debounced persist to SQLite
     → triggerManager.evaluate('workspace', event)
  6. Generate subscription triggers from agent.subscribes
```

**Config in `drift.config.json`:**

Workspace is created programmatically in `server.ts`, not via config:

```typescript
// server.ts
import { DriftServer, Workspace } from 'drift';

const workspace = new Workspace('my-app', {
    tasks: [],
    metrics: { total: 0, done: 0 },
    settings: { theme: 'dark' },
});

const server = new DriftServer({ workspace });
await server.start();
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Workspace                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  _state: { market: {...}, signals: [...], ... }      │    │
│  │  _versions: { market: 3, signals: 1, portfolio: 0 } │    │
│  └──────────────────────────────────────────────────────┘    │
│                           │                                   │
│          ┌────────────────┼─────────────────┐                │
│          ▼                ▼                 ▼                │
│   setSlice()         setState()        select()              │
│   (atomic)           (shallow merge)   (structuredClone)     │
│          │                │                                   │
│          └───────┬────────┘                                   │
│                  ▼                                            │
│          emit('change')                                       │
│                  │                                            │
│     ┌────────────┼──────────────┐                            │
│     ▼            ▼              ▼                            │
│  broadcast    persist       triggers                         │
│  WS clients   SQLite       evaluate                          │
└─────────────────────────────────────────────────────────────┘
```

| Concept | File | Description |
|---------|------|-------------|
| `Workspace<S>` class | `core/workspace.ts` | Base class (~193 lines) |
| `WorkspaceChangeEvent` | `core/workspace.ts` | Change event type |
| `agent.workspace` | `core/agent.ts` | Injected reference |
| `agent.workspaceSlices` | `core/agent.ts` | Prompt filtering |
| `agent.subscribes` | `core/agent.ts` | Blackboard subscriptions |
| WS broadcast + persist | `server/ws.ts` | Change event wiring |
| Workspace restoration | `server/index.ts` | Startup loading |
| `saveWorkspace` / `loadWorkspace` | `core/sqlite-storage.ts` | SQLite persistence |

---

## Workspace vs Window

| Aspect | Workspace | Window |
|--------|-----------|--------|
| **Scope** | One per server, shared by ALL agents | One or more per agent, agent-specific |
| **Data model** | Flat key-value slices | Items array + state object |
| **Read safety** | `structuredClone` on `select()` | Direct reference |
| **Versioning** | Per-slice optimistic locking | Per-item via turn counter |
| **Use case** | Global state: metrics, config, signals | Agent context: files, tasks, board items |
| **Prompt injection** | `<workspace>` XML | `<window>` XML |
| **Persistence** | Debounced SQLite | SQLite on change |

**When to use Workspace:**
- Cross-agent shared state (metrics, signals, portfolio)
- UI dashboard state (board columns, settings)
- Global configuration that agents can modify

**When to use Window:**
- Agent-specific context (open files, board items)
- CRUD collections with add/remove/update
- Data that needs to be rendered with line numbers

---

## Testing

### Unit Testing

```typescript
import { Workspace } from 'drift';

const ws = new Workspace('test', { counter: 0, items: [] });

// Read
assert(ws.select('counter') === 0);
assert(ws.version('counter') === 0);

// Write
ws.setSlice('counter', 42);
assert(ws.select('counter') === 42);
assert(ws.version('counter') === 1);

// structuredClone safety
const items = ws.select('items');
items.push('mutated');
assert(ws.select('items').length === 0);  // internal state unchanged

// Optimistic locking
const ok = ws.setSlice('counter', 100, 0);  // expected v0, but it's v1
assert(!ok);  // rejected
```

### Testing Change Events

```typescript
const events: WorkspaceChangeEvent[] = [];
ws.on('change', (e) => events.push(e));

ws.setSlice('counter', 5);
assert(events.length === 1);
assert(events[0].action === 'setSlice');
assert(events[0].slice === 'counter');
assert(events[0].version === 2);

ws.setState({ counter: 10, items: ['a'] });
assert(events.length === 2);
assert(events[1].action === 'setState');
assert(Object.keys(events[1].patch!).length === 2);
```

### Serialization Roundtrip

```typescript
const data = ws.toJSON();
const ws2 = new Workspace('test', { counter: 0, items: [] });
ws2.loadJSON(data);
assert(ws2.select('counter') === ws.select('counter'));
assert(ws2.version('counter') === ws.version('counter'));
```
