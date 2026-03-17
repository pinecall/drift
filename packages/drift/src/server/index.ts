/**
 * Drift Server — HTTP + WebSocket server for agent UIs
 * 
 * Usage:
 *   import { DriftServer } from 'drift';
 *   const server = new DriftServer();
 *   await server.start();
 * 
 * Or via CLI:
 *   drift server --port 3100
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig, loadAgents, type DriftConfig, type LoadedAgent } from './config.ts';
import { createWSHandler } from './ws.ts';
import { detectViteConfig, spawnViteDev } from './vite-dev.ts';
import type { Agent } from '../core/agent.ts';
import type { Window } from '../core/window.ts';
import type { ChildProcess } from 'node:child_process';
import type { Storage } from '../core/storage.ts';
import { SQLiteStorage } from '../core/sqlite-storage.ts';

// ── MIME types for static serving ───────────────────
const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
};

export class DriftServer {
    readonly config: DriftConfig;
    readonly storage: Storage | null;
    private _httpServer: http.Server | null = null;
    private _ws: ReturnType<typeof createWSHandler> | null = null;
    private _agents: LoadedAgent[] = [];
    private _windows = new Map<string, Window<any, any>>();
    private _uiDir: string | null = null;
    private _viteProcess: ChildProcess | null = null;

    constructor(configOrDir?: Partial<DriftConfig & { storage?: Storage | boolean }> | string) {
        if (typeof configOrDir === 'string') {
            this.config = loadConfig(configOrDir);
            this.storage = new SQLiteStorage(path.resolve(configOrDir, '.drift/drift.db'));
        } else {
            this.config = { ...loadConfig(), ...configOrDir };
            // storage: false → disabled, Storage instance → use it, undefined/true → SQLite default
            if (configOrDir && configOrDir.storage === false) {
                this.storage = null;
            } else if (configOrDir && typeof configOrDir.storage === 'object') {
                this.storage = configOrDir.storage as Storage;
            } else {
                this.storage = new SQLiteStorage(path.resolve(this.config.cwd, '.drift/drift.db'));
            }
        }
    }

    /** Start the server. Returns the port. */
    async start(): Promise<number> {
        // 1. Load agents (auto-discover + built-in includes)
        this._agents = await loadAgents(this.config);

        // 2. Collect shared windows
        for (const { agent } of this._agents) {
            if (agent.window) {
                const className = agent.window.constructor.name;
                if (!this._windows.has(className)) {
                    this._windows.set(className, agent.window);
                }
            }
        }

        // 3. Resolve UI directory
        if (this.config.ui) {
            const uiPath = path.resolve(this.config.cwd, this.config.ui);
            if (fs.existsSync(uiPath)) {
                this._uiDir = uiPath;
            } else {
                console.warn(`  ⚠ UI directory not found: ${uiPath}`);
            }
        }

        // 4. Create HTTP server
        this._httpServer = http.createServer((req, res) => {
            this._handleHttp(req, res);
        });

        // 5. WebSocket handler
        this._ws = createWSHandler(this._httpServer, this._agents, this._windows, this.storage || undefined);

        // 6. Pre-load files from config
        if (this.config.preload.length > 0) {
            this.openFiles(this.config.preload);
        }

        // 7. Listen
        return new Promise<number>((resolve) => {
            this._httpServer!.listen(this.config.port, '0.0.0.0', () => {
                const agentNames = this._agents.map(a => `${a.name}${a.builtin ? ' (built-in)' : ''}`);
                const windowNames = [...this._windows.keys()];

                console.log(`\n  ⚡ Drift Server running on http://localhost:${this.config.port}\n`);
                console.log(`  Agents (${this._agents.length}):`);
                for (const name of agentNames) console.log(`    • ${name}`);
                if (windowNames.length > 0) {
                    console.log(`  Windows (${windowNames.length}, shared):`);
                    for (const name of windowNames) console.log(`    • ${name}`);
                }
                if (this._uiDir) console.log(`  UI:        ${this._uiDir}`);
                if (this.config.preload.length > 0) console.log(`  Preloaded: ${this.config.preload.length} file(s)`);
                console.log(`\n  WebSocket: ws://localhost:${this.config.port}`);
                console.log(`  Health:    http://localhost:${this.config.port}/health\n`);

                resolve(this.config.port);
            });
        });
    }

    /**
     * Start in dev mode: WS server + Vite dev server with HMR.
     * Skips static UI serving — Vite handles it with proxy to WS.
     */
    async startDev(): Promise<{ wsPort: number; viteUrl: string }> {
        // Force disable static UI in dev mode — Vite serves the app
        (this.config as any).ui = null;

        // Start the WS/API server
        const wsPort = await this.start();

        // Detect Vite config
        const viteConfig = detectViteConfig(this.config.cwd);
        if (!viteConfig) {
            console.log('  ℹ No vite.config found — running in API-only mode');
            console.log(`  Open http://localhost:${wsPort}\n`);
            return { wsPort, viteUrl: `http://localhost:${wsPort}` };
        }

        // Spawn Vite dev server
        const vitePort = wsPort + 1;
        console.log(`  🔥 Starting Vite dev server on port ${vitePort}...`);
        console.log(`     Proxying WebSocket → ws://localhost:${wsPort}\n`);

        try {
            const { process: viteProc, url } = await spawnViteDev({
                cwd: this.config.cwd,
                vitePort,
                wsPort,
                configFile: viteConfig,
            });

            this._viteProcess = viteProc;
            console.log(`\n  ✨ Dev mode ready → ${url}\n`);

            return { wsPort, viteUrl: url };
        } catch (err: any) {
            console.error(`  ✖ Failed to start Vite: ${err.message}`);
            console.log(`  Falling back to API-only mode → http://localhost:${wsPort}\n`);
            return { wsPort, viteUrl: `http://localhost:${wsPort}` };
        }
    }

    // ── HTTP Handler ────────────────────────────────

    private _handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url || '/';

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Health check
        if (url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', agents: this._agents.map(a => a.name) }));
            return;
        }

        // API: list agents
        if (url === '/api/agents') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                agents: this._agents.map(a => ({
                    name: a.name,
                    model: a.agent.model,
                    builtin: a.builtin,
                    hasWindow: !!a.agent.window,
                    windowClass: a.agent.window?.constructor.name || null,
                })),
            }));
            return;
        }

        // Static files from UI directory
        if (this._uiDir) {
            const urlPath = url.split('?')[0];
            const filePath = path.join(this._uiDir, urlPath === '/' ? 'index.html' : urlPath);

            // Try exact file
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                this._serveFile(res, filePath);
                return;
            }

            // SPA fallback: non-file routes → index.html
            const ext = path.extname(urlPath);
            if (!ext || ext === '.html') {
                const indexPath = path.join(this._uiDir, 'index.html');
                if (fs.existsSync(indexPath)) {
                    this._serveFile(res, indexPath);
                    return;
                }
            }
        }

        res.writeHead(404);
        res.end('Not found');
    }

    private _serveFile(res: http.ServerResponse, filePath: string): void {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    }

    /** Stop the server and any child processes. */
    async stop(): Promise<void> {
        // Kill Vite child process if running
        if (this._viteProcess) {
            this._viteProcess.kill('SIGTERM');
            this._viteProcess = null;
        }
        this._ws?.close();
        if (this.storage) this.storage.close();
        return new Promise<void>((resolve) => {
            if (this._httpServer) {
                this._httpServer.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    // ── Friendly API ────────────────────────────────

    /** Get a loaded agent by name. */
    getAgent(name: string): Agent | undefined {
        return this._agents.find(a => a.name === name)?.agent;
    }

    /** The shared window (first available). Direct access, no casting needed. */
    get window(): Window<any, any> | null {
        const first = this._windows.values().next();
        return first.done ? null : first.value;
    }

    /**
     * Open files in the shared window. Paths are relative to config.cwd.
     * 
     *   server.openFiles(['src/index.ts', 'package.json']);
     */
    openFiles(paths: string[]): void {
        const win = this.window;
        if (!win || typeof (win as any).open !== 'function') return;
        for (const p of paths) {
            const abs = path.isAbsolute(p) ? p : path.resolve(this.config.cwd, p);
            (win as any).open(abs);
        }
    }

    /** All loaded agents. */
    get agents(): LoadedAgent[] {
        return this._agents;
    }

    /** All shared windows. */
    get windows(): Map<string, Window<any, any>> {
        return this._windows;
    }
}
