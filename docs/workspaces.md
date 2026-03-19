# Workspace — Shared Reactive Workstation

> **Deep reference** for the `Workspace<S>` class. For the quick-start usage, see the [README](../README.md#workspace).

---

## Table of Contents

- [Overview](#overview)
- [Creating a Workspace](#creating-a-workspace)
- [State Management](#state-management)
  - [Reading State](#reading-state)
  - [Writing State](#writing-state)
- [Window Management](#window-management)
  - [addWindow()](#addwindow)
  - [getWindow()](#getwindow)
  - [removeWindow()](#removewindow)
  - [windowNames](#windownames)
  - [hasWindow()](#haswindow)
- [Change Events](#change-events)
  - [WorkspaceChangeEvent](#workspacechangeevent)
  - [Listening to Changes](#listening-to-changes)
- [Agent Integration](#agent-integration)
  - [Injecting Workspace](#injecting-workspace)
  - [windows (Prompt Filtering)](#windows-prompt-filtering)
  - [subscribes (Blackboard Pattern)](#subscribes-blackboard-pattern)
- [Prompt Rendering](#prompt-rendering)
  - [render()](#render)
  - [Filtering Windows](#filtering-windows)
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

`Workspace<S>` is a **shared reactive workstation** for multi-agent collaboration. It serves two purposes:

1. **Container for named Windows** — agents register their Windows into the workspace, making them accessible to all agents by name
2. **Shared state object** — a simple `S` state for cross-cutting data (metrics, settings, activity logs)

**Key properties:**
- **Named Windows** — each Window is registered with a name, agents declare which ones they need
- **Simple shared state** — shallow merge via `setState()`, no versioning complexity
- **Change events** — real-time UI sync via WebSocket
- **Serialization** — automatic persistence to SQLite

---

## Creating a Workspace

```typescript
import { Workspace } from 'drift';

// Type-safe workspace with shared state
interface BoardState {
    stats: { totalCreated: number; totalCompleted: number; agentInteractions: number };
    lastActivity: string[];
}

const workspace = new Workspace<BoardState>('task-board', {
    stats: { totalCreated: 0, totalCompleted: 0, agentInteractions: 0 },
    lastActivity: [],
});
```

**Constructor:** `new Workspace<S>(name: string, initialState?: S)`

- `name` — unique identifier, used as the persistence key in SQLite
- `initialState` — optional initial shared state object (defaults to `{}`)

---

## State Management

### Reading State

```typescript
workspace.state;              // full state object
workspace.state.stats;        // access a specific key
workspace.state.lastActivity; // arrays, objects, etc.
```

State returns a direct reference. For safe copies, use `structuredClone()`:

```typescript
const safeCopy = structuredClone(workspace.state.stats);
safeCopy.totalCreated++;  // doesn't affect workspace
```

### Writing State

```typescript
// Shallow merge — like React's setState
workspace.setState({ stats: { totalCreated: 5, totalCompleted: 2, agentInteractions: 10 } });
// Only 'stats' key is replaced, 'lastActivity' is unchanged

workspace.setState({ lastActivity: ['Agent started'] });
// Only 'lastActivity' key is replaced

// Agent usage:
const stats = { ...this.workspace.state.stats };
stats.agentInteractions++;
this.workspace.setState({ stats });
```

**Signature:** `setState(patch: Partial<S>): void`

- **Shallow merge** into state (like React's `setState`)
- Emits a `'change'` event with `action: 'setState'`

---

## Window Management

Workspace is a container for named Windows. The server auto-registers agent windows, but you can also manage them manually.

### addWindow()

```typescript
import { Window } from 'drift';

const filesWindow = new Window();
workspace.addWindow('files', filesWindow);
// Window's .name is set to 'files'
```

**Signature:** `addWindow(name: string, window: Window): void`

- Registers the Window with a name
- Sets `window.name = name`
- Emits `'change'` with `action: 'windowAdded'`

### getWindow()

```typescript
const win = workspace.getWindow('files');         // Window | undefined
const typed = workspace.getWindow<MyWindow>('board');  // typed cast
```

### removeWindow()

```typescript
const removed = workspace.removeWindow('temp');   // true if existed
```

Emits `'change'` with `action: 'windowRemoved'`.

### windowNames

```typescript
workspace.windowNames;  // ['files', 'board', 'stats'] — all registered names
```

### hasWindow()

```typescript
workspace.hasWindow('files');  // boolean
```

---

## Change Events

### WorkspaceChangeEvent

Every write or window change emits a `'change'` event:

```typescript
interface WorkspaceChangeEvent<S> {
    action: 'setState' | 'windowAdded' | 'windowRemoved' | 'sync';
    state: S;                    // current full state snapshot
    patch?: Partial<S>;          // patch applied (setState only)
    windowName?: string;         // which window was added/removed
}
```

### Listening to Changes

```typescript
workspace.on('change', (event) => {
    console.log(`Action: ${event.action}`);
    if (event.action === 'setState') {
        console.log('Keys changed:', Object.keys(event.patch!));
    }
    if (event.action === 'windowAdded') {
        console.log(`Window "${event.windowName}" was registered`);
    }
});
```

**How the server uses change events:**

```
Workspace.setState({ stats: updated })
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
        const stats = { ...this.workspace.state.stats };
        stats.totalCreated++;
        this.workspace.setState({ stats });
    }
}
```

### windows (Prompt Filtering)

Control which workspace Windows appear in an agent's system prompt:

```typescript
class ScannerAgent extends Agent {
    windows = ['market', 'signals'];
    // Only 'market' and 'signals' Windows are rendered in the prompt
    // Other windows are hidden
}

class ReviewerAgent extends Agent {
    // windows not set → ALL workspace windows are rendered
}
```

This controls **visibility only** — the agent can still programmatically read/write the workspace state via tools.

### subscribes (Blackboard Pattern)

Auto-dispatch the agent when specific Windows change:

```typescript
class MarketAgent extends Agent {
    subscribes = ['prices', 'signals'];
    subscribeCooldown = 10_000;  // default: 5000ms

    onWindowChange(windowName: string, event: any): string | null {
        if (windowName === 'prices' && event.items?.[0]?.btc > 70_000) {
            return `BTC above 70k! Check the prices window.`;
        }
        return null;  // skip dispatch
    }
}
```

See [Coordination → Agent Subscribes](./coordination.md#agent-subscribes-blackboard) for full docs.

---

## Prompt Rendering

### render()

Workspace is rendered as XML and injected into the agent's system prompt:

```typescript
workspace.render();
```

Produces:

```xml
<workspace name="task-board">
  <!-- Each registered Window renders its own content here -->
  <task-board>
    ... window items ...
  </task-board>

  <state>
    {"stats": {"totalCreated": 5, "totalCompleted": 2}, "lastActivity": [...]}
  </state>
</workspace>
```

If there are no windows and the shared state is empty, `render()` returns an empty string (nothing injected into prompt).

### Filtering Windows

```typescript
workspace.render(['market', 'signals']);
// Only renders 'market' and 'signals' windows
```

This is what `agent.windows` uses internally — on each turn, the agent loop calls `workspace.render(agent.windows)`.

---

## Persistence

### toJSON / loadJSON

```typescript
// Serialize
const data = workspace.toJSON();
// { name: 'task-board', state: {...}, windows: { board: {...} } }

// Restore
workspace.loadJSON(data);
// State is fully restored
```

### Automatic Persistence

When `DriftServer` has storage enabled, workspace state is automatically persisted:

1. **On change** — debounced at 100ms (max 10 writes/second to SQLite)
2. **On startup** — restored from SQLite via `storage.loadWorkspace(name)`

```
Workspace.setState({ stats: updated })
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

### Events (Server → Client)

| Event | Payload | When |
|-------|---------|------|
| `workspace:changed` | `{ name, action, state, patch?, windowName? }` | Any workspace write or window change |

**On client connect**, the server sends the current workspace state as an initial `workspace:changed` event with `action: 'sync'`.

**React hook usage (drift/react):**

```typescript
import { useWorkspace } from 'drift/react';

function Dashboard() {
    const { state, setState, windowNames } = useWorkspace();

    // state — full reactive workspace state
    // setState(patch) — send workspace:setState
    // windowNames — list of registered window names
}
```

---

## Server Wiring

```
DriftServer.start()
  1. Create workspace (from options.workspace)
  2. Inject into all agents: agent.workspace = workspace
  3. Register agent windows: workspace.addWindow(name, window)
  4. Restore from SQLite: workspace.loadJSON(saved)
  5. Pass to createWSHandler()
  6. Wire change events:
     → broadcast workspace:changed
     → debounced persist to SQLite
     → triggerManager.evaluate('workspace', event)
  7. Generate subscription triggers from agent.subscribes
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
│  │  _windows: Map<string, Window>                       │    │
│  │    'board'  → TaskBoardWindow                        │    │
│  │    'files'  → CodebaseWindow                         │    │
│  │  _state:  { stats: {...}, lastActivity: [...] }      │    │
│  └──────────────────────────────────────────────────────┘    │
│                           │                                   │
│          ┌────────────────┼─────────────────┐                │
│          ▼                ▼                 ▼                │
│   addWindow()         setState()       getWindow()           │
│   removeWindow()      (shallow merge)  windowNames           │
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
| `Workspace<S>` class | `state/workspace.ts` | Base class |
| `WorkspaceChangeEvent` | `state/workspace.ts` | Change event type |
| `agent.workspace` | `core/agent.ts` | Injected reference |
| `agent.windows` | `core/agent.ts` | Prompt filtering — which windows to render |
| `agent.subscribes` | `core/agent.ts` | Blackboard subscriptions |
| WS broadcast + persist | `server/ws.ts` | Change event wiring |
| Workspace restoration | `server/index.ts` | Startup loading |
| `saveWorkspace` / `loadWorkspace` | `storage/sqlite-storage.ts` | SQLite persistence |

---

## Workspace vs Window

| Aspect | Workspace | Window |
|--------|-----------|--------|
| **Scope** | One per server, shared by ALL agents | One or more per agent, agent-specific |
| **Data model** | Named Windows + shared state | Items collection + state object |
| **Role** | Workstation — organizes and holds Windows | Data container for a specific domain |
| **Use case** | Cross-agent shared context, global state | Agent context: files, tasks, board items |
| **Prompt injection** | `<workspace>` XML with named windows + state | `<window>` XML with items |
| **Persistence** | Debounced SQLite | SQLite on change |

**When to use Workspace state:**
- Cross-agent shared metrics (velocity, totals, counters)
- Activity logs visible to all agents
- Global configuration that agents can modify

**When to use Windows (inside Workspace):**
- Agent-specific context (open files, board items)
- CRUD collections with add/remove/update
- Data that needs custom `render()` for agent prompts

---

## Testing

### Unit Testing

```typescript
import { Workspace } from 'drift';
import { Window } from 'drift';

const ws = new Workspace('test', { counter: 0, items: [] });

// Read
assert(ws.state.counter === 0);

// Write
ws.setState({ counter: 42 });
assert(ws.state.counter === 42);

// Window management
const win = new Window();
ws.addWindow('data', win);
assert(ws.hasWindow('data'));
assert(ws.windowNames.length === 1);

const retrieved = ws.getWindow('data');
assert(retrieved === win);

ws.removeWindow('data');
assert(!ws.hasWindow('data'));
```

### Testing Change Events

```typescript
const events: WorkspaceChangeEvent[] = [];
ws.on('change', (e) => events.push(e));

ws.setState({ counter: 5 });
assert(events.length === 1);
assert(events[0].action === 'setState');
assert(events[0].state.counter === 5);

ws.addWindow('test', new Window());
assert(events.length === 2);
assert(events[1].action === 'windowAdded');
assert(events[1].windowName === 'test');
```

### Serialization Roundtrip

```typescript
const data = ws.toJSON();
const ws2 = new Workspace('test', { counter: 0, items: [] });
ws2.loadJSON(data);
assert(ws2.state.counter === ws.state.counter);
```
