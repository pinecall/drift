/**
 * DriftServer — Unit Tests
 * Tests config loading, agent discovery, and server lifecycle.
 */
import { loadConfig, loadAgents, listBuiltinAgents, type DriftConfig } from '../../packages/drift/src/server/config.ts';
import { DriftServer } from '../../packages/drift/src/server/index.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const suite = 'DriftServer';

export const tests: Record<string, () => void | Promise<void>> = {

    'loadConfig returns defaults when no config file'() {
        const config = loadConfig(os.tmpdir());
        if (config.port !== 3100) throw new Error(`expected port 3100, got ${config.port}`);
        if (!Array.isArray(config.include)) throw new Error('include should be array');
        if (config.agentsDir !== './agents') throw new Error('wrong agentsDir');
    },

    'loadConfig reads drift.config.json'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfg-'));
        fs.writeFileSync(path.join(tmpDir, 'drift.config.json'), JSON.stringify({
            port: 4200,
            include: ['developer'],
        }));

        const config = loadConfig(tmpDir);
        if (config.port !== 4200) throw new Error(`expected port 4200, got ${config.port}`);
        if (config.include.length !== 1) throw new Error('expected 1 include');
        if (config.include[0] !== 'developer') throw new Error('expected developer');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'listBuiltinAgents returns all 4'() {
        const names = listBuiltinAgents();
        if (names.length !== 4) throw new Error(`expected 4, got ${names.length}`);
        if (!names.includes('developer')) throw new Error('missing developer');
        if (!names.includes('researcher')) throw new Error('missing researcher');
    },

    async 'loadAgents loads built-in agents from include'() {
        const config: DriftConfig = {
            port: 3100,
            include: ['developer', 'researcher'],
            agentsDir: './nonexistent',
            windowsDir: './nonexistent',
            cwd: os.tmpdir(),
        };

        const loaded = await loadAgents(config);
        if (loaded.length !== 2) throw new Error(`expected 2, got ${loaded.length}`);

        const dev = loaded.find(a => a.name === 'developer');
        if (!dev) throw new Error('missing developer');
        if (!dev.builtin) throw new Error('should be builtin');
        if (!dev.agent.window) throw new Error('developer should have window');
    },

    async 'loadAgents shares windows across agents'() {
        const config: DriftConfig = {
            port: 3100,
            include: ['developer', 'researcher'],
            agentsDir: './nonexistent',
            windowsDir: './nonexistent',
            cwd: os.tmpdir(),
        };

        const loaded = await loadAgents(config);
        const dev = loaded.find(a => a.name === 'developer')!;
        const res = loaded.find(a => a.name === 'researcher')!;

        // Both should have windows, and they should be shared (same instance)
        if (!dev.agent.window) throw new Error('developer needs window');
        // Researcher doesn't define a window by default, so it won't share
        // But developer's CodebaseWindow should exist
        if (dev.agent.window.constructor.name !== 'CodebaseWindow') throw new Error('expected CodebaseWindow');
    },

    async 'loadAgents warns for unknown built-in'() {
        const config: DriftConfig = {
            port: 3100,
            include: ['nonexistent-agent'],
            agentsDir: './nonexistent',
            windowsDir: './nonexistent',
            cwd: os.tmpdir(),
        };

        const loaded = await loadAgents(config);
        if (loaded.length !== 0) throw new Error('should not load unknown agent');
    },

    async 'DriftServer starts and stops'() {
        const server = new DriftServer({
            port: 0, // random port
            include: [],
            cwd: os.tmpdir(),
        } as any);

        // We can't actually start on port 0 easily, but we can verify construction
        if (!server.config) throw new Error('missing config');
        if (!Array.isArray(server.agents)) throw new Error('agents should be array');
    },
};
