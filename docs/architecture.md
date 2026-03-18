# Drift — Technical Architecture Reference

> **Purpose**: Complete technical reference for the current state of Drift's multi-agent architecture. Intended for onboarding a new agent/session to implement **inter-agent coordination and synchronization**.

---

## Project Structure (Key Paths)

```
drift/
├── packages/drift/src/
│   ├── core/
│   │   ├── agent.ts              ← Agent base class (prompt building, tool execution, workspace injection)
│   │   ├── window.ts             ← Window<T,S> base class (reactive item collection + state)
│   │   ├── workspace.ts          ← Workspace<S> shared state across agents
│   │   ├── session.ts            ← Session (conversation history, run lifecycle)
│   │   └── sqlite-storage.ts     ← SQLite persistence (sessions, messages, windows, workspace)
│   ├── server/
│   │   ├── index.ts              ← DriftServer (HTTP + WS, agent/window discovery, startup flow)
│   │   └── ws.ts                 ← WebSocket handler (message routing, session mgmt, event broadcasting)
│   └── windows/
│       └── codebase-window.tsx   ← Built-in file browser window
│
├── packages/drift-react/src/
│   ├── provider.tsx              ← DriftProvider (WS connection, event dispatch)
│   ├── use-chat.ts               ← useChat() — ref-based agent chat hook
│   ├── use-window.ts             ← useWindow() — reactive window items/state
│   ├── use-workspace.ts          ← useWorkspace() — reactive workspace state
│   ├── use-stream-buffer.ts      ← useStreamBuffer() — RAF text animation
│   ├── use-sessions.ts           ← useSessions() — session list management
│   ├── use-thread.ts             ← useThread() — per-item inline chat threads
│   └── types.ts                  ← Shared TypeScript types
│
├── examples/task-board/
│   ├── server/
│   │   ├── index.ts              ← Server entry (workspace init, DriftServer config)
│   │   ├── agents/
│   │   │   ├── task-agent.ts     ← CRUD agent (create/move/update/delete tasks)
│   │   │   ├── planner-agent.ts  ← Project decomposition agent
│   │   │   └── reviewer-agent.ts ← Quality review agent
│   │   └── windows/
│   │       └── task-board.ts     ← TaskBoardWindow extends Window
│   └── app/
│       ├── components/
│       │   ├── Chat.tsx          ← Agent selector tabs + chat (per-agent sessionIds)
│       │   ├── Board.tsx         ← Kanban board + stats dashboard
│       │   ├── Sidebar.tsx       ← Session list with agent badges
│       │   └── StreamingMarkdown.tsx ← Markdown renderer for streaming
│       ├── hooks/index.ts        ← Re-exports drift-react hooks
│       └── lib/theme.ts          ← Agent colors + lucide-react icon mapping
│
├── test/unit/
│   └── workspace.test.ts         ← 21 workspace unit tests
│
└── docs/
    └── window.md                 ← Window API documentation
```

---

## Core Systems

### 1. Window<T, S> — Per-Agent Reactive Context

**File**: `packages/drift/src/core/window.ts` (189 lines)

Two-layer data model:
- **Items**: `Map<string, T>` — domain objects (tasks, files, positions)
- **State**: `S` — arbitrary state object (like React useState)

```typescript
// Key methods
window.add(item: T): void           // Add item, emit 'change'
window.remove(id: string): void     // Remove item by id
window.update(id, patch): void      // Partial update on item
window.get(id): T | undefined       // Read single item
window.list(): T[]                  // All items as array
window.setState(patch): void        // Merge into state
window.render(): string             // XML for agent prompt (override in subclass)
window.toJSON() / loadJSON()        // Serialization
```

**Event**: Emits `'change'` with `WindowChangeEvent` on every mutation.

**Shared instance rule**: `DriftServer.start()` ensures agents with the same window class name share **one instance** (`packages/drift/src/server/index.ts:89-100`). The server replaces duplicate window references so all agents read/write the same data.

**Persistence**: Window state is saved to SQLite after each agent `run()` completes (`ws.ts:225-237`) under key `('__shared__', className)`. Restored on server startup (`ws.ts:866-878`).

---

### 2. Workspace<S> — Shared State Across Agents

**File**: `packages/drift/src/core/workspace.ts` (193 lines)

Flat key-value store where top-level keys are "slices". Inspired by **Ruflo's** `shared_state` pattern.

```typescript
// Construction
const ws = new Workspace('task-board', { stats: {...}, lastActivity: [] });

// Read (returns deep copy via structuredClone)
ws.select('stats')                                // → safe copy of stats slice
ws.state                                          // → full readonly state
ws.version('stats')                               // → current version number
ws.versions                                       // → all version numbers

// Write
ws.setState({ stats: newStats })                  // Shallow merge (bumps versions)
ws.setSlice('stats', newStats)                    // Replace one slice atomically
ws.setSlice('stats', val, expectedVersion)        // Optimistic locking (returns false on conflict)

// Agent prompt injection
ws.render(['stats'])                              // → XML for specific slices
ws.render()                                       // → XML for all slices
```

