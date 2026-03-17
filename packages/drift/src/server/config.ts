/**
 * Drift Server — Config loader + agent/window auto-discovery
 * 
 * Reads drift.config.json, loads built-in agents via `include`,
 * discovers custom agents from `agents/` and windows from `windows/`.
 * Shared windows: agents with same window class share one instance.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Agent } from '../core/agent.ts';
import { Window } from '../core/window.ts';
import { DeveloperAgent } from '../agents/developer.ts';
import { DeveloperLiteAgent } from '../agents/developer-lite.ts';
import { ResearcherAgent } from '../agents/researcher.ts';
import { PlaywrightAgent } from '../agents/playwright.ts';
import { CodebaseWindow } from '../windows/codebase-window.tsx';

// ── Types ───────────────────────────────────────────

export interface DriftConfig {
    port: number;
    include: string[];
    agentsDir: string;
    windowsDir: string;
    /** Path to UI build directory (served as static files). null = no UI. */
    ui: string | null;
    /** Files to pre-load into the window on startup (relative to cwd) */
    preload: string[];
    cwd: string;
}

// ── Built-in Registry ───────────────────────────────

const BUILTIN_AGENTS: Record<string, new () => Agent> = {
    'developer': DeveloperAgent,
    'developer-lite': DeveloperLiteAgent,
    'researcher': ResearcherAgent,
    'playwright': PlaywrightAgent,
};

// ── Config Loading ──────────────────────────────────

const DEFAULTS: DriftConfig = {
    port: 3100,
    include: [],
    agentsDir: './agents',
    windowsDir: './windows',
    ui: null,
    preload: [],
    cwd: process.cwd(),
};

export function loadConfig(projectDir: string = process.cwd()): DriftConfig {
    const configPath = path.join(projectDir, 'drift.config.json');
    let fileConfig: Partial<DriftConfig> = {};

    if (fs.existsSync(configPath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err: any) {
            console.warn(`⚠ Failed to parse drift.config.json: ${err.message}`);
        }
    }

    return {
        ...DEFAULTS,
        ...fileConfig,
        cwd: projectDir,
    };
}

// ── Agent Discovery ─────────────────────────────────

export interface LoadedAgent {
    name: string;
    agent: Agent;
    builtin: boolean;
}

/**
 * Load all agents:
 * 1. Built-in agents from config.include
 * 2. Custom agents from config.agentsDir
 * 
 * Shared window: agents with the same window class share one instance.
 */
export async function loadAgents(config: DriftConfig): Promise<LoadedAgent[]> {
    const loaded: LoadedAgent[] = [];
    const windowPool = new Map<string, Window<any, any>>();  // className → shared instance

    // 1. Built-in agents from include
    for (const name of config.include) {
        const AgentClass = BUILTIN_AGENTS[name];
        if (!AgentClass) {
            console.warn(`⚠ Unknown built-in agent: "${name}". Available: ${Object.keys(BUILTIN_AGENTS).join(', ')}`);
            continue;
        }

        const agent = new AgentClass();
        _shareWindow(agent, windowPool, config.cwd);
        loaded.push({ name, agent, builtin: true });
    }

    // 2. Custom agents from agentsDir
    const agentsDir = path.resolve(config.cwd, config.agentsDir);
    if (fs.existsSync(agentsDir)) {
        const entries = fs.readdirSync(agentsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
        for (const file of entries) {
            const name = path.basename(file, path.extname(file));
            if (loaded.some(a => a.name === name)) continue; // skip if already loaded as built-in

            try {
                const fullPath = path.resolve(agentsDir, file);
                const mod = await import(fullPath);
                const ExportedClass = mod.default || Object.values(mod).find((v: any) => typeof v === 'function' && v.prototype instanceof Agent);

                if (!ExportedClass) {
                    console.warn(`⚠ ${file}: no Agent subclass found`);
                    continue;
                }

                const agent = new (ExportedClass as any)();
                _shareWindow(agent, windowPool, config.cwd);
                loaded.push({ name, agent, builtin: false });
            } catch (err: any) {
                console.warn(`⚠ Failed to load agent ${file}: ${err.message}`);
            }
        }
    }

    // 3. Custom windows from windowsDir (attach to agents without a window)
    const windowsDir = path.resolve(config.cwd, config.windowsDir);
    if (fs.existsSync(windowsDir)) {
        const entries = fs.readdirSync(windowsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
        for (const file of entries) {
            try {
                const fullPath = path.resolve(windowsDir, file);
                const mod = await import(fullPath);
                const WindowClass = mod.default || Object.values(mod).find((v: any) => typeof v === 'function' && v.prototype instanceof Window);

                if (WindowClass) {
                    const className = (WindowClass as any).name;
                    if (!windowPool.has(className)) {
                        windowPool.set(className, new (WindowClass as any)());
                    }
                }
            } catch (err: any) {
                console.warn(`⚠ Failed to load window ${file}: ${err.message}`);
            }
        }
    }

    return loaded;
}

/**
 * Share window instances across agents.
 * Agents with the same window class get the same instance.
 * If agent has no window, leave it as-is.
 */
function _shareWindow(agent: Agent, pool: Map<string, Window<any, any>>, cwd: string): void {
    if (!agent.window) return;

    const className = agent.window.constructor.name;

    if (pool.has(className)) {
        // Reuse existing instance
        agent.window = pool.get(className)!;
    } else {
        // Set cwd if it's a CodebaseWindow
        if ('cwd' in agent.window && typeof (agent.window as any).cwd === 'string') {
            (agent.window as any).cwd = cwd;
        }
        pool.set(className, agent.window);
    }
}

/** List available built-in agent names */
export function listBuiltinAgents(): string[] {
    return Object.keys(BUILTIN_AGENTS);
}
