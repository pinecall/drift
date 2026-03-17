/**
 * Unit Tests — Cache
 * 
 * Tests the Cache class: breakpoint placement on system prompts and tools.
 */

import { Cache } from '../../packages/drift/src/core/cache.ts';

export const name = 'Cache';

export const tests = {
    'default config enables prompt and tools'(assert: any) {
        const cache = new Cache();
        assert.equal(cache.prompt, true, 'prompt cached by default');
        assert.equal(cache.tools, true, 'tools cached by default');
    },

    'custom config'(assert: any) {
        const cache = new Cache({ prompt: false, tools: true });
        assert.equal(cache.prompt, false);
        assert.equal(cache.tools, true);
    },

    'applyToSystem adds cache_control to last block'(assert: any) {
        const cache = new Cache();
        const blocks = [
            { type: 'text', text: 'You are helpful.' },
            { type: 'text', text: 'Extra context.' },
        ];
        const result = cache.applyToSystem(blocks);

        assert.equal(result.length, 2, 'same number of blocks');
        assert.ok(!result[0].cache_control, 'first block has no cache_control');
        assert.deepEqual(result[1].cache_control, { type: 'ephemeral' }, 'last block has cache_control');
    },

    'applyToSystem does not mutate original'(assert: any) {
        const cache = new Cache();
        const original = [{ type: 'text', text: 'Hello' }];
        const result = cache.applyToSystem(original);

        assert.ok(!original[0].cache_control, 'original untouched');
        assert.ok(result[0].cache_control, 'result has cache_control');
    },

    'applyToSystem with prompt=false returns blocks unchanged'(assert: any) {
        const cache = new Cache({ prompt: false });
        const blocks = [{ type: 'text', text: 'Hello' }];
        const result = cache.applyToSystem(blocks);

        assert.ok(!result[0].cache_control, 'no cache_control when disabled');
    },

    'applyToSystem handles empty array'(assert: any) {
        const cache = new Cache();
        const result = cache.applyToSystem([]);
        assert.equal(result.length, 0);
    },

    'applyToTools marks last tool'(assert: any) {
        const cache = new Cache();
        const tools = [
            { name: 'tool_a', description: 'A' },
            { name: 'tool_b', description: 'B' },
        ];
        cache.applyToTools(tools);

        assert.ok(!tools[0].cache_control, 'first tool no breakpoint');
        assert.deepEqual((tools[1] as any).cache_control, { type: 'ephemeral' }, 'last tool has breakpoint');
    },

    'applyToTools with tools=false does nothing'(assert: any) {
        const cache = new Cache({ tools: false });
        const tools = [{ name: 'tool_a', description: 'A' }];
        cache.applyToTools(tools);

        assert.ok(!(tools[0] as any).cache_control, 'no breakpoint when disabled');
    },

    'applyToTools handles empty array'(assert: any) {
        const cache = new Cache();
        const result = cache.applyToTools([]);
        assert.equal(result.length, 0);
    },

    'toString reflects config'(assert: any) {
        assert.equal(new Cache().toString(), 'Cache(prompt, tools)');
        assert.equal(new Cache({ prompt: false }).toString(), 'Cache(tools)');
        assert.equal(new Cache({ prompt: false, tools: false }).toString(), 'Cache(disabled)');
    },
};
