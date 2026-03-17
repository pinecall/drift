# Window — Exhaustive Guide

The Window is Drift's core data container that bridges agents, UI, and persistence. Think of it as a reactive, shared blackboard that the agent reads, the UI renders, and the server persists.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Window\<T, S\> Base Class](#windowt-s-base-class)
  - [Two Data Layers](#two-data-layers)
  - [Items CRUD](#items-crud)
  - [State Management](#state-management)
  - [Turn Counter](#turn-counter)
- [Subclassing — Custom Windows](#subclassing--custom-windows)
  - [render() — Agent Prompt Injection](#render--agent-prompt-injection)
  - [renderMetadata()](#rendermetadata)
  - [Example: TaskBoardWindow](#example-taskboardwindow)
- [Shared Windows](#shared-windows)
- [UI Sync — useWindow()](#ui-sync--usewindow)
  - [React Hook API](#react-hook-api)
  - [Reading Data](#reading-data)
  - [Mutating Data](#mutating-data)
  - [WebSocket Protocol](#websocket-protocol)
  - [Initial Sync on Connect](#initial-sync-on-connect)
- [Persistence Layer](#persistence-layer)
  - [What Gets Persisted](#what-gets-persisted)
  - [When Does It Save](#when-does-it-save)
  - [When Does It Restore](#when-does-it-restore)
  - [Serialization Format](#serialization-format)
  - [Storage Interface](#storage-interface)
  - [SQLite Schema](#sqlite-schema)
  - [Custom Storage Backends](#custom-storage-backends)
- [Nudge — UI-Triggered Agent Explanations](#nudge--ui-triggered-agent-explanations)
- [Threads — Contextual Mini-Chats](#threads--contextual-mini-chats)
  - [useThread() API](#usethread-api)
  - [ThreadOptions](#threadoptions)
  - [UseThreadReturn](#usethreadreturn)
  - [Server Handlers](#server-handlers-threadsend--threadhistory)
  - [WebSocket Protocol](#websocket-protocol-threads)
  - [How Threads Relate to Windows](#how-threads-relate-to-windows)
  - [Floating Thread Chat UI](#floating-thread-chat-ui)
- [Full Data Flow](#full-data-flow)
  - [User Mutates via UI](#user-mutates-via-ui)
  - [Agent Mutates via Tools](#agent-mutates-via-tools)
  - [Server Restart (Restore)](#server-restart-restore)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  React UI                                                          │
│                                                                    │
│  useWindow()  ──→  items[], state  ──→  renders Board/Cards/etc.  │
│       │                                                            │
│       │  updateItem(), removeItem(), setState()                    │
│       ▼                                                            │
│  WebSocket   ─── window:item:update / window:setState ───▶        │
└────────────────────────────────────────────────────────────────────┘
         │                                           │
         │  window:changed (broadcast)               │
         │  ◀────────────────────────────────────     │
         ▼                                           ▼
┌────────────────────────────────────────────────────────────────────┐
│  DriftServer (ws.ts)                                               │
│                                                                    │
│  handleMessage()                                                   │
│    ├── window:item:update  →  win.update(id, patch)               │
│    ├── window:item:remove  →  win.remove(id)                      │
│    ├── window:setState     →  win.setState(patch)                 │
│    └── _persistWindow()    →  storage.saveWindow('__shared__')    │
│                                                                    │
│  Window.on('change')  →  broadcast({ event: 'window:changed' })  │
└────────────────────────────────────────────────────────────────────┘
         │                                           │
         ▼                                           ▼
┌─────────────────────┐                ┌─────────────────────────────┐
│  Agent                │                │  SQLite (.drift/drift.db)   │
│                       │                │                             │
│  this.window.render()│                │  window_state table          │
│  → injected into     │                │  ├── session_id: __shared__ │
│    system prompt     │                │  ├── window_class            │
│                       │                │  └── state (JSON blob)      │
│  Tools modify window: │                │                             │
│  this.window.add()   │                │  Auto-restore on startup    │
│  this.window.update()│                └─────────────────────────────┘
│  this.window.remove()│
└─────────────────────┘
```

---

## Window\<T, S\> Base Class

**Import:** `import { Window } from 'drift'`

```typescript
class Window<T extends WindowItem, S extends Record<string, any>> extends EventEmitter
```

### Two Data Layers

| Layer | Type | Purpose | Access |
|-------|------|---------|--------|
| **items** | `Map<string, T>` | Collection of domain objects (tasks, files, etc.) | `add()`, `get()`, `update()`, `remove()`, `list()` |
| **state** | `S` | Arbitrary state (filters, settings, activity logs) | `setState()`, `.state` |

Both emit `'change'` on mutation → triggers UI sync and persistence.

### Items CRUD

```typescript
// Add an item (replaces if id exists)
window.add('task-1', { id: 'task-1', title: 'Fix bug', status: 'todo' });

// Patch an existing item (shallow merge)
window.update('task-1', { status: 'done' });

// Remove by id
window.remove('task-1');

// Read
window.get('task-1');       // single item or undefined
window.has('task-1');       // boolean
window.list();              // T[] — all items
window.keys();              // string[] — all ids
window.size;                // number
window.clear();             // remove all
```

Every write (`add`, `remove`, `update`, `clear`) emits `'change'` with:

```typescript
interface WindowChangeEvent<T, S> {
    action: 'add' | 'remove' | 'update' | 'clear' | 'setState';
    id?: string;          // affected item id
    item?: T;             // full item (add/update)
    patch?: Partial<T>;   // what changed
    items: T[];           // full snapshot
    state: S;             // full state snapshot
}
```

### State Management

```typescript
// Read
window.state;  // Readonly<S>

// Write — shallow merge (like React setState)
window.setState({ filter: 'todo' });
// { filter: 'all', count: 5 } + { filter: 'todo' } = { filter: 'todo', count: 5 }
```

### Turn Counter

```typescript
window.nextTurn();  // increment (called by agent each iteration)
window.turn;        // current turn number (persisted)
```

---

## Subclassing — Custom Windows

Create domain-specific windows by extending `Window<T, S>`:

```typescript
import { Window, type WindowItem } from 'drift';

interface TaskItem extends WindowItem {
    id: string;
    title: string;
    status: 'todo' | 'doing' | 'done';
    priority: 'low' | 'medium' | 'high';
    createdAt: number;
}

interface BoardState {
    filter: 'all' | 'todo' | 'doing' | 'done';
    activity: Activity[];
}

class TaskBoardWindow extends Window<TaskItem, BoardState> {
    constructor() {
        super({ filter: 'all', activity: [] });  // initial state
        // Optional: seed with default data
    }
}
```

### render() — Agent Prompt Injection

Override `render()` to control what the agent sees in its system prompt:

```typescript
override render(): string {
    const tasks = this.list();
    return `
<window name="task-board">
  Total: ${tasks.length} tasks

  ## Todo
  ${tasks.filter(t => t.status === 'todo').map(t => `- [${t.id}] ${t.title}`).join('\n')}

  ## In Progress  
  ${tasks.filter(t => t.status === 'doing').map(t => `- [${t.id}] ${t.title}`).join('\n')}
</window>`;
}
```

The return value is injected into the agent's system prompt every turn. Return `''` to skip injection.

### renderMetadata()

Short summary for user messages:

```typescript
override renderMetadata(): string {
    return `Board: ${this.size} tasks`;
}
```

### Example: TaskBoardWindow

See [`examples/task-board/server/windows/task-window.tsx`](../examples/task-board/server/windows/task-window.tsx) for a full implementation with:
- Custom `TaskItem` and `BoardState` types
- JSX-based `render()` using Drift's built-in JSX runtime
- `logActivity()` method for unified user + agent activity tracking
- Seed tasks in constructor

---

## Shared Windows

When multiple agents share the same Window class, Drift creates **one instance** shared across all agents:

```typescript
// config.ts — _shareWindow()
// If two agents both have `window = new TaskBoardWindow()`,
// the second agent's window is replaced with the first's instance.
```

This means:
- All agents see the same items and state
- Any agent's tool modifying the window is visible to all
- The UI sees one unified Window

Sharing is automatic — determined by `window.constructor.name`.

---

## UI Sync — useWindow()

### React Hook API

```typescript
import { useWindow } from 'drift/react';

function Board() {
    const {
        items,       // T[] — reactive, updates on every server change
        state,       // S — reactive window state
        updateItem,  // (id, patch) => void — patch an item
        removeItem,  // (id) => void — delete an item
        setState,    // (patch) => void — update state (shallow merge)
        open,        // (path) => void — open a file (CodebaseWindow)
        close,       // (path) => void — close a file
        refresh,     // (path?) => void — refresh file(s)
        disable,     // (path) => void — exclude from agent prompt
        enable,      // (path) => void — re-include in prompt
        size,        // number — item count
    } = useWindow<TaskItem, BoardState>();
}
```

### Reading Data

`items` and `state` are reactive — they update automatically when the server broadcasts `window:changed`:

```tsx
function Board() {
    const { items, state } = useWindow<TaskItem, BoardState>();

    const todoTasks = items.filter(t => t.status === 'todo');
    const currentFilter = state.filter;

    return <div>{todoTasks.map(t => <Card key={t.id} task={t} />)}</div>;
}
```

### Mutating Data

Mutations go through WebSocket → server → window → broadcast back:

```tsx
// Update a task's status
updateItem('task-1', { status: 'done' });

// Remove a task
removeItem('task-1');

// Update board state
setState({ filter: 'doing' });
```

The flow:
1. `updateItem(id, patch)` → sends `{ action: 'window:item:update', id, patch }` via WS
2. Server calls `window.update(id, patch)` → emits `'change'`
3. Server broadcasts `{ event: 'window:changed', items, state }` to all clients
4. Server calls `_persistWindow()` → saves to SQLite
5. All `useWindow()` hooks update `items` and `state`

### WebSocket Protocol

**Client → Server:**

| Action | Payload | Server Handler |
|--------|---------|----------------|
| `window:item:update` | `{ id, patch }` | `win.update(id, patch)` |
| `window:item:remove` | `{ id }` | `win.remove(id)` |
| `window:setState` | `{ patch }` | `win.setState(patch)` |
| `window:open` | `{ path }` | `win.open(path)` |
| `window:close` | `{ path }` | `win.close(path)` |
| `window:refresh` | `{ path? }` | `win.refresh(path)` |
| `window:disable` | `{ path }` | `win.disable(path)` |
| `window:enable` | `{ path }` | `win.enable(path)` |

**Server → Client:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `window:changed` | `{ action, items, state, id?, item?, patch? }` | Any window mutation |

### Initial Sync on Connect

When a WebSocket client connects, the server sends the current window state immediately:

```typescript
// ws.ts — on connection
send(ws, {
    event: 'window:changed',
    windowClass: className,
    action: 'sync',
    items: window.list(),
    state: window.state,
});
```

This ensures `useWindow()` has data from the first render — no loading state needed.

---

## Persistence Layer

### What Gets Persisted

| Data | Serialized As | Storage Key |
|------|---------------|-------------|
| Items (`Map<string, T>`) | `[string, T][]` (entries) | `__shared__` + window class |
| State (`S`) | JSON object | same row |
| Turn counter | number | same row |

### When Does It Save

Window state is saved to storage in these situations:

1. **UI mutations** — immediately after every `window:item:update`, `window:item:remove`, `window:setState`
2. **After agent runs** — in the `finally` block of `chat:send` and `chat:nudge`

```typescript
// ws.ts — after UI mutation
function _persistWindow(agentName, win) {
    if (!storage) return;
    storage.saveWindow('__shared__', win.constructor.name, win.toJSON());
}

// After window:item:update
win.update(msg.id, msg.patch);
_persistWindow(msg.agent, win);
```

### When Does It Restore

On server startup, `_restoreSessions()` restores shared windows **once** before restoring sessions:

```typescript
// ws.ts — _restoreSessions()
for (const agent of agents) {
    if (agent.window) {
        const winData = storage.loadWindow('__shared__', agent.window.constructor.name);
        if (winData) {
            agent.window.loadJSON(winData);  // clear() + repopulate
        }
    }
}
```

This means:
- Constructor runs first (may seed default data)
- `loadJSON()` then **replaces everything** — `clear()` + repopulate from DB
- If no saved data exists, seed data from the constructor remains

### Serialization Format

```typescript
// window.toJSON()
{
    items: [
        ["task-1", { id: "task-1", title: "Fix bug", status: "done", ... }],
        ["task-2", { id: "task-2", title: "Add tests", status: "todo", ... }],
    ],
    state: {
        filter: "all",
        activity: [
            { source: "user", action: "Moved task", at: 1710000000000 },
            { source: "agent", agentName: "task-agent", action: "Created task", at: 1710000001000 },
        ]
    },
    turn: 5
}

// window.loadJSON(data) — restores from above format
// 1. Clears all items
// 2. Repopulates from data.items
// 3. Replaces state with data.state
// 4. Restores turn counter
```

### Storage Interface

```typescript
interface Storage {
    // Window state
    saveWindow(sessionId: string, windowClass: string, data: any): void;
    loadWindow(sessionId: string, windowClass: string): any | null;

    // Also handles sessions and messages (see storage.ts)
    saveSession(data: SessionData): void;
    loadSession(id: string): SessionData | null;
    listSessions(): SessionData[];
    deleteSession(id: string): void;
    saveMessages(sessionId: string, messages: Message[]): void;
    loadMessages(sessionId: string): Message[];

    close(): void;
}
```

### SQLite Schema

```sql
CREATE TABLE window_state (
    session_id    TEXT NOT NULL,     -- '__shared__' for shared windows
    window_class  TEXT NOT NULL,     -- e.g. 'TaskBoardWindow'
    state         TEXT NOT NULL,     -- JSON blob from toJSON()
    PRIMARY KEY (session_id, window_class)
);
```

The `__shared__` key has a corresponding pseudo-session in the `sessions` table to satisfy the FK constraint.

### Custom Storage Backends

Implement the `Storage` interface to use Redis, Postgres, S3, etc:

```typescript
import { DriftServer, type Storage } from 'drift';

class RedisStorage implements Storage {
    saveWindow(sessionId, windowClass, data) { /* redis.set(...) */ }
    loadWindow(sessionId, windowClass) { /* redis.get(...) */ }
    // ... other methods
}

const server = new DriftServer({
    storage: new RedisStorage(),
});
```

---

## Nudge — UI-Triggered Agent Explanations

`nudge()` lets the UI trigger agent responses from interactions (clicks, drags, etc.):

```typescript
import { useChat } from 'drift/react';

const { nudge } = useChat('task-agent', { sessionId });

// Click a card → agent explains
nudge(
    `User clicked task "${task.title}". Explain briefly.`,
    { system: 'Be brief, 1-2 sentences. No tool calls.' }
);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | agent's model | Override model for this nudge |
| `ephemeral` | `boolean` | `false` | Don't save to conversation history |
| `system` | `string` | `'Respond briefly and helpfully.'` | System instruction for this nudge |

**Behavior:**
- Auto-aborts current agent run if streaming (interrupt mode)
- Message prefixed with `[NUDGE from UI]` so agent knows it's UI-triggered
- Response streams through same `chat:started/text/done` events
- Server polls until session stops before starting nudge (prevents race conditions)

---

## Threads — Contextual Mini-Chats

Threads are scoped conversations attached to specific entities (cards, items, etc.). Unlike the main chat, each thread has its own isolated history. Think of them like Slack threads — focused discussions that don't pollute the main channel.

```
┌──────────────────────────────────────────┐
│  Main Chat (useChat)                      │  ← full conversation with agent
│  "Create 3 tasks for the sprint"          │
│  "Move Fix Bug to done"                  │
└──────────────────────────────────────────┘

┌────────────────────────┐  ┌────────────────────────┐
│  Thread: card:task-1    │  │  Thread: card:task-3    │  ← scoped mini-chats
│  "What does this API   │  │  "Is this blocked?"     │
│   schema need?"         │  │  "By whom?"             │
│  "REST + GraphQL"       │  │  "The auth team"        │
└────────────────────────┘  └────────────────────────┘
```

### useThread() API

```typescript
import { useThread } from 'drift/react';

function TaskCard({ task, sessionId }) {
    const thread = useThread({
        agent: 'task-agent',
        threadId: `card:${task.id}`,
        parentSession: sessionId,
        context: `Task: "${task.title}" — ${task.description} (status: ${task.status}, priority: ${task.priority})`,
        system: 'Help the user understand this task. Be concise.',
    });

    // thread.messages      — ChatMessage[] (this thread's history only)
    // thread.send('What does this involve?')
    // thread.isStreaming    — agent is responding
    // thread.hasHistory    — boolean, has previous messages
    // thread.sessionId     — "abc123::thread::card:task-1"
}
```

**Session ID derivation:**

```
parentSession::thread::threadId
     │                    │
     │                    └── unique per entity (e.g. 'card:task-1')
     └── main session id (e.g. 'abc123')

Example: "abc123::thread::card:task-1"
```

### ThreadOptions

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `agent` | `string` | yes | Which agent handles this thread |
| `threadId` | `string` | yes | Unique thread identifier (e.g. `'card:task-1'`, `'inspector:file.ts'`) |
| `parentSession` | `string` | yes | Parent session ID — thread inherits the same window access |
| `context` | `string` | yes | Context injected into the agent's system prompt for this thread |
| `model` | `string` | no | Override the agent's model for this thread |
| `system` | `string` | no | Custom system instruction (e.g. `'Be concise and helpful.'`) |

### UseThreadReturn

| Return | Type | Description |
|--------|------|-------------|
| `messages` | `ChatMessage[]` | Thread conversation messages (isolated from main chat) |
| `send(text)` | `void` | Send a message in this thread |
| `abort()` | `void` | Abort the current streaming response |
| `clear()` | `void` | Clear thread history (wipes all messages) |
| `isStreaming` | `boolean` | Is the agent currently responding? |
| `open()` | `void` | Open the thread panel |
| `close()` | `void` | Close the thread panel |
| `toggle()` | `void` | Toggle open/closed |
| `minimize()` | `void` | Minimize — keep history, hide panel |
| `isOpen` | `boolean` | Is the panel currently visible? |
| `isMinimized` | `boolean` | Is the panel minimized? |
| `hasHistory` | `boolean` | Has any previous messages? |
| `sessionId` | `string` | Thread session ID (derived) |
| `lastError` | `string \| null` | Last error message |

### Server Handlers: `thread:send` + `thread:history`

**`thread:send`** (ws.ts):

1. Resolves the agent by name
2. Derives thread session ID: `${parentSession}::thread::${threadId}`
3. Gets or creates a `Session` for this thread (auto-created on first message)
4. If session is running → auto-abort with poll-wait (up to 2s)
5. Builds message with context prefix:
   ```
   [THREAD context: Task: "Fix bug" — status: todo, priority: high]
   [14:23] What does this involve?
   [Thread instruction: Be concise and helpful.]
   ```
6. Optionally overrides agent model
7. Wires `_wireAgentEvents()` → streams `chat:started/text/thinking/tool/done` with `sessionId` = thread session
8. After run: persists session metadata + messages to storage
9. Broadcasts `sessions:updated` and `sessions:created` (if new)

**`thread:history`** (ws.ts):

1. Looks up session by thread session ID
2. If found → sends `chat:history` with the session's conversation messages
3. If not found → sends empty `messages: []`

### WebSocket Protocol (Threads)

**Client → Server (`thread:send`):**

```json
{
    "action": "thread:send",
    "agent": "task-agent",
    "sessionId": "abc123::thread::card:task-1",
    "parentSession": "abc123",
    "threadId": "card:task-1",
    "context": "Task: \"Fix bug\" — status: todo, priority: high",
    "message": "What does this task involve?",
    "model": "haiku",
    "system": "Be concise and helpful."
}
```

**Client → Server (`thread:history`):**

```json
{
    "action": "thread:history",
    "agent": "task-agent",
    "sessionId": "abc123::thread::card:task-1"
}
```

**Server → Client (reuses chat events, filtered by sessionId):**

```json
{ "event": "chat:started", "agent": "task-agent", "sessionId": "abc123::thread::card:task-1" }
{ "event": "chat:text",    "agent": "task-agent", "sessionId": "abc123::thread::card:task-1", "delta": "This task..." }
{ "event": "chat:thinking", "agent": "task-agent", "sessionId": "abc123::thread::card:task-1", "thinking": "..." }
{ "event": "chat:done",    "agent": "task-agent", "sessionId": "abc123::thread::card:task-1", "result": { "text": "...", "cost": 0.001 } }
{ "event": "chat:history", "agent": "task-agent", "sessionId": "abc123::thread::card:task-1", "messages": [...] }
```

The `useThread` hook filters events by `sessionId`, so only events for this specific thread are processed. Multiple threads can run concurrently without interfering.

### How Threads Relate to Windows

```
┌─────────────────────────────────────────────────┐
│  Agent (task-agent)                              │
│                                                  │
│  window = TaskBoardWindow (shared)               │  ← same window for all sessions
│  prompt = "You are a project manager..."         │  ← same agent prompt
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Session: abc123 (main chat)                │ │  ← main conversation
│  │  History: "Create tasks" → "Done! ..."      │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Session: abc123::thread::card:task-1       │ │  ← thread conversation
│  │  Context: "Task: Fix bug — status: todo"    │ │
│  │  History: "What's this?" → "This task..."   │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Session: abc123::thread::card:task-3       │ │  ← another thread
│  │  Context: "Task: Deploy — status: done"     │ │
│  │  History: "Is this blocked?" → "No..."      │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Key points:
- The agent sees the **same window** (full board) in all threads — `render()` output is identical
- The agent uses the **same prompt** (system instruction) + thread `context` prefix
- Each thread has its **own conversation history** — isolated from main chat and other threads
- Thread sessions are **persisted** — messages survive server restarts
- Thread sessions appear in `listSessions()` — they're regular sessions with a derived ID

### Floating Thread Chat UI

The task board example implements a floating chat panel for threads:

```tsx
// Board.tsx — simplified
function Board({ sessionId }) {
    const [threadTask, setThreadTask] = useState<TaskItem | null>(null);

    const handleThread = (task: TaskItem) => setThreadTask(task);

    return (
        <div>
            {/* Board columns with cards... */}
            <Column onThread={handleThread} ... />

            {/* Floating panel — mounts when a task is selected for thread */}
            {threadTask && (
                <ThreadPanel
                    task={threadTask}
                    sessionId={sessionId}
                    onClose={() => setThreadTask(null)}
                />
            )}
        </div>
    );
}
```

The `ThreadPanel` component:
- **Fixed position** at bottom-right of viewport
- **Maximize/minimize/close** controls
- **Chat bubble UI** with markdown rendering
- **Streaming dots** animation while agent responds
- **Empty state** placeholder when no messages yet
- **Auto-scrolls** to latest message
- Uses `useThread()` internally — all state management delegated to the hook

```
┌──────────────────────────────┐
│  💬 Fix API bug      thread  │  ← header with task title
│  ─────────────────────────── │
│                              │
│  🗨 Ask anything about this  │  ← empty state
│     task                     │
│                              │
│  ─────────────────────────── │
│  [Ask about this task...] 📤 │  ← input
└──────────────────────────────┘
```

---

## Full Data Flow

### User Mutates via UI

```
1. User clicks "Move to Done" on a card
2. Board.tsx:  updateItem('task-1', { status: 'done' })
3. useWindow:  send({ action: 'window:item:update', id: 'task-1', patch: { status: 'done' } })
4. WebSocket:  → server
5. ws.ts:      window.update('task-1', { status: 'done' })
6. Window:     _items.set('task-1', { ...old, status: 'done' })
7. Window:     emit('change', { action: 'update', items: [...], state: {...} })
8. ws.ts:      broadcast({ event: 'window:changed', ... })  → all WS clients
9. ws.ts:      _persistWindow()  → storage.saveWindow('__shared__', ...)  → SQLite
10. useWindow: setItems(event.items)  → React re-renders
```

### Agent Mutates via Tools

```
1. Agent tool calls:  this.window.add('task-6', { title: 'New task', ... })
2. Window:            _items.set('task-6', { ... })
3. Window:            emit('change', { action: 'add', ... })
4. ws.ts:             broadcast({ event: 'window:changed', ... })  → all WS clients
5. useWindow:         setItems(event.items)  → React re-renders
6. (after chat:done)  storage.saveWindow(...)  → SQLite
```

### Server Restart (Restore)

```
1. DriftServer starts
2. Agent constructors run  → TaskBoardWindow seeds 5 default tasks
3. _restoreSessions() runs:
   a. Loads '__shared__' window data from SQLite
   b. Calls window.loadJSON(data)  → clear() + repopulate from saved data
   c. Seed tasks are replaced with persisted state
4. Sessions are restored (conversations, etc.)
5. Client connects → gets window:changed with restored data
6. UI renders the persisted board state
```