**Key design decisions**:
- `structuredClone` on reads prevents accidental mutation
- Per-slice versioning enables optimistic concurrency
- `render(sliceKeys?)` injects selected slices into agent's system prompt via `_buildSystemPrompt()` in `agent.ts:569-620`

**Agent binding**: Each agent declares `workspaceSlices: string[]` — only those slices are injected into the prompt. Set in `DriftServer.start()` (`index.ts:99-108`): `agent.workspace = this._workspace`.

**Persistence**: Debounced writes to SQLite `workspace_state` table (max 1x/100ms). Restored on startup (`index.ts:104-107`).

**UI Sync**: `useWorkspace()` hook in drift-react. WS protocol:
| Client → Server | Server → Client |
|---|---|
| `workspace:setState` | `workspace:changed` (broadcast) |
| `workspace:setSlice` | `workspace:changed` (broadcast) |
| _(on connect)_ | `workspace:changed` (full sync) |

---

### 3. Agent Base Class — Tool Context & Prompt Building

**File**: `packages/drift/src/core/agent.ts`

Key properties:
```typescript
agent.window: Window<any, any>      // Shared window instance
agent.workspace: Workspace<any>     // Shared workspace (set by server)
agent.workspaceSlices: string[]     // Which workspace slices to inject into prompt
agent.model: string                 // Claude model
```

**System prompt injection** (method `_buildSystemPrompt`, line ~569):
```
1. Agent's own system prompt
2. workspace.render(workspaceSlices)  ← workspace XML
3. window.render()                    ← window XML (items + state)
```

**Tool context**: When a tool executes, it receives `ToolContext` containing:
```typescript
{
    window: agent.window,        // Tools can read/write the window
    workspace: agent.workspace,  // Tools can read/write workspace
    session: Session,            // Current conversation session
}
```

Agents access these in tools via `this.window` and `this.workspace` (class-based agents with `@tool` decorator).

---

### 4. DriftServer — Startup Flow

**File**: `packages/drift/src/server/index.ts` (371 lines)

`DriftServer.start()` sequence:
1. **Load agents** — auto-discover from `agentsDir` + `windowsDir`
2. **Share windows** — agents with same window class get ONE instance (line 89-100)
3. **Inject workspace** — set `agent.workspace` on all agents + restore from SQLite (line 99-108)
4. **Resolve UI** — serve static files from `ui` directory
5. **Create HTTP server** + WebSocket handler
6. **Restore sessions** — load from SQLite, restore window/workspace state

---

### 5. WebSocket Handler — Session & Event Routing

**File**: `packages/drift/src/server/ws.ts` (905 lines)

**On client connect** (line 112-150):
1. Send `agents:list` (all registered agents)
2. Send `sessions:list` (all saved sessions)
3. Send `window:changed` with `action: 'sync'` (full window state)
4. Send `workspace:changed` (full workspace state)

**Chat routing** (`chat:send` handler, line 187-243):
```typescript
// msg = { action: 'chat:send', agent: 'reviewer-agent', sessionId: 'abc:reviewer-agent', message: '...' }
const agent = _resolveAgent(msg.agent);       // Find agent by name
let session = sessions.get(sessionId);        // Get or create session
if (!session) {
    session = new Session(agent, { id: sessionId });  // ⚠ Session BINDS to this agent
}
await session.run(msg.message);
```

> **CRITICAL**: Sessions bind to the agent that created them. To use multiple agents, the client must use **per-agent sessionIds** (e.g., `{baseSessionId}:{agentName}`).

**Event broadcasting**: Agent events (text, thinking, tool, done) are wired via `_wireAgentEvents()` and broadcast to all connected clients with `agent` and `sessionId` fields.

---

### 6. useChat — Ref-Based React Hook

**File**: `packages/drift-react/src/use-chat.ts` (338 lines)

Uses **refs** (not state) for agent name and session ID in all closures to prevent stale closure issues when switching agents:

```typescript
const activeAgentRef = useRef(agentName);      // Always current
const sessionIdLiveRef = useRef(sessionId);     // Always current

// Subscribe effect depends ONLY on 'subscribe' — no teardown on agent switch
useEffect(() => {
    return subscribe((event) => {
        if (event.sessionId && event.sessionId !== sessionIdLiveRef.current) return;
        // ... handle events
    });
}, [subscribe]);  // ← stable dependency

// Send uses refs too
const send = useCallback((text) => {
    wsSend({ agent: activeAgentRef.current, sessionId: sessionIdLiveRef.current, ... });
}, [wsSend]);  // ← stable dependency
```

**Agent switch flow**: When `agentName` prop changes, an effect syncs the ref, clears messages, and requests `chat:history` for the new agent.

