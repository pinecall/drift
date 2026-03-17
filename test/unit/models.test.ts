/**
 * Unit Tests — Models
 * 
 * Tests model resolution, thinking config, and beta headers.
 */

import { getModel, getModelById, listModels, buildThinkingConfig, getBetaHeaders, MODELS } from '../../src/provider/models.ts';

export const name = 'Models';

export const tests = {
    'getModel resolves short names'(assert: any) {
        const opus = getModel('opus');
        assert.ok(opus, 'opus found');
        assert.equal(opus!.shortName, 'opus');

        const sonnet = getModel('sonnet');
        assert.ok(sonnet, 'sonnet found');

        const haiku = getModel('haiku');
        assert.ok(haiku, 'haiku found');
    },

    'getModel is case-insensitive'(assert: any) {
        assert.ok(getModel('OPUS'), 'OPUS resolves');
        assert.ok(getModel('Sonnet'), 'Sonnet resolves');
    },

    'getModel returns null for unknown'(assert: any) {
        assert.equal(getModel('gpt-4'), null);
    },

    'getModelById finds by full ID'(assert: any) {
        const model = getModelById('claude-opus-4-6');
        assert.ok(model, 'found by ID');
        assert.equal(model!.shortName, 'opus');
    },

    'listModels returns all names'(assert: any) {
        const models = listModels();
        assert.ok(models.includes('opus'));
        assert.ok(models.includes('sonnet'));
        assert.ok(models.includes('haiku'));
    },

    // ── Thinking Config ──

    'adaptive thinking for Opus/Sonnet'(assert: any) {
        const opus = getModel('opus')!;
        const config = buildThinkingConfig(opus, { thinking: true });
        assert.deepEqual(config, { type: 'adaptive' });
    },

    'manual thinking for Haiku'(assert: any) {
        const haiku = getModel('haiku')!;
        const config = buildThinkingConfig(haiku, { thinking: true, effort: 'low' });
        assert.ok(config, 'config exists');
        assert.equal((config as any).type, 'enabled');
        assert.equal((config as any).budget_tokens, 10000);
    },

    'haiku thinking budget scales with effort'(assert: any) {
        const haiku = getModel('haiku')!;

        const low = buildThinkingConfig(haiku, { thinking: true, effort: 'low' });
        const high = buildThinkingConfig(haiku, { thinking: true, effort: 'high' });
        assert.gt((high as any).budget_tokens, (low as any).budget_tokens, 'high > low');
    },

    'thinking disabled returns null'(assert: any) {
        const opus = getModel('opus')!;
        const config = buildThinkingConfig(opus, { thinking: false });
        assert.equal(config, null);
    },

    // ── Beta Headers ──

    'no beta headers for Opus standard'(assert: any) {
        const opus = getModel('opus')!;
        const headers = getBetaHeaders(opus, { thinking: true });
        assert.equal(headers.length, 0, 'no headers needed');
    },

    'interleaved thinking header for Haiku'(assert: any) {
        const haiku = getModel('haiku')!;
        const headers = getBetaHeaders(haiku, { thinking: true });
        assert.ok(headers.some(h => h.includes('interleaved-thinking')), 'has interleaved thinking header');
    },

    '1M context is GA — no beta header needed'(assert: any) {
        const opus = getModel('opus')!;
        const headers = getBetaHeaders(opus, { thinking: true });
        assert.ok(!headers.some(h => h.includes('context-1m')), '1M context is GA — no beta header');
    },

    'no 1M context for Haiku'(assert: any) {
        const haiku = getModel('haiku')!;
        const headers = getBetaHeaders(haiku, {});
        assert.ok(!headers.some(h => h.includes('context-1m')), 'Haiku has no 1M header');
    },

    // ── Pricing ──

    'all models have pricing'(assert: any) {
        for (const [name, model] of Object.entries(MODELS)) {
            assert.ok(model.pricing, `${name} has pricing`);
            assert.gt(model.pricing.input, 0, `${name} input price > 0`);
            assert.gt(model.pricing.output, 0, `${name} output price > 0`);
        }
    },
};
