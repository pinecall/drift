/**
 * Task Board Demo — Drift Server
 * 
 * Demonstrates bidirectional window reactivity:
 *   - Agent tools modify the board → UI updates in real-time
 *   - User interacts with the board → Agent sees the changes
 *   - Tasks persist to SQLite across server restarts
 *   - Workspace tracks shared board stats across agents
 * 
 * Run:
 *   cd examples/task-board && npm install && npm run build
 *   cd ../.. && npx tsx examples/task-board/server/index.ts
 *   → http://localhost:3200
 */

import { DriftServer } from 'drift';
import { Workspace } from 'drift';

// ── Shared Workspace: Board Stats ──
// Tracks metrics across all agents, visible in the UI dashboard

const workspace = new Workspace('task-board', {
    stats: {
        totalCreated: 0,
        totalCompleted: 0,
        totalDeleted: 0,
        agentInteractions: 0,
    },
    lastActivity: [] as string[],
});

const server = new DriftServer({
    port: 3200,
    agentsDir: './agents',
    windowsDir: './windows',
    ui: '../dist',
    cwd: import.meta.dirname!,
    storage: true,
    workspace,
});
await server.start();