---

### 7. useStreamBuffer — RAF Streaming Animation

**File**: `packages/drift-react/src/use-stream-buffer.ts` (120 lines)

Buffers streaming text and reveals characters progressively via `requestAnimationFrame`:

```typescript
const { messages: raw } = useChat('agent');
const messages = useStreamBuffer(raw, { charsPerFrame: 3 });
```

- Only animates the **last assistant message** during streaming
- Completed messages pass through unchanged
- Non-text parts (thinking, tools) are never buffered
- ~180 chars/sec at 60fps with default `charsPerFrame: 3`

---

## Task Board — Multi-Agent Example

### Agents

| Agent | File | Role | Tools |
|-------|------|------|-------|
| `task-agent` | `agents/task-agent.ts` | CRUD | `create_task`, `move_task`, `update_task`, `delete_task` |
| `planner-agent` | `agents/planner-agent.ts` | Decomposition | `plan_project`, `create_task`, `suggest_priorities` |
| `reviewer-agent` | `agents/reviewer-agent.ts` | Quality review | `review_task`, `summarize_sprint`, `move_task` |

All 3 agents:
- Share **one `TaskBoardWindow`** instance (enforced by DriftServer)
- Have `workspaceSlices: ['stats', 'lastActivity']`
- Call `_trackStats()` helper to update workspace on each tool call

### Workspace Slices

```typescript
const workspace = new Workspace('task-board', {
    stats: { totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0 },
    lastActivity: [] as string[],
});
```

### UI Architecture (Chat.tsx)

```typescript
// Per-agent sessionIds prevent session binding conflicts
const agentSessionId = `${sessionId}:${selectedAgent}`;
const { messages: raw, send } = useChat(selectedAgent, { sessionId: agentSessionId });
const messages = useStreamBuffer(raw, { charsPerFrame: 3 });
```

- **Agent tabs**: lucide-react icons (Zap, ClipboardList, Search)
- **Stats dashboard**: animated cards from workspace stats
- **Agent badges**: color-coded in sidebar sessions

---

## Reference Project: Ruflo

**Git**: `https://github.com/ruvnet/ruflo` (analyzed in this conversation)

Ruflo is an agent orchestration platform with patterns we should reference for **inter-agent coordination**:

### Key Patterns to Study

1. **Swarm coordination** — Agents organized in swarms with a coordinator agent
2. **Task queues** — Internal task system where agents produce/consume work items
3. **Shared state** — Global state container (our `Workspace` is inspired by this)
4. **Agent-to-agent messaging** — Agents can dispatch messages to other agents
5. **Workflow DAG** — Directed acyclic graph of agent tasks with dependencies

### What We Need for Synchronization

Currently missing (next phase of work):

1. **Agent dispatch**: `workspace.dispatch('reviewer-agent', 'review these tasks')` — one agent triggers another
2. **Event triggers**: When workspace changes, subscribed agents auto-activate
3. **Task queue**: Internal queue where planner creates tasks → task-agent consumes them
4. **Coordination protocol**: WS messages for agent-to-agent communication
5. **UI indicators**: Show which agents are actively working, with floating chat windows

### Suggested Approach

```
User → PlannerAgent → creates tasks in Window
                    → dispatches to TaskAgent
                    → dispatches to ReviewerAgent
         ↓
All agents share Workspace (stats, activity log)
All agents share Window (task items)
         ↓
UI sees real-time updates via window:changed + workspace:changed events
```

The coordination layer should sit between the WS handler and the agent — intercepting workspace/window changes and triggering agent runs based on rules or subscriptions.

---

## SQLite Persistence

**File**: `packages/drift/src/core/sqlite-storage.ts`

| Table | Contents | Key |
|-------|----------|-----|
| `sessions` | Session metadata (id, agent, created_at) | `id` |
| `messages` | Conversation history per session | `session_id` |
| `window_state` | Serialized window data | `(session_id, class_name)` |
| `workspace_state` | Serialized workspace data | `name` |

Window uses `('__shared__', className)` as key for shared windows.
Workspace uses workspace `name` as key.

---

## Key Gotchas & Lessons Learned

1. **Session ↔ Agent binding**: Server `Session` objects bind to the first agent that creates them. Multi-agent UIs MUST use per-agent sessionIds.

2. **Window sharing**: `DriftServer.start()` replaces duplicate window instances. Without this, each agent has its own copy and state diverges.

3. **Stale closures in React**: `useChat` uses refs (`activeAgentRef`, `sessionIdLiveRef`) instead of state in subscribe/send closures. State-based closures cause missed events during React re-render cycles.

4. **Workspace version conflicts**: `setSlice` with `expectedVersion` returns `false` on conflict. Agents should read → modify → write with version check for safe concurrent updates.

5. **Event filtering**: WS events are filtered by `sessionId` first, then `agent` name. Events with matching sessionId pass regardless of agent name.
