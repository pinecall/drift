# drift-react

React hooks & provider for building UIs with the Drift agent framework.

Connects to a running `DriftServer` via WebSocket and provides real-time reactive state for chat, agent windows, and settings.

## Quick Start

```tsx
import { DriftProvider, useChat, useWindow, useDrift, useSessions } from 'drift-react';

function App() {
    return (
        <DriftProvider url="ws://localhost:3100">
            <Chat />
        </DriftProvider>
    );
}
```

---

## API Reference

### `<DriftProvider>`

WebSocket connection context. Wrap your app with this.

```tsx
<DriftProvider
    url="ws://localhost:3100"
    reconnect={true}       // auto-reconnect on disconnect (default: true)
    reconnectDelay={2000}  // ms between reconnect attempts (default: 2000)
>
    {children}
</DriftProvider>
```

Provides low-level access via `useDriftContext()`:

```tsx
const { send, subscribe, connected, agents } = useDriftContext();
```

| Field | Type | Description |
|---|---|---|
| `send` | `(msg: ClientMessage) => void` | Send a raw WS message |
| `subscribe` | `(handler: (event: ServerEvent) => void) => () => void` | Subscribe to all server events. Returns unsubscribe fn |
| `connected` | `boolean` | WebSocket connection status |
| `agents` | `AgentInfo[]` | Available agents from the server |

---

### `useChat(agentName, options?)`

Full chat with streaming, parts-based rendering, tool calls, sessions, and settings.

```tsx
const chat = useChat('developer');                          // auto-generated sessionId
const chat = useChat('developer', { sessionId: 'abc-123' }); // use specific session
```

```tsx
const {
    messages,        // ChatMessage[] — full history, including live assistant message
    send,            // (text: string) => void — send a user message
    abort,           // () => void — abort current run
    clear,           // () => void — clear conversation
    requestHistory,  // () => void — request full history from server
    isStreaming,      // boolean — is the agent currently running?
    lastError,       // string | null — last error message
    config,          // AgentConfig | null — current agent settings
    updateSettings,  // (patch) => void — change model/thinking/effort at runtime
    sessionId,       // string — current session ID
    activeAgent,     // string — current agent name (may change after swap)
    swap,            // (agentName: string) => void — swap agent in the session
} = useChat('developer', { sessionId });
```

**Session switching:** When `sessionId` changes (e.g., user clicks a different session in the sidebar), the hook automatically clears local messages and requests history from the server. Events are filtered by `sessionId` so multiple sessions don't interfere.

#### Parts-based messages

Messages use an ordered `parts` array for rich rendering. Each part is a text block, thinking block, or tool call, rendered in the order they occurred:

```tsx
interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;              // Full text (backward compat)
    timestamp: number;
    parts?: MessagePart[];        // Ordered segments
    status?: string;              // 'streaming' | 'tool' | 'done' | 'error'
}

interface MessagePart {
    type: 'text' | 'thinking' | 'tool';
    content?: string;             // Text or thinking content
    active?: boolean;             // Thinking: still active?
    name?: string;                // Tool: tool name
    params?: any;                 // Tool: parameters
    result?: any;                 // Tool: execution result
    ms?: number;                  // Tool: execution time
    status?: string;              // Tool: 'executing' | 'done' | 'error'
}
```

**Rendering pattern** — iterate parts in order:

```tsx
function Message({ msg }: { msg: ChatMessage }) {
    return (
        <div>
            {msg.parts?.map((part, i) => {
                if (part.type === 'text')     return <Markdown key={i} content={part.content} />;
                if (part.type === 'thinking') return <ThinkingBlock key={i} active={part.active} text={part.content} />;
                if (part.type === 'tool')     return <ToolChip key={i} name={part.name} status={part.status} ms={part.ms} />;
                return null;
            })}
        </div>
    );
}
```

The last assistant message in `messages[]` IS the live streaming message — no separate streaming state needed.

#### Streaming lifecycle

