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
import { loadConfig, loadAgents, loadTriggers, loadPipelines, type DriftConfig, type LoadedAgent } from './config.ts';
import { createWSHandler } from './ws.ts';
import { detectViteConfig, spawnViteDev } from './vite-dev.ts';
import type { Agent } from '../core/agent.ts';
import type { Window } from '../core/window.ts';
import { Trigger } from '../core/trigger.ts';
import type { Workspace } from '../core/workspace.ts';
import type { ChildProcess } from 'node:child_process';
import type { Storage } from '../core/storage.ts';
import { SQLiteStorage } from '../core/sqlite-storage.ts';
import type { DriftAuth } from '../core/auth.ts';

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

export interface DriftServerOptions extends Partial<DriftConfig> {
    storage?: Storage | boolean;
    auth?: DriftAuth;
    workspace?: Workspace<any>;
    triggersDir?: string;
    pipelinesDir?: string;
}

export class DriftServer {
    readonly config: DriftConfig;
    readonly storage: Storage | null;
    readonly auth: DriftAuth | undefined;
    private _httpServer: http.Server | null = null;
    private _ws: ReturnType<typeof createWSHandler> | null = null;
    private _agents: LoadedAgent[] = [];
    private _windows = new Map<string, Window<any, any>>();
    private _workspace: Workspace<any> | null = null;
    private _uiDir: string | null = null;
    private _viteProcess: ChildProcess | null = null;

