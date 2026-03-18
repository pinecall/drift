/**
 * Workspace — Unit Tests
 * 
 * Tests the shared reactive state container: CRUD, versioning,
 * optimistic locking, rendering, and serialization.
 */

import { Workspace, type WorkspaceChangeEvent } from '../../packages/drift/src/state/workspace.ts';

export const name = 'Workspace';

interface TestState {
    market: { btc: number; eth: number };
    signals: string[];
    meta: { updated: number };
}

function createWorkspace(): Workspace<TestState> {
    return new Workspace<TestState>('test', {
        market: { btc: 67000, eth: 3800 },
        signals: ['BUY BTC'],
        meta: { updated: 0 },
    });
}

export const tests = {

    // ── Read ──

    'name returns constructor name'(assert: any) {
        const ws = createWorkspace();
        assert.equal(ws.name, 'test');
    },

    'state returns full state'(assert: any) {
        const ws = createWorkspace();
        assert.equal(ws.state.market.btc, 67000);
        assert.equal(ws.state.signals.length, 1);
    },

    'select returns deep copy (structuredClone)'(assert: any) {
        const ws = createWorkspace();
        const market = ws.select('market');
        market.btc = 0;  // mutate the copy
        assert.equal(ws.state.market.btc, 67000, 'original should be unchanged');
    },

    'version starts at 0 for all slices'(assert: any) {
        const ws = createWorkspace();
        assert.equal(ws.version('market'), 0);
        assert.equal(ws.version('signals'), 0);
        assert.equal(ws.version('meta'), 0);
    },

    'versions returns all version numbers'(assert: any) {
        const ws = createWorkspace();
        const v = ws.versions;
        assert.equal(v.market, 0);
        assert.equal(v.signals, 0);
        assert.equal(v.meta, 0);
    },

    // ── setState ──

    'setState shallow merges'(assert: any) {
        const ws = createWorkspace();
        ws.setState({ signals: ['SELL ETH'] });
        assert.equal(ws.state.signals[0], 'SELL ETH');
        assert.equal(ws.state.market.btc, 67000, 'other slices unchanged');
    },

    'setState bumps version for changed keys'(assert: any) {
        const ws = createWorkspace();
        ws.setState({ market: { btc: 70000, eth: 4000 } });
        assert.equal(ws.version('market'), 1);
        assert.equal(ws.version('signals'), 0, 'signals not changed');
    },

    'setState emits change event'(assert: any) {
        const ws = createWorkspace();
        const events: WorkspaceChangeEvent[] = [];
        ws.on('change', (e) => events.push(e));

        ws.setState({ meta: { updated: 123 } });
        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'setState');
        assert.equal(events[0].state.meta.updated, 123);
    },

    // ── setSlice ──

    'setSlice replaces a single slice'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 99000, eth: 5000 });
        assert.equal(ws.state.market.btc, 99000);
        assert.equal(ws.state.signals[0], 'BUY BTC', 'other slices unchanged');
    },

    'setSlice bumps version'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('signals', ['HOLD']);
        assert.equal(ws.version('signals'), 1);
        ws.setSlice('signals', ['BUY']);
        assert.equal(ws.version('signals'), 2);
    },

    'setSlice returns true on success'(assert: any) {
        const ws = createWorkspace();
        const result = ws.setSlice('market', { btc: 1, eth: 1 });
        assert.ok(result, 'should return true');
    },

    'setSlice emits change with slice info'(assert: any) {
        const ws = createWorkspace();
        const events: WorkspaceChangeEvent[] = [];
        ws.on('change', (e) => events.push(e));

        ws.setSlice('signals', ['NEW SIGNAL']);
        assert.equal(events.length, 1);
        assert.equal(events[0].action, 'setSlice');
        assert.equal(events[0].slice, 'signals');
        assert.equal(events[0].version, 1);
    },

    // ── Optimistic Locking ──

    'setSlice with correct expectedVersion succeeds'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 70000, eth: 4000 });  // v0 → v1
        const ok = ws.setSlice('market', { btc: 75000, eth: 4500 }, 1);  // expect v1
        assert.ok(ok, 'should succeed with correct version');
        assert.equal(ws.state.market.btc, 75000);
        assert.equal(ws.version('market'), 2);
    },

    'setSlice with wrong expectedVersion fails'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 70000, eth: 4000 });  // v0 → v1
        const ok = ws.setSlice('market', { btc: 99999, eth: 99999 }, 0);  // expect v0, but it's v1
        assert.ok(!ok, 'should fail with stale version');
        assert.equal(ws.state.market.btc, 70000, 'state unchanged after failed write');
        assert.equal(ws.version('market'), 1, 'version unchanged after failed write');
    },

    'setSlice without expectedVersion always succeeds'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 1, eth: 1 });
        ws.setSlice('market', { btc: 2, eth: 2 });
        ws.setSlice('market', { btc: 3, eth: 3 });
        assert.equal(ws.state.market.btc, 3);
        assert.equal(ws.version('market'), 3);
    },

    // ── Render ──

    'render produces XML with all slices'(assert: any) {
        const ws = createWorkspace();
        const output = ws.render();
        assert.includes(output, '<workspace name="test">');
        assert.includes(output, '<slice name="market"');
        assert.includes(output, '<slice name="signals"');
        assert.includes(output, '<slice name="meta"');
        assert.includes(output, '</workspace>');
    },

    'render with slice filter only renders selected slices'(assert: any) {
        const ws = createWorkspace();
        const output = ws.render(['market']);
        assert.includes(output, '<slice name="market"');
        assert.ok(!output.includes('signals'), 'should not include signals');
        assert.ok(!output.includes('meta'), 'should not include meta');
    },

    'render includes version in slice tags'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 1, eth: 1 });
        const output = ws.render(['market']);
        assert.includes(output, 'v="1"');
    },

    'render with empty slices returns empty string'(assert: any) {
        const ws = createWorkspace();
        const output = ws.render([]);
        assert.equal(output, '');
    },

    // ── Serialization ──

    'toJSON/loadJSON roundtrip preserves state and versions'(assert: any) {
        const ws = createWorkspace();
        ws.setSlice('market', { btc: 99000, eth: 5000 });
        ws.setSlice('signals', ['HOLD', 'BUY']);
        ws.setSlice('signals', ['ONLY BUY']);

        const json = ws.toJSON();
        assert.equal(json.name, 'test');
        assert.equal(json.versions.market, 1);
        assert.equal(json.versions.signals, 2);

        const ws2 = new Workspace<TestState>('test', { market: { btc: 0, eth: 0 }, signals: [], meta: { updated: 0 } });
        ws2.loadJSON(json as any);

        assert.equal(ws2.state.market.btc, 99000);
        assert.equal(ws2.state.signals[0], 'ONLY BUY');
        assert.equal(ws2.version('market'), 1);
        assert.equal(ws2.version('signals'), 2);
    },

    'loadJSON without versions initializes at 0'(assert: any) {
        const ws = new Workspace('test', { a: 1, b: 2 });
        ws.loadJSON({ state: { a: 10, b: 20 } });
        assert.equal(ws.state.a, 10);
        assert.equal(ws.version('a'), 0);
        assert.equal(ws.version('b'), 0);
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
        ws.setSlice('market', { btc: 100000, eth: 6000 });

        storage.saveWorkspace(ws.name, ws.toJSON());

        const loaded = storage.loadWorkspace('test');
        assert.ok(loaded, 'should load workspace');
        assert.equal(loaded.state.market.btc, 100000);
        assert.equal(loaded.versions.market, 1);

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
