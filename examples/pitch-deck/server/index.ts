/**
 * Pitch Deck Builder — Drift Server
 * 
 * Multi-agent demo: parallel pitch deck construction.
 * 
 * Flow:
 *   1. User tells planner to create a pitch deck
 *   2. Planner creates slides (phase: 'pending')
 *   3. Triggers auto-dispatch agents in parallel:
 *      pending → researching → writing → polishing → done
 *   4. Each slide progresses independently through all phases
 *   5. UI shows real-time progress via useWindow() + useWorkspace()
 * 
 * Run:
 *   cd drift && node --import tsx examples/pitch-deck/server/index.ts
 *   → http://localhost:3300
 */

import { DriftServer, Workspace } from 'drift';

// ── Workspace: Global deck progress dashboard ──
const workspace = new Workspace('pitch-deck', {
    status: 'idle' as string,          // 'idle' | 'building' | 'done'
    topic: '' as string,
    totalSlides: 0,
    slidesResearched: 0,
    slidesWritten: 0,
    slidesPolished: 0,
    completedSlides: 0,
    activeAgents: [] as string[],
    activity: [] as string[],
    startedAt: 0,
});

const server = new DriftServer({
    port: 3300,
    agentsDir: './agents',
    triggersDir: './triggers',
    windowsDir: './windows',
    ui: '../dist',
    cwd: import.meta.dirname!,
    storage: true,
    workspace,
});

await server.start();
