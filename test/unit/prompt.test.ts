/**
 * Unit Tests — Prompt Resolver
 * 
 * Tests class name → kebab-case conversion and file-based prompt loading.
 */

import fs from 'node:fs';
import path from 'node:path';
import { classNameToKebab, resolvePrompt } from '../../src/core/prompt.ts';

export const name = 'Prompt Resolver';

const TMP_DIR = `/tmp/drift-test-prompt-${Date.now()}`;

function setup() {
    fs.mkdirSync(path.join(TMP_DIR, 'prompts'), { recursive: true });
}

function cleanup() {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

export const tests = {
    // ── classNameToKebab ──

    'BookingAgent → booking'(assert: any) {
        assert.equal(classNameToKebab('BookingAgent'), 'booking');
    },

    'MyCustomAgent → my-custom'(assert: any) {
        assert.equal(classNameToKebab('MyCustomAgent'), 'my-custom');
    },

    'Scanner → scanner (no Agent suffix)'(assert: any) {
        assert.equal(classNameToKebab('Scanner'), 'scanner');
    },

    'DataPipelineAgent → data-pipeline'(assert: any) {
        assert.equal(classNameToKebab('DataPipelineAgent'), 'data-pipeline');
    },

    'Agent → agent (exact match kept)'(assert: any) {
        assert.equal(classNameToKebab('Agent'), 'agent');
    },

    'CodeReviewBot → code-review-bot'(assert: any) {
        assert.equal(classNameToKebab('CodeReviewBot'), 'code-review-bot');
    },

    // ── resolvePrompt — file loading ──

    'loads prompt from prompts/{kebab}.txt'(assert: any) {
        setup();
        try {
            const promptText = 'You are a booking assistant.';
            fs.writeFileSync(path.join(TMP_DIR, 'prompts', 'booking.txt'), promptText);

            const result = resolvePrompt('BookingAgent', undefined, TMP_DIR);
            assert.equal(result.prompt, promptText);
            assert.equal(result.source, 'file');
        } finally { cleanup(); }
    },

    'loads prompt from prompts/@{kebab}.txt (PineCode convention)'(assert: any) {
        setup();
        try {
            const promptText = 'You are a scanner.';
            fs.writeFileSync(path.join(TMP_DIR, 'prompts', '@scanner.txt'), promptText);

            const result = resolvePrompt('Scanner', undefined, TMP_DIR);
            assert.equal(result.prompt, promptText);
            assert.equal(result.source, 'file');
        } finally { cleanup(); }
    },

    'loads prompt from prompts/{ClassName}.txt'(assert: any) {
        setup();
        try {
            const promptText = 'Exact class name match.';
            fs.writeFileSync(path.join(TMP_DIR, 'prompts', 'ReviewAgent.txt'), promptText);

            const result = resolvePrompt('ReviewAgent', undefined, TMP_DIR);
            assert.equal(result.prompt, promptText);
            assert.equal(result.source, 'file');
        } finally { cleanup(); }
    },

    // ── resolvePrompt — priority ──

    'file takes priority over inline'(assert: any) {
        setup();
        try {
            fs.writeFileSync(path.join(TMP_DIR, 'prompts', 'test.txt'), 'from file');

            const result = resolvePrompt('TestAgent', 'from inline', TMP_DIR);
            assert.equal(result.prompt, 'from file', 'file wins');
            assert.equal(result.source, 'file');
        } finally { cleanup(); }
    },

    'inline used when no file exists'(assert: any) {
        setup();
        try {
            const result = resolvePrompt('NoFileAgent', 'inline prompt', TMP_DIR);
            assert.equal(result.prompt, 'inline prompt');
            assert.equal(result.source, 'inline');
        } finally { cleanup(); }
    },

    'default fallback when nothing else'(assert: any) {
        setup();
        try {
            const result = resolvePrompt('EmptyAgent', undefined, TMP_DIR);
            assert.equal(result.source, 'default');
            assert.ok(result.prompt.length > 0, 'has default prompt');
        } finally { cleanup(); }
    },
};
