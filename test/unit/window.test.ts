/**
 * Window + CodebaseWindow — Unit Tests
 */
import { Window, type WindowItem, type WindowChangeEvent } from '../../packages/drift/src/state/window.ts';
import { CodebaseWindow, type FileEntry } from '../../packages/drift/src/windows/codebase-window.tsx';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const suite = 'Window';

export const tests: Record<string, () => void | Promise<void>> = {

    // ── Window<T> Base ──────────────────────────────

    'add/get/has/list work correctly'() {
        const w = new Window();
        w.add('a', { id: 'a', value: 1 });
        w.add('b', { id: 'b', value: 2 });

        if (!w.has('a')) throw new Error('should have a');
        if (w.has('c')) throw new Error('should not have c');
        if (w.get('a')?.value !== 1) throw new Error('wrong value for a');
        if (w.size !== 2) throw new Error(`expected size 2, got ${w.size}`);
        if (w.list().length !== 2) throw new Error('list should have 2 items');
        if (w.keys().length !== 2) throw new Error('keys should have 2');
    },

    'remove returns true/false correctly'() {
        const w = new Window();
        w.add('a', { id: 'a' });
        if (!w.remove('a')) throw new Error('should return true');
        if (w.remove('a')) throw new Error('should return false');
        if (w.size !== 0) throw new Error('should be empty');
    },

    'update merges fields'() {
        const w = new Window();
        w.add('a', { id: 'a', x: 1, y: 2 });
        w.update('a', { y: 99 });
        const item = w.get('a')!;
        if (item.x !== 1) throw new Error('x should be unchanged');
        if (item.y !== 99) throw new Error('y should be 99');
    },

    'update on non-existent item is no-op'() {
        const w = new Window();
        w.update('nope', { x: 1 });
        if (w.size !== 0) throw new Error('should still be empty');
    },

    'clear removes all items'() {
        const w = new Window();
        w.add('a', { id: 'a' });
        w.add('b', { id: 'b' });
        w.clear();
        if (w.size !== 0) throw new Error('should be empty');
    },

    // ── Events ──────────────────────────────────────

    'emits change on add'() {
        const w = new Window();
        const events: WindowChangeEvent[] = [];
        w.on('change', (e) => events.push(e));

        w.add('x', { id: 'x' });
        if (events.length !== 1) throw new Error('expected 1 event');
        if (events[0].action !== 'add') throw new Error('expected add action');
        if (events[0].id !== 'x') throw new Error('expected id x');
        if (events[0].items.length !== 1) throw new Error('snapshot should have 1 item');
    },

    'emits change on remove'() {
        const w = new Window();
        w.add('x', { id: 'x' });
        const events: WindowChangeEvent[] = [];
        w.on('change', (e) => events.push(e));

        w.remove('x');
        if (events.length !== 1) throw new Error('expected 1 event');
        if (events[0].action !== 'remove') throw new Error('expected remove action');
        if (events[0].items.length !== 0) throw new Error('snapshot should be empty');
    },

    'emits change on update'() {
        const w = new Window();
        w.add('x', { id: 'x', v: 1 });
        const events: WindowChangeEvent[] = [];
        w.on('change', (e) => events.push(e));

        w.update('x', { v: 2 });
        if (events.length !== 1) throw new Error('expected 1 event');
        if (events[0].action !== 'update') throw new Error('expected update action');
    },

    'emits change on clear'() {
        const w = new Window();
        w.add('a', { id: 'a' });
        const events: WindowChangeEvent[] = [];
        w.on('change', (e) => events.push(e));

        w.clear();
        if (events.length !== 1) throw new Error('expected 1 event');
        if (events[0].action !== 'clear') throw new Error('expected clear action');
    },

    // ── State (React-like) ──────────────────────────

    'initial state is empty object'() {
        const w = new Window();
        if (Object.keys(w.state).length !== 0) throw new Error('should be empty');
    },

    'constructor accepts initial state'() {
        const w = new Window({ theme: 'dark', count: 0 });
        if (w.state.theme !== 'dark') throw new Error('expected dark');
        if (w.state.count !== 0) throw new Error('expected 0');
    },

    'setState shallow merges'() {
        const w = new Window({ a: 1, b: 2 });
        w.setState({ b: 99 });
        if (w.state.a !== 1) throw new Error('a unchanged');
        if (w.state.b !== 99) throw new Error('b should be 99');
    },

    'setState emits change with action setState'() {
        const w = new Window({ x: 0 });
        const events: WindowChangeEvent[] = [];
        w.on('change', (e) => events.push(e));

        w.setState({ x: 42 });
        if (events.length !== 1) throw new Error('expected 1 event');
        if (events[0].action !== 'setState') throw new Error('expected setState action');
        if (events[0].state.x !== 42) throw new Error('state snapshot should have x=42');
    },

    'state is readonly (returns frozen-like copy)'() {
        const w = new Window({ x: 1 });
        const s = w.state;
        if (s.x !== 1) throw new Error('expected 1');
    },

    // ── Turn Management ─────────────────────────────

    'turn starts at 0 and increments'() {
        const w = new Window();
        if (w.turn !== 0) throw new Error('should start at 0');
        w.nextTurn();
        if (w.turn !== 1) throw new Error('should be 1');
        w.nextTurn();
        if (w.turn !== 2) throw new Error('should be 2');
    },

    // ── Serialization ───────────────────────────────

    'toJSON/loadJSON roundtrip'() {
        const w = new Window({ mode: 'test' });
        w.add('a', { id: 'a', v: 1 });
        w.add('b', { id: 'b', v: 2 });
        w.nextTurn();
        w.nextTurn();

        const json = w.toJSON();
        const w2 = new Window();
        w2.loadJSON(json);

        if (w2.size !== 2) throw new Error('expected 2 items');
        if (w2.get('a')?.v !== 1) throw new Error('a.v should be 1');
        if (w2.state.mode !== 'test') throw new Error('state.mode should be test');
        if (w2.turn !== 2) throw new Error('turn should be 2');
    },

    // ── Render ──────────────────────────────────────

    'render returns empty string when no items'() {
        const w = new Window();
        if (w.render() !== '') throw new Error('should be empty');
    },

    'render returns window XML with items'() {
        const w = new Window();
        w.add('test', { id: 'test', value: 42 });
        const output = w.render();
        if (!output.includes('<window>')) throw new Error('missing <window> tag');
        if (!output.includes('test')) throw new Error('missing item id');
    },

    // ── CodebaseWindow ──────────────────────────────

    'open reads file from disk'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        const filePath = path.join(tmpDir, 'hello.ts');
        fs.writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n');

        const win = new CodebaseWindow({ cwd: tmpDir });
        const result = win.open('hello.ts');

        if (!result.success) throw new Error(`open failed: ${result.error}`);
        if (result.lines !== 3) throw new Error(`expected 3 lines, got ${result.lines}`);
        if (win.size !== 1) throw new Error('should have 1 file');

        const entry = win.get('hello.ts')!;
        if (!entry.content.includes('const x = 1')) throw new Error('missing content');
        if (entry.disabled !== false) throw new Error('should not be disabled');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'open returns error for missing file'() {
        const win = new CodebaseWindow({ cwd: os.tmpdir() });
        const result = win.open('nonexistent-file-xyz.ts');
        if (result.success) throw new Error('should fail');
        if (!result.error) throw new Error('should have error message');
    },

    'close removes file'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'hello');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');
        if (win.size !== 1) throw new Error('should have 1');
        win.close('a.ts');
        if (win.size !== 0) throw new Error('should be empty');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'refresh re-reads from disk'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        const filePath = path.join(tmpDir, 'data.ts');
        fs.writeFileSync(filePath, 'v1');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('data.ts');
        if (!win.get('data.ts')!.content.includes('v1')) throw new Error('should have v1');

        fs.writeFileSync(filePath, 'v2\nupdated');
        win.refresh('data.ts');
        if (!win.get('data.ts')!.content.includes('v2')) throw new Error('should have v2');
        if (win.get('data.ts')!.lines !== 2) throw new Error('should have 2 lines');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'disable/enable controls rendering'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'content');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');
        win.disable('a.ts');
        if (win.get('a.ts')!.disabled !== true) throw new Error('should be disabled');

        const rendered = win.render();
        if (rendered.includes('content')) throw new Error('disabled file should not appear in render');

        win.enable('a.ts');
        if (win.get('a.ts')!.disabled !== false) throw new Error('should be enabled');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'render produces <window> XML with numbered lines'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'line1\nline2\nline3');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('test.ts');
        const output = win.render();

        if (!output.includes('<window>')) throw new Error('missing <window>');
        if (!output.includes('</window>')) throw new Error('missing </window>');
        if (!output.includes('test.ts')) throw new Error('missing filename');
        if (!output.includes('1| line1')) throw new Error('missing numbered line 1');
        if (!output.includes('2| line2')) throw new Error('missing numbered line 2');
        if (!output.includes('📂 Open files')) throw new Error('missing header');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'render shows empty message when no files'() {
        const win = new CodebaseWindow();
        const output = win.render();
        if (!output.includes('No files open')) throw new Error('should show no files message');
    },

    'renderMetadata summarizes files'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'line1\nline2');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');
        const meta = win.renderMetadata();

        if (!meta.includes('a.ts')) throw new Error('missing filename');
        if (!meta.includes('Loaded in window')) throw new Error('missing header');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'stats returns correct counts'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'l1\nl2\nl3');
        fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'l1');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');
        win.open('b.ts');

        const s = win.stats();
        if (s.files !== 2) throw new Error(`expected 2 files, got ${s.files}`);
        if (s.openFiles.length !== 2) throw new Error('expected 2 openFiles');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'refreshAll detects changed files'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'original');
        fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'unchanged');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');
        win.open('b.ts');

        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'modified');
        const changed = win.refreshAll();

        if (changed.length !== 1) throw new Error(`expected 1 changed, got ${changed.length}`);
        if (changed[0] !== 'a.ts') throw new Error('expected a.ts');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'change events fire on open/close'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'content');

        const win = new CodebaseWindow({ cwd: tmpDir });
        const events: WindowChangeEvent[] = [];
        win.on('change', (e) => events.push(e));

        win.open('a.ts');
        if (events.length !== 1) throw new Error('expected 1 event after open');
        if (events[0].action !== 'add') throw new Error('expected add');

        win.close('a.ts');
        if (events.length !== 2) throw new Error('expected 2 events after close');
        if (events[1].action !== 'remove') throw new Error('expected remove');

        fs.rmSync(tmpDir, { recursive: true });
    },

    'grep results appear in render and expire'() {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-win-'));
        fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const x = 1;');

        const win = new CodebaseWindow({ cwd: tmpDir });
        win.open('a.ts');

        win.addGrepResults('TODO', [
            { file: 'b.ts', line: 5, content: '// TODO: fix this' },
        ], 2);

        let output = win.render();
        if (!output.includes('TODO')) throw new Error('grep should appear');
        if (!output.includes('b.ts:5')) throw new Error('grep match should appear');

        // Advance past TTL
        win.nextTurn();
        win.nextTurn();
        win.nextTurn();

        output = win.render();
        if (output.includes('TODO')) throw new Error('grep should have expired');

        fs.rmSync(tmpDir, { recursive: true });
    },
};
