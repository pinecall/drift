/**
 * Example: Drift Server
 * 
 * Start a WebSocket server with built-in agents.
 * 
 *   npx tsx examples/08-server.ts
 * 
 * Then connect from a React app or any WebSocket client:
 *   wscat -c ws://localhost:3100
 *   > {"action":"agents:list"}
 *   > {"action":"chat:send","agent":"developer","message":"Hello!"}
 *   > {"action":"window:open","path":"src/index.ts"}
 */

import { DriftServer } from '../src/server/index.ts';

const server = new DriftServer({
    port: 3100,
    include: ['developer', 'researcher'],
});

await server.start();

// The server is now running:
//   HTTP:  http://localhost:3100/health
//   WS:    ws://localhost:3100
//
// Available agents: developer (with CodebaseWindow), researcher
// Window is shared — files opened by one agent are visible to all.
