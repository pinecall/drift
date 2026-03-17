/**
 * Task Board Demo — Drift Server
 * 
 * Demonstrates bidirectional window reactivity:
 *   - Agent tools modify the board → UI updates in real-time
 *   - User interacts with the board → Agent sees the changes
 *   - Tasks persist to SQLite across server restarts
 * 
 * Run:
 *   cd examples/task-board && npm install && npm run build
 *   cd ../.. && npx tsx examples/task-board/server/index.ts
 *   → http://localhost:3200
 */

import { DriftServer } from '../../../packages/drift/src/server/index.ts';

const server = new DriftServer({
    port: 3200,
    agentsDir: './agents',
    windowsDir: './windows',
    ui: '../dist',
    cwd: import.meta.dirname!,
    storage: true,  // SQLite persistence — tasks survive server restarts
});
await server.start();
