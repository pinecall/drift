# TaskBoard — AI Agent Trello

> **Complete reference** for the TaskBoard Kanban system: per-card windows, board tools, ManagerAgent, window inheritance, and multi-agent coordination.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Card Model](#card-model)
- [Per-Card Window](#per-card-window)
- [Window Inheritance](#window-inheritance)
- [Board Tools (6)](#board-tools-6)
  - [board_view](#board_view)
  - [board_read_card](#board_read_card)
  - [board_create_card](#board_create_card)
  - [board_move_card](#board_move_card)
  - [board_add_comment](#board_add_comment)
  - [board_update_card](#board_update_card)
- [ManagerAgent](#manageragent)
- [Dispatch Flow](#dispatch-flow)
  - [Auto-Dispatch](#auto-dispatch)
  - [Window Swap](#window-swap)
  - [Smart Auto-Advance](#smart-auto-advance)
- [Dependencies](#dependencies)
- [Human Review Gates](#human-review-gates)
- [Agent System Prompt](#agent-system-prompt)
- [WebSocket Protocol](#websocket-protocol)
- [Extending](#extending)
- [API Reference](#api-reference)

---

## Overview

The TaskBoard is a **Kanban-style project management system** where AI agents operate like a remote dev team on Trello. Agents read cards, move them through columns, leave comments, create sub-tasks, and inherit files from completed dependencies — all through board tools.

```
┌──────────────────────────────────────────────────────────┐
│                      TaskBoard                           │
│  ┌──────┐ ┌───────────┐ ┌──────────┐ ┌────┐ ┌──────┐   │
│  │ TODO │ │IN_PROGRESS│ │IN_REVIEW │ │ QA │ │ DONE │   │
│  │      │ │           │ │          │ │    │ │      │   │
│  │[C-1] │ │[C-3]      │ │[C-5]     │ │    │ │[C-2] │   │
│  │[C-4] │ │  ↳window  │ │  ↳window │ │    │ │      │   │
│  │      │ │  ↳files    │ │          │ │    │ │      │   │
│  └──────┘ └───────────┘ └──────────┘ └────┘ └──────┘   │
└──────────────────────────────────────────────────────────┘
        ↕ board tools          ↕ events
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ ManagerAgent  │    │  BackendDev   │    │    UIDev      │
│ board tools   │    │ edit+fs+board │    │ edit+fs+board │
│ creates cards │    │ codes backend │    │ codes UI      │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Quick Start

```typescript
import { TaskBoard, ManagerAgent, DeveloperLiteAgent, DriftServer } from '@drift/core';

const board = new TaskBoard();
// default columns: todo → in_progress → in_review → qa → done

// Agents
const manager = new ManagerAgent();
const backend = new DeveloperLiteAgent();

// Server wires everything: dispatch, board tools, window swap
const server = new DriftServer({
    include: ['manager'],
    taskboard: board,
    agents: [
        { name: 'backend', agent: backend },
    ],
});

await server.start();

// Manager plans the project via board tools:
//   board_create_card → cards assigned to 'backend'
//   backend auto-dispatched → creates files → card done
```

---

## Card Model

```typescript
interface Card {
    id: string;                     // auto-generated (card-{n}-{timestamp})
    title: string;
    description?: string;
    column: string;                 // current column
    assignee?: string;              // agent name
    dependsOn?: string[];           // card IDs that must be DONE first
    requiresHumanReview?: boolean;  // pause at in_review for human approval
    context?: string;               // accumulated context/comments
    priority?: number;              // 1 (Critical) - 5 (Lowest), default: 3
    labels?: string[];
    createdAt: number;
    updatedAt: number;
    result?: string;                // agent's final output
    window?: CodebaseWindow;        // per-card isolated file workspace
}
```

---

## Per-Card Window

Each card gets its own `CodebaseWindow` — an isolated file workspace. When an agent is dispatched for a card, the server:

1. Creates a new `CodebaseWindow` for the card (using the agent's `cwd`)
2. Swaps the agent's window to the card's window during execution
3. Restores the agent's original window after the card finishes

This means each card has its own set of open files, completely isolated from other cards.

```
Card A (backend):        Card B (backend):
  window:                  window:
    models/user.ts           routes/api.ts
    utils/db.ts              middleware/auth.ts
```

---

## Window Inheritance

When Card B `dependsOn: [Card A]` and Card A finishes, **Card B's window automatically inherits all files from Card A's window**.

```typescript
// Card A creates models/user.ts → card A done
// Card B depends on Card A → unblocks → window gets models/user.ts
// Backend agent working on Card B sees models/user.ts immediately
```

```
Card A done ──┐
  window:     │  inherits files
    user.ts   ├──────────────────→ Card B starts
    db.ts     │                      window:
              │                        user.ts (from A)
Card C done ──┘                        db.ts   (from A)
  window:                              app.ts  (from C)
    app.ts
```

This happens in `_unblockDependents()` → `_inheritWindows()`. Files are copied via `window.open(fullPath)`, so the agent sees the latest version on disk.

---

## Board Tools (6)

Category `board` — register with `builtinTools: ['board']`. Available when `agent.taskboard` is set.

### board_view

See the full board state — all columns, cards, status, blocked indicators.

```
Agent calls: board_view()
Response: "3 card(s) on the board.
<taskboard count="3">
  <column name="todo" count="1">
    <card id="card-1" priority="1" assignee="backend">Implement auth</card>
  </column>
  <column name="in_progress" count="1">
    <card id="card-2" priority="2" assignee="ui">Create landing page</card>
  </column>
  <column name="done" count="1">...</column>
</taskboard>"
```

### board_read_card

Read full details of a specific card: description, context, result, window files.

| Param | Type | Description |
|-------|------|-------------|
| `cardId` | string | Card ID |

### board_create_card

Create a new card. Cards with an assignee and no blockers are auto-dispatched.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Card title |
| `description` | string | | Detailed task description |
| `assignee` | string | | Agent name (e.g. `"backend"`) |
| `dependsOn` | string | | Comma-separated card IDs |
| `priority` | number | | 1-5 (1=Critical, 3=Medium) |
| `labels` | string | | Comma-separated labels |
| `requiresHumanReview` | boolean | | Pause at in_review |

### board_move_card

Move a card to a different column. Moving to `done` auto-unblocks dependents.

| Param | Type | Description |
|-------|------|-------------|
| `cardId` | string | Card ID |
| `column` | string | `todo \| in_progress \| in_review \| qa \| done` |

### board_add_comment

Append context/comment to a card. Comments accumulate with separators and are visible to agents that work on this card or dependent cards.

| Param | Type | Description |
|-------|------|-------------|
| `cardId` | string | Card ID |
| `comment` | string | Comment text |

### board_update_card

Update card fields without moving it.

| Param | Type | Description |
|-------|------|-------------|
| `cardId` | string | Card ID |
| `title` | string | New title |
| `description` | string | New description |
| `assignee` | string | New assignee |
| `priority` | number | New priority |

---

## ManagerAgent

Built-in planner agent. Only has board tools — no filesystem or edit access.

```typescript
import { ManagerAgent } from '@drift/core';

// Use directly
const manager = new ManagerAgent();

// Or extend for custom planning
class SprintManager extends ManagerAgent {
    prompt = 'You plan agile sprints with 2-week cycles...';
    effort = 'high' as const;
}
```

**Default config:** `model = 'sonnet'`, `thinking = true`, `effort = 'medium'`, `maxIterations = 10`, `builtinTools = ['board']`

**Prompt instructs the agent to:**
- Analyze requirements before creating cards
- Break work into small, focused cards
- Set dependencies correctly
- Assign to specialized agents
- Use labels and priorities for organization

---

## Dispatch Flow

### Auto-Dispatch

When a card has an assignee and is not blocked, `card:assigned` fires and the server auto-dispatches:

```
addCard({ assignee: 'backend' })
       │
       ↓
  card:assigned ──→ ws.ts handler
       │
       ↓
  1. Create per-card CodebaseWindow
  2. Inherit files from done dependencies
  3. Swap agent window → card window
  4. moveCard(id, 'in_progress')
  5. dispatch(agentName, buildDispatchMessage(card))
  6. on finish: smart auto-advance
  7. Restore agent's original window
```

### Window Swap

During dispatch, the agent's `window` is temporarily replaced with the card's window:

```typescript
// Inside ws.ts card:assigned handler:
const originalWindow = agentObj.window;   // save
agentObj.window = card.window;            // swap to card's window
// ... agent runs, sees card's files in its <window> ...
agentObj.window = originalWindow;         // restore
```

### Smart Auto-Advance

After the agent finishes, `ws.ts` checks if the card is still in `in_progress`. If the agent already moved the card manually (e.g. to `in_review` via `board_move_card`), the auto-advance is skipped:

```typescript
const current = taskboard.get(card.id);
if (current?.column === 'in_progress' && result?.text) {
    taskboard.setResult(card.id, result.text);  // auto-advance
}
// If agent moved it to 'in_review' or 'done' via board tools, we respect that.
```

---

## Dependencies

```typescript
const a = board.addCard({ title: 'Models', assignee: 'backend' });        // runs immediately
const b = board.addCard({ title: 'API', assignee: 'backend', dependsOn: [a.id] });  // blocked
const c = board.addCard({ title: 'UI', assignee: 'ui' });                 // runs in parallel with A
const d = board.addCard({ title: 'Integration', dependsOn: [b.id, c.id] }); // needs both
```

```
t=0   A, C dispatched in parallel
t=15s A done → B unblocks (inherits A's files) → dispatched
t=18s C done
t=30s B done → D unblocks (inherits B+C files) → dispatched
```

Dependency results are included in the dispatch message via `<dependency_results>` XML.

---

## Human Review Gates

```typescript
board.addCard({
    title: 'Security audit',
    assignee: 'backend',
    requiresHumanReview: true,
});

// Agent finishes → card pauses at in_review (not done)
// Human reviews via UI or WebSocket:
board.approveCard(cardId);                  // → moves to qa
board.rejectCard(cardId, 'Missing tests');  // → moves to todo + reason in context
```

On rejection, the reason is appended to the card's context. When re-dispatched, the agent sees the rejection reason and can adjust its work.

---

## Agent System Prompt

When an agent has `taskboard` set, the board state is automatically injected into its system prompt as **Block 3** (between Workspace and Window):

```
Block 1: Agent prompt
Block 2: Workspace state
Block 3: TaskBoard state  ← <taskboard> XML with all columns + cards
Block 4: Window content
```

This means every agent with a taskboard can see the full board state without calling `board_view`.

---

## WebSocket Protocol

**Actions (Client → Server):**

| Action | Payload | Description |
|--------|---------|-------------|
| `board:addCard` | `{ card: CardInput }` | Add new card |
| `board:moveCard` | `{ id, column }` | Move card |
| `board:assignCard` | `{ id, agent }` | Assign to agent |
| `board:approveCard` | `{ id }` | Human approval |
| `board:rejectCard` | `{ id, reason? }` | Human rejection |
| `board:list` | — | Get all cards by column |

**Events (Server → Client):**

| Event | Payload | When |
|-------|---------|------|
| `board:changed` | Window change event | Any board mutation |
| `board:moved` | `{ card, from, to }` | Card moved |
| `board:unblocked` | `{ card }` | Dependencies satisfied |
| `board:approved` | `{ card }` | Human approved |
| `board:rejected` | `{ card, reason }` | Human rejected |

---

## Extending

### Custom Manager

```typescript
class SprintManager extends ManagerAgent {
    prompt = 'You plan sprints with priority-based scheduling...';
    model = 'opus';
    effort = 'high' as const;
}
```

### Agent with Board Tools

Any agent can use board tools by including `'board'` in `builtinTools`:

```typescript
class ReviewerAgent extends Agent {
    model = 'haiku';
    prompt = 'You review code and approve/reject cards...';
    builtinTools = ['board'];         // board tools
    maxIterations = 5;
}
```

### Developer with Board Awareness

```typescript
class SmartDev extends DeveloperLiteAgent {
    builtinTools = ['edit', 'filesystem', 'board'];  // code + board tools
}
```

---

## API Reference

### TaskBoard Methods

| Method | Description |
|--------|-------------|
| `addCard(input)` | Create card in TODO, auto-dispatch if assigned |
| `moveCard(id, column)` | Move to column, unblock dependents if DONE |
| `assignCard(id, agent)` | Assign + emit `card:assigned` |
| `unassignCard(id)` | Remove assignee |
| `appendContext(id, text)` | Accumulate context text |
| `setResult(id, result)` | Set output + auto-advance |
| `approveCard(id)` | Move from IN_REVIEW → next column |
| `rejectCard(id, reason?)` | Move back to TODO with reason |
| `byColumn(col)` | Query cards by column |
| `byAssignee(agent)` | Query cards by agent |
| `isBlocked(id)` | Check if deps are met |
| `getReady()` | Get TODO cards with all deps satisfied |
| `blocked()` / `unblocked()` | Query by blocked status |
| `buildDispatchMessage(card)` | Build dispatch message with dep results |
| `render()` | Render Kanban XML for system prompt |

### Files

| File | Description |
|------|-------------|
| `coordination/taskboard.ts` | TaskBoard class + Card types |
| `tools/board/board-*.ts` | 6 board tools |
| `agents/manager.ts` | ManagerAgent built-in |
| `server/ws.ts` | Dispatch wiring, window swap |