    constructor(configOrDir?: DriftServerOptions | string) {
        if (typeof configOrDir === 'string') {
            this.config = loadConfig(configOrDir);
            this.storage = new SQLiteStorage(path.resolve(configOrDir, '.drift/drift.db'));
            this.auth = undefined;
        } else {
            this.config = { ...loadConfig(), ...configOrDir };
            this.auth = configOrDir?.auth;
            this._workspace = configOrDir?.workspace || null;
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

        // 2. Collect shared windows — agents with same window class share ONE instance
        for (const { agent } of this._agents) {
            if (agent.window) {
                const className = agent.window.constructor.name;
                if (!this._windows.has(className)) {
                    this._windows.set(className, agent.window);
                } else {
                    // Replace this agent's window with the shared instance
                    agent.window = this._windows.get(className)!;
                }
            }
        }

        // 3. Inject workspace into all agents + restore from storage
        if (this._workspace) {
            for (const { agent } of this._agents) {
                agent.workspace = this._workspace;
            }
            if (this.storage) {
                const saved = this.storage.loadWorkspace(this._workspace.name);
                if (saved) this._workspace.loadJSON(saved);
            }
        }

        // 4. Resolve UI directory
        if (this.config.ui) {
            const uiPath = path.resolve(this.config.cwd, this.config.ui);
            if (fs.existsSync(uiPath)) {
                this._uiDir = uiPath;
            } else {
                console.warn(`  ⚠ UI directory not found: ${uiPath}`);
            }
        }

        // 5. Create HTTP server
        this._httpServer = http.createServer((req, res) => {
            this._handleHttp(req, res);
        });

        // 6. WebSocket handler
        this._ws = createWSHandler(this._httpServer, this._agents, this._windows, this.storage || undefined, this.auth, this._workspace || undefined);

        // 6b. Load and wire triggers
        const triggers = await loadTriggers(this.config);
        if (triggers.length > 0) {
            for (const trigger of triggers) {
                // Inject workspace + window references
                trigger.workspace = this._workspace || undefined;
                // Give trigger access to the first shared window (most common case)
                if (this._windows.size > 0) {
                    trigger.window = this._windows.values().next().value;
                }
                // Inject dispatch function
                trigger._dispatchFn = this._ws.dispatch;
                // Add to manager
                this._ws.triggerManager.add(trigger);
            }
        }

        // 6b.2 Auto-generate triggers from agent.subscribes (Blackboard pattern)
        let subscribeCount = 0;
        for (const loaded of this._agents) {
            const agent = loaded.agent;
            if (!agent.subscribes || agent.subscribes.length === 0) continue;

            for (const sub of agent.subscribes) {
                const sliceName = typeof sub === 'string' ? sub : sub.slice;
                const cooldown = typeof sub === 'string' ? agent.subscribeCooldown : (sub.cooldown ?? agent.subscribeCooldown);
                const agentName = loaded.name;

                // Create an inline Trigger that watches this workspace slice
                const trigger = new Trigger();
                trigger.name = `__subscribe__:${agentName}:${sliceName}`;
                trigger.watch = 'workspace';
                trigger.cooldown = cooldown;
                trigger.workspace = this._workspace || undefined;
                if (this._windows.size > 0) {
                    trigger.window = this._windows.values().next().value;
                }
                trigger._dispatchFn = this._ws.dispatch;

                // Condition: slice matches
                trigger.condition = (event: any) => {
                    if (event.action === 'setSlice') return event.slice === sliceName;
                    if (event.action === 'setState' && event.patch) return sliceName in event.patch;
                    return false;
                };

                // Run: build message and dispatch
                trigger.run = async (event: any) => {
                    const value = event.state?.[sliceName];
                    let message: string | null;

                    // Try agent's custom handler first
                    if (agent.onSliceChange) {
                        message = agent.onSliceChange(sliceName, value, event);
                    } else {
                        // Default message with slice preview
                        const preview = typeof value === 'string' ? value.slice(0, 500)
                            : JSON.stringify(value, null, 2)?.slice(0, 500) || '';
                        message = `Workspace slice "${sliceName}" was updated:\n\n${preview}`;
                    }

                    if (message !== null) {
                        await trigger._dispatchFn!(agentName, message, {
                            source: `subscribe:${agentName}:${sliceName}`,
                            silent: false,
                        });
                    }
                };

                this._ws.triggerManager.add(trigger);
                subscribeCount++;
            }
        }

        // 6c. Load and wire pipelines
        const pipelines = await loadPipelines(this.config);
        if (pipelines.length > 0) {
            for (const pipeline of pipelines) {
                pipeline.workspace = this._workspace || undefined;
                if (this._windows.size > 0) {
                    pipeline.window = this._windows.values().next().value;
                }
                pipeline._dispatchFn = this._ws.dispatch;
                this._ws.pipelineManager.add(pipeline);
            }
        }

        // 6d. Pre-load files from config
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
                if (this._workspace) {
                    console.log(`  Workspace: ${this._workspace.name}`);
                }
                if (triggers.length > 0) {
                    console.log(`  Triggers (${triggers.length}):`);
                    for (const t of triggers) console.log(`    • ${t.name} (watch: ${t.watch}, cooldown: ${t.cooldown}ms)`);
                }
                if (pipelines.length > 0) {
                    console.log(`  Pipelines (${pipelines.length}):`);
                    for (const p of pipelines) {
                        const stepNames = p.steps.map((s: any) => typeof s === 'string' ? s : s.agent).join(' → ');
                        console.log(`    • ${p.name} (${stepNames})`);
                    }
                }
                if (subscribeCount > 0) {
                    console.log(`  Subscriptions (${subscribeCount}):`);
                    for (const loaded of this._agents) {
                        const agent = loaded.agent;
                        if (agent.subscribes && agent.subscribes.length > 0) {
                            const slices = agent.subscribes.map((s: any) => typeof s === 'string' ? s : s.slice).join(', ');
                            console.log(`    • ${loaded.name} → [${slices}]`);
                        }
                    }
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

    /**
     * Attach DriftServer to an existing HTTP server.
     * Sets up WebSocket handler + agent loading without creating its own server.
     * Use this to embed Drift in Next.js, Express, Fastify, etc.
     * 
     *   const drift = new DriftServer({ auth: myAuth });
     *   await drift.attach(existingHttpServer);
     */
    async attach(httpServer: http.Server): Promise<void> {
        // 1. Load agents
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

        // 3. Pre-load files from config
        if (this.config.preload.length > 0) {
            this.openFiles(this.config.preload);
        }

        // 4. WebSocket handler on the provided server
        this._httpServer = httpServer;
        this._ws = createWSHandler(httpServer, this._agents, this._windows, this.storage || undefined, this.auth);

        console.log(`\n  ⚡ Drift attached to existing server`);
        console.log(`  Agents (${this._agents.length}): ${this._agents.map(a => a.name).join(', ')}`);
        if (this._windows.size > 0) {
            console.log(`  Windows (${this._windows.size}): ${[...this._windows.keys()].join(', ')}`);
        }
        console.log('');
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
