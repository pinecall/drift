/**
 * Task Board Demo — Drift Server
 * 
 * Demonstrates bidirectional window reactivity:
 *   - Agent tools modify the board → UI updates in real-time
 *   - User interacts with the board → Agent sees the changes
 * 
 * Run:
 *   cd examples/with-react-tasks && npm install && npm run build
 *   cd ../.. && npx tsx examples/with-react-tasks/server.ts
 *   → http://localhost:3200
 */

import { DriftServer } from '../../packages/drift/src/server/index.ts';

const server = new DriftServer(import.meta.dirname!);
await server.start();
