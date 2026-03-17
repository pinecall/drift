#!/usr/bin/env node
/**
 * Drift CLI
 * 
 *   drift server              — start WebSocket server (production)
 *   drift dev                 — start WS server + Vite dev server (HMR)
 *   drift server --port 4000  — custom port
 */

import { DriftServer } from '../packages/drift/src/server/index.ts';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help' || command === '--help') {
    console.log(`
  drift — AI agent framework CLI

  Commands:
    server [--port N]    Start WebSocket server (production, serves built UI)
    dev    [--port N]    Start WS server + Vite dev server (HMR, hot reload)

  Config:
    Place drift.config.json in your project root:
    {
        "port": 3100,
        "include": ["developer", "researcher"]
    }

  Agents are auto-discovered from ./agents/ folder.
  Built-in agents: developer, developer-lite, researcher, playwright
`);
    process.exit(0);
}

// ── Parse common flags ──
const portIdx = args.indexOf('--port');
const portOverride = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : undefined;
const config: any = {};
if (portOverride && !isNaN(portOverride)) config.port = portOverride;

// ── Graceful shutdown helper ──
function setupShutdown(server: DriftServer) {
    process.on('SIGINT', async () => {
        console.log('\n  Shutting down...');
        await server.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
    });
}

if (command === 'server') {
    const server = new DriftServer(config);
    server.start().catch((err) => {
        console.error(`\n  ✖ Failed to start: ${err.message}\n`);
        process.exit(1);
    });
    setupShutdown(server);

} else if (command === 'dev') {
    const server = new DriftServer(config);
    server.startDev().catch((err) => {
        console.error(`\n  ✖ Failed to start dev mode: ${err.message}\n`);
        process.exit(1);
    });
    setupShutdown(server);

} else {
    console.error(`  Unknown command: ${command}\n  Run "drift --help" for available commands.`);
    process.exit(1);
}
