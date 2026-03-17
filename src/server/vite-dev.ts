/**
 * Drift — Vite Dev Server Helper
 * 
 * Spawns Vite dev server with WebSocket proxy to the drift WS server.
 * Used by `drift dev` and `DriftServer.startDev()`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ViteDevOptions {
    /** Project directory containing vite.config.ts */
    cwd: string;
    /** Port for Vite dev server */
    vitePort: number;
    /** Port of the drift WS server to proxy to */
    wsPort: number;
    /** Optional path to vite config file */
    configFile?: string;
}

/**
 * Detect if the project has a Vite config.
 */
export function detectViteConfig(cwd: string): string | null {
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']) {
        const full = path.join(cwd, name);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

/**
 * Spawn a Vite dev server as a child process.
 * Returns a promise that resolves with the child process once Vite is ready.
 */
export function spawnViteDev(opts: ViteDevOptions): Promise<{ process: ChildProcess; url: string }> {
    return new Promise((resolve, reject) => {
        const args = ['vite', '--port', String(opts.vitePort), '--host', 'localhost'];

        if (opts.configFile) {
            args.push('--config', opts.configFile);
        }

        const child = spawn('npx', args, {
            cwd: opts.cwd,
            env: {
                ...process.env,
                DRIFT_WS_PORT: String(opts.wsPort),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let resolved = false;
        const expectedUrl = `http://localhost:${opts.vitePort}`;

        // Watch stdout for Vite's "ready" message
        child.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            process.stdout.write(text);

            // Vite prints something like "  ➜  Local: http://localhost:5173/"
            if (!resolved && (text.includes('Local:') || text.includes('localhost'))) {
                resolved = true;
                resolve({ process: child, url: expectedUrl });
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            // Vite often writes to stderr for warnings, still print it
            process.stderr.write(text);
        });

        child.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Failed to spawn Vite: ${err.message}`));
            }
        });

        child.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Vite exited with code ${code} before becoming ready`));
            }
        });

        // Timeout: if Vite doesn't become ready in 30s, resolve anyway
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve({ process: child, url: expectedUrl });
            }
        }, 30_000);
    });
}
