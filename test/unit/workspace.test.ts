/**
 * Workspace — Unit Tests
 * 
 * Tests the shared reactive "workstation": window management,
 * shared state, rendering, and serialization.
 */

import { Workspace, type WorkspaceChangeEvent } from '../../packages/drift/src/state/workspace.ts';
import { Window } from '../../packages/drift/src/state/window.ts';

export const name = 'Workspace';

interface TestState {
    stats: { total: number; active: number };
    config: { theme: string };
}

function createWorkspace(): Workspace<TestState> {
    return new Workspace<TestState>('test', {
        stats: { total: 10, active: 3 },
        config: { theme: 'dark' },
    });
}

export const tests = {

    // ── Identity ──

    'name returns constructor name'(assert: any) {
        const ws = createWorkspace();
        assert.equal(ws.name, 'test');
    },

    // ── State ──

    'state returns full state'(assert: any) {
        const ws = createWorkspace();
        assert.equal(ws.state.stats.total, 10);
        assert.equal(ws.state.config.theme, 'dark');
    },

    'setState shallow merges'(assert: any) {
        const ws = createWorkspace();
        ws.setState({ config: { theme: 'light' } });
        assert.equal(ws.state.config.theme, 'light');
        assert.equal(ws.state.stats.total, 10, 'other keys unchanged');
    },

    'setState emits change event'(assert: any) {
        const ws = createWorkspace();
        const events: WorkspaceChangeEvent[] = [];
        ws.on('change', (e) => events.push(e));

        ws.setState({ config: { theme: 'blue' } });
        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'setState');
        assert.equal(events[0].state.config.theme, 'blue');
    },

    // ── Windows ──

    'addWindow registers a named window'(assert: any) {
        const ws = createWorkspace();
        const win = new Window();
        ws.addWindow('files', win);

        assert.equal(ws.windowNames.length, 1);
        assert.equal(ws.windowNames[0], 'files');
        assert.equal(win.name, 'files');
    },

    'getWindow returns registered window'(assert: any) {
        const ws = createWorkspace();
        const win = new Window();
        ws.addWindow('tasks', win);

        const retrieved = ws.getWindow('tasks');
        assert.ok(retrieved === win, 'should return same instance');
    },

    'getWindow returns undefined for unknown name'(assert: any) {
        const ws = createWorkspace();
        const retrieved = ws.getWindow('nonexistent');
        assert.ok(retrieved === undefined);
    },

    'removeWindow removes registered window'(assert: any) {
        const ws = createWorkspace();
        const win = new Window();
        ws.addWindow('temp', win);
        assert.ok(ws.hasWindow('temp'));

        const removed = ws.removeWindow('temp');
        assert.ok(removed, 'should return true');
        assert.ok(!ws.hasWindow('temp'));
    },

    'removeWindow returns false for unknown name'(assert: any) {
        const ws = createWorkspace();
        const removed = ws.removeWindow('nonexistent');
        assert.ok(!removed, 'should return false');
    },

    'windowNames returns all registered names'(assert: any) {
        const ws = createWorkspace();
        ws.addWindow('a', new Window());
        ws.addWindow('b', new Window());
        ws.addWindow('c', new Window());
        const names = ws.windowNames;
        assert.equal(names.length, 3);
        assert.includes(names.join(','), 'a');
        assert.includes(names.join(','), 'b');
        assert.includes(names.join(','), 'c');
    },

    'addWindow emits change event'(assert: any) {
        const ws = createWorkspace();
        const events: WorkspaceChangeEvent[] = [];
        ws.on('change', (e) => events.push(e));

        ws.addWindow('win', new Window());
        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'windowAdded');
        assert.equal(events[0].windowName, 'win');
    },

    'removeWindow emits change event'(assert: any) {
        const ws = createWorkspace();
        ws.addWindow('win', new Window());
        const events: WorkspaceChangeEvent[] = [];
        ws.on('change', (e) => events.push(e));

        ws.removeWindow('win');
        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'windowRemoved');
        assert.equal(events[0].windowName, 'win');
    },

    // ── Render ──

    'render produces XML with all windows'(assert: any) {
        const ws = createWorkspace();
        const win = new Window();
        win.add('item1', { id: 'item1', value: 42 });
        ws.addWindow('data', win);

        const output = ws.render();
        assert.includes(output, '<workspace name="test">');
        assert.includes(output, 'item1');
        assert.includes(output, '</workspace>');
    },

    'render with window filter only renders selected windows'(assert: any) {
        const ws = createWorkspace();
        const win1 = new Window();
        win1.add('f1', { id: 'f1' });
        const win2 = new Window();
        win2.add('f2', { id: 'f2' });

        ws.addWindow('alpha', win1);
        ws.addWindow('beta', win2);

        const output = ws.render(['alpha']);
        assert.includes(output, 'f1');
        assert.ok(!output.includes('f2'), 'should not include beta window');
    },

    'render includes shared state'(assert: any) {
        const ws = createWorkspace();
        const output = ws.render();
        assert.includes(output, '<state>');
        assert.includes(output, 'dark');
    },

    'render with no windows and empty state returns empty string'(assert: any) {
        const ws = new Workspace('empty');
        const output = ws.render();
        assert.equal(output, '');
    },

    // ── Serialization ──

    'toJSON serializes state and window data'(assert: any) {
        const ws = createWorkspace();
        const win = new Window();
        win.add('item', { id: 'item', data: 'hello' });
        ws.addWindow('mywin', win);

        const json = ws.toJSON();
        assert.equal(json.name, 'test');
        assert.equal(json.state.stats.total, 10);
        assert.ok(json.windows.mywin, 'should include window data');
    },

    'loadJSON restores state'(assert: any) {
        const ws = createWorkspace();
        ws.loadJSON({
            state: { stats: { total: 99, active: 5 }, config: { theme: 'ocean' } },
        });

        assert.equal(ws.state.stats.total, 99);
        assert.equal(ws.state.config.theme, 'ocean');
    },

    'constructor with no initial state defaults to empty object'(assert: any) {
        const ws = new Workspace('bare');
        assert.ok(ws.state !== undefined, 'state should be defined');
        assert.equal(Object.keys(ws.state).length, 0, 'state should be empty');
    },

    // ── Storage integration ──

    async 'workspace save/load via SQLiteStorage'(assert: any) {
        const fs = await import('node:fs');
        const { SQLiteStorage } = await import('../../packages/drift/src/storage/sqlite-storage.ts');
        const dbPath = '/tmp/drift-workspace-test.db';
        try { fs.unlinkSync(dbPath); } catch {}
        try { fs.unlinkSync(dbPath + '-wal'); } catch {}
        try { fs.unlinkSync(dbPath + '-shm'); } catch {}

        const storage = new SQLiteStorage(dbPath);
        const ws = createWorkspace();
        ws.setState({ stats: { total: 100, active: 42 } });

        storage.saveWorkspace(ws.name, ws.toJSON());

        const loaded = storage.loadWorkspace('test');
        assert.ok(loaded, 'should load workspace');
        assert.equal(loaded.state.stats.total, 100);

        storage.close();
    },

    async 'loadWorkspace returns null for unknown name'(assert: any) {
        const fs = await import('node:fs');
        const { SQLiteStorage } = await import('../../packages/drift/src/storage/sqlite-storage.ts');
        const dbPath = '/tmp/drift-workspace-test2.db';
        try { fs.unlinkSync(dbPath); } catch {}

        const storage = new SQLiteStorage(dbPath);
        const result = storage.loadWorkspace('nonexistent');
        assert.ok(!result, 'should return null');
        storage.close();
    },
};
