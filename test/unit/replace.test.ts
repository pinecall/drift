/**
 * Unit Tests — Replace Tool
 * 
 * Tests line-based replace with content verification.
 * Uses real temp files — critical for preventing file corruption.
 */

import fs from 'node:fs';
import path from 'node:path';
import replace from '../../packages/drift/src/tools/edit/replace.ts';

export const name = 'Replace Tool';

const TMP_DIR = `/tmp/drift-test-replace-${Date.now()}`;

function setup() { fs.mkdirSync(TMP_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {} }

function createFile(name: string, content: string): string {
    const filePath = path.join(TMP_DIR, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

export const tests = {
    async 'single replace works'(assert: any) {
        setup();
        try {
            const filePath = createFile('single.js', 'line1\nline2\nline3\nline4\nline5');
            const result = await replace.execute({
                filePath, startLine: 2, startLineContent: 'line2',
                endLine: 3, endLineContent: 'line3', newContent: 'replaced2\nreplaced3'
            }, { cwd: TMP_DIR });

            assert.ok(result.success, 'should succeed');
            const content = readFile(filePath);
            assert.ok(content.includes('replaced2'), 'new content present');
            assert.ok(!content.includes('line2'), 'old content removed');
            assert.ok(content.includes('line1'), 'unaffected lines preserved');
        } finally { cleanup(); }
    },

    async 'startLineContent verification rejects mismatch'(assert: any) {
        setup();
        try {
            const filePath = createFile('verify.js', 'const x = 1;\nconst y = 2;\nconst z = 3;');
            const result = await replace.execute({
                filePath, startLine: 1, startLineContent: 'WRONG CONTENT',
                endLine: 1, endLineContent: 'const x = 1;', newContent: 'const x = 99;'
            }, { cwd: TMP_DIR });

            assert.ok(!result.success, 'should fail on mismatch');
            const content = readFile(filePath);
            assert.ok(content.includes('const x = 1'), 'file untouched on failure');
        } finally { cleanup(); }
    },

    async 'endLineContent verification rejects mismatch'(assert: any) {
        setup();
        try {
            const filePath = createFile('endver.js', 'line1\nline2\nline3');
            const result = await replace.execute({
                filePath, startLine: 1, startLineContent: 'line1',
                endLine: 2, endLineContent: 'WRONG', newContent: 'new'
            }, { cwd: TMP_DIR });

            assert.ok(!result.success, 'should fail on end line mismatch');
            assert.equal(readFile(filePath), 'line1\nline2\nline3', 'file untouched');
        } finally { cleanup(); }
    },

    async 'sequential calls on same file work correctly'(assert: any) {
        setup();
        try {
            const filePath = createFile('batch.js', 'a\nb\nc\nd\ne');
            
            const r1 = await replace.execute({
                filePath, startLine: 2, startLineContent: 'b',
                endLine: 2, endLineContent: 'b', newContent: 'B_REPLACED'
            }, { cwd: TMP_DIR });
            assert.ok(r1.success, 'first replace succeed');

            const r2 = await replace.execute({
                filePath, startLine: 4, startLineContent: 'd',
                endLine: 4, endLineContent: 'd', newContent: 'D_REPLACED'
            }, { cwd: TMP_DIR });
            assert.ok(r2.success, 'second replace succeed');

            const content = readFile(filePath);
            assert.ok(content.includes('B_REPLACED'), 'first applied');
            assert.ok(content.includes('D_REPLACED'), 'second applied');
        } finally { cleanup(); }
    },

    async 'verification failure leaves file untouched'(assert: any) {
        setup();
        try {
            const filePath = createFile('safe.js', 'keep\nme\nsafe');
            await replace.execute({
                filePath, startLine: 1, startLineContent: 'WRONG',
                endLine: 1, endLineContent: 'keep', newContent: 'DESTROYED'
            }, { cwd: TMP_DIR });

            assert.equal(readFile(filePath), 'keep\nme\nsafe', 'file untouched');
        } finally { cleanup(); }
    },

    async 'window refresh called after replace'(assert: any) {
        setup();
        try {
            const filePath = createFile('win.js', 'old\ncontent');
            let refreshed = false;
            const mockWindow = { refresh() { refreshed = true; } };

            await replace.execute({
                filePath, startLine: 1, startLineContent: 'old',
                endLine: 1, endLineContent: 'old', newContent: 'new'
            }, { cwd: TMP_DIR, window: mockWindow as any });

            assert.ok(refreshed, 'window.refresh called');
        } finally { cleanup(); }
    },

    async 'invalid line range returns error'(assert: any) {
        setup();
        try {
            const filePath = createFile('range.js', 'one\ntwo');
            const result = await replace.execute({
                filePath, startLine: 5, startLineContent: 'x',
                endLine: 10, endLineContent: 'y', newContent: 'z'
            }, { cwd: TMP_DIR });

            assert.ok(!result.success, 'should fail for out-of-range');
        } finally { cleanup(); }
    },
};