| Server Event | Hook Behavior |
|---|---|
| `chat:started` | Creates new assistant message with `parts: []`, sets `isStreaming = true` |
| `chat:text` | Appends text to last text part, or creates new text part after tool/thinking |
| `chat:thinking` | Creates or updates thinking part |
| `chat:tool` | Appends tool part with `status: 'executing'` |
| `chat:tool:result` | Updates matching tool part with result and `status: 'done'` |
| `chat:done` | Sets `status: 'done'`, `isStreaming = false` |

#### Runtime settings

```tsx
const { config, updateSettings } = useChat('developer');

// Change model at runtime
updateSettings({ model: 'haiku' });

// Toggle thinking
updateSettings({ thinking: false });

// Change effort level
updateSettings({ effort: 'high' });
```

---

### `useSessions()`

Track and manage all server sessions. Subscribes to session lifecycle events.

```tsx
import { useSessions, type SessionInfo } from 'drift-react';

const { sessions, createSession, deleteSession, refreshSessions } = useSessions();
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

**Session events** (auto-subscribed):

| Event | Behavior |
|---|---|
| `sessions:list` | Replaces all sessions (sent on connect) |
| `sessions:created` | Adds new session to the list |
| `sessions:updated` | Updates session metadata (messageCount, lastMessage) |
| `sessions:deleted` | Removes session from the list |

**Session support:** When `sessionId` changes (e.g. user switches sessions in a sidebar), the hook automatically clears local messages and requests history from the server. Events are filtered by `sessionId` so multiple sessions don't interfere.

---

### `useSessions()`

Track and manage all server sessions. Subscribes to session lifecycle events (`sessions:list`, `sessions:created`, `sessions:updated`, `sessions:deleted`).

```tsx
import { useSessions, type SessionInfo } from 'drift-react';

function Sidebar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
    const { sessions, createSession, deleteSession, refreshSessions } = useSessions();

    return (
        <div>
            <button onClick={() => createSession('developer')}>+ New Chat</button>
            {sessions.map(s => (
                <div key={s.id} onClick={() => onSelect(s.id)} style={{ fontWeight: s.id === activeId ? 'bold' : 'normal' }}>
                    {s.lastMessage?.slice(0, 50) || 'New conversation'}
                </div>
            ))}
        </div>
    );
}
```

| Return | Type | Description |
|---|---|---|
| `sessions` | `SessionInfo[]` | All known sessions |
| `createSession(agent?)` | `void` | Create a new empty session |
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

---

### `useWindow<T, S>()`

Real-time reactive window state. Syncs with the server's `Window<T, S>` instance.

```tsx
const {
    items,        // T[] — all items in the window
    state,        // S — window state object
    setState,     // (patch: Partial<S>) => void — update state (shallow merge)
    updateItem,   // (id: string, patch: Partial<T>) => void — update item
    removeItem,   // (id: string) => void — remove item
    open,         // (path: string) => void — open a file (CodebaseWindow)
    close,        // (path: string) => void — close a file
    refresh,      // (path?: string) => void — refresh file(s)
    disable,      // (path: string) => void — exclude from agent prompt
    enable,       // (path: string) => void — re-include in agent prompt
    size,         // number — item count
} = useWindow<TaskItem, BoardState>();
```

#### With CodebaseWindow (file editor)

```tsx
const { items, open, close, disable } = useWindow<FileEntry>();

// Open a file in the agent's context
open('/src/index.ts');

// Remove from agent context
close('/src/old.ts');

// Keep open but exclude from prompt
disable('/src/large-file.ts');
```

#### With custom windows (bidirectional reactivity)

```tsx
interface Task extends WindowItem {
    id: string;
    title: string;
    status: 'todo' | 'doing' | 'done';
}

const { items, updateItem, removeItem, setState } = useWindow<Task, BoardState>();

// User moves a task → agent sees it in next prompt
function handleMove(taskId: string, newStatus: string) {
    updateItem(taskId, { status: newStatus });
    // Log activity so agent knows what happened
    setState({ userActivity: [...state.userActivity, { action: 'moved task', taskId }] });
}

// User deletes a task
function handleDelete(taskId: string) {
    removeItem(taskId);
}
```

Every `updateItem`/`removeItem`/`setState` call:
1. Sends a WebSocket message to the server
2. Server updates the `Window` instance, emitting a `change` event
3. Server broadcasts `window:changed` to all clients
4. All connected UIs re-render with the new state
5. The agent sees the updated state in its next `run()` via `window.render()`

---

### `useDrift()`

Connection status, agent listing, and active agent management.

```tsx
const {
    connected,      // boolean — WebSocket connected?
    agents,         // AgentInfo[] — available agents
    activeAgent,    // string — currently selected agent name
    setActiveAgent, // (name: string) => void
    send,           // (msg: any) => void — raw WS send
    refreshAgents,  // () => void — re-fetch agent list
} = useDrift();
```

---

## Types

All types are exported from the package:

```tsx
import type {
    AgentInfo,      // { name, model, builtin, hasWindow, windowClass, config }
    AgentConfig,    // { model, modelName, thinking, effort, webSearch, maxIterations, tools }
    ChatMessage,    // { role, content, timestamp, parts?, status? }
    MessagePart,    // { type, content?, active?, name?, params?, result?, ms?, status? }
    ToolCallInfo,   // { name, params, result?, ms?, status }
    SessionInfo,    // { id, agentName, createdAt, messageCount, lastMessage?, isRunning? }
    WindowItem,     // { id, [key]: any }
    FileEntry,      // WindowItem + { fullPath, content, lines, disabled, openedAt }
    ServerEvent,    // { event, [key]: any }
    ClientMessage,  // { action, [key]: any }
} from 'drift-react';
```

---

## WebSocket Protocol

### Client → Server

| Action | Payload | Description |
|---|---|---|
| `chat:send` | `{ agent, message, sessionId? }` | Send a message |
| `chat:abort` | `{ agent, sessionId? }` | Abort current run |
| `chat:clear` | `{ agent, sessionId? }` | Clear conversation |
| `chat:history` | `{ agent, sessionId? }` | Request full history |
| `chat:settings` | `{ agent, model?, thinking?, effort? }` | Update settings |
| `sessions:list` | `{}` | List all sessions |
| `sessions:create` | `{ agent? }` | Create a new session |
| `sessions:delete` | `{ sessionId }` | Delete a session |
| `window:open` | `{ path }` | Open file in window |
| `window:close` | `{ path }` | Close file |
| `window:setState` | `{ patch }` | Update window state |
| `window:item:update` | `{ id, patch }` | Update a window item |
| `window:item:remove` | `{ id }` | Remove a window item |
| `agents:list` | `{}` | List available agents |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `chat:started` | `{ agent, sessionId }` | New assistant turn started |
| `chat:text` | `{ agent, sessionId, delta, full }` | Streamed text chunk |
| `chat:thinking` | `{ agent, sessionId, thinking }` | Thinking content |
| `chat:tool` | `{ agent, sessionId, name, params }` | Tool call started |
| `chat:tool:result` | `{ agent, sessionId, name, result, ms }` | Tool call completed |
| `chat:done` | `{ agent, sessionId, result: { text, cost } }` | Turn completed |
| `chat:error` | `{ agent, sessionId, error }` | Error occurred |
| `sessions:list` | `{ sessions }` | All sessions (sent on connect) |
| `sessions:created` | `{ session }` | New session created |
| `sessions:updated` | `{ session }` | Session metadata updated |
| `sessions:deleted` | `{ sessionId }` | Session deleted |
| `window:changed` | `{ items, state }` | Window state updated |
| `agents:list` | `{ agents }` | Agent list response |

---

## Project Structure

```
drift-react/
├── src/
│   ├── index.ts         # Public API barrel exports\n│   ├── provider.tsx     # DriftProvider + DriftContext
│   ├── use-chat.ts      # useChat() — parts-based chat hook with sessions
│   ├── use-sessions.ts  # useSessions() — session lifecycle management
│   ├── use-window.ts    # useWindow() — reactive window hook
│   ├── use-drift.ts     # useDrift() — connection + agents
│   └── types.ts         # All shared types
└── package.json
```

## Examples

See [`examples/with-react-tasks/`](../examples/with-react-tasks/) for a full task board demo with multi-session sidebar.
