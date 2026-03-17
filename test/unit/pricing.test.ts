/**
 * Unit Tests — Pricing
 * 
 * Tests cost calculation, cache savings, and model switching.
 */

import { Pricing } from '../../src/core/pricing.ts';
import { getModel } from '../../src/provider/models.ts';

export const name = 'Pricing';

export const tests = {
    'record calculates cost correctly'(assert: any) {
        const sonnet = getModel('sonnet')!;
        const pricing = new Pricing(sonnet);

        const turn = pricing.record({
            input_tokens: 1000,
            output_tokens: 500,
        });

        assert.gt(turn.cost, 0, 'cost is positive');
        assert.equal(turn.inputTokens, 1000);
        assert.equal(turn.outputTokens, 500);
    },

    'totals accumulate across turns'(assert: any) {
        const haiku = getModel('haiku')!;
        const pricing = new Pricing(haiku);

        pricing.record({ input_tokens: 1000, output_tokens: 500 });
        pricing.record({ input_tokens: 2000, output_tokens: 1000 });

        assert.equal(pricing.totals.inputTokens, 3000);
        assert.equal(pricing.totals.outputTokens, 1500);
        assert.equal(pricing.turns.length, 2);
    },

    'cache savings tracked'(assert: any) {
        const sonnet = getModel('sonnet')!;
        const pricing = new Pricing(sonnet);

        const turn = pricing.record({
            input_tokens: 500,
            output_tokens: 200,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 5000,
        });

        assert.gt(turn.cacheWriteTokens, 0, 'cache write tracked');
        assert.gt(turn.cacheReadTokens, 0, 'cache read tracked');
        assert.gt(turn.cacheSavings, 0, 'cache savings positive');
    },

    'formatCost returns dollar string'(assert: any) {
        const sonnet = getModel('sonnet')!;
        const pricing = new Pricing(sonnet);
        pricing.record({ input_tokens: 100, output_tokens: 50 });

        const formatted = pricing.formatCost();
        assert.ok(formatted.startsWith('$'), 'starts with $');
    },

    'totalCost matches totals.cost'(assert: any) {
        const sonnet = getModel('sonnet')!;
        const pricing = new Pricing(sonnet);
        pricing.record({ input_tokens: 1000, output_tokens: 500 });

        assert.equal(pricing.totalCost(), pricing.totals.cost);
    },

    'setModel changes pricing calculation'(assert: any) {
        const haiku = getModel('haiku')!;
        const opus = getModel('opus')!;
        const pricing = new Pricing(haiku);

        pricing.record({ input_tokens: 1000, output_tokens: 500 });
        const haikuCost = pricing.totalCost();

        // Switch to Opus (more expensive)
        pricing.setModel(opus);
        pricing.record({ input_tokens: 1000, output_tokens: 500 });
        const totalWithOpus = pricing.totalCost();

        assert.gt(totalWithOpus - haikuCost, haikuCost * 0.5, 'Opus turn should be more expensive');
    },

    'reset clears everything'(assert: any) {
        const sonnet = getModel('sonnet')!;
        const pricing = new Pricing(sonnet);
        pricing.record({ input_tokens: 1000, output_tokens: 500 });
        
        pricing.reset();
        assert.equal(pricing.totalCost(), 0);
        assert.equal(pricing.turns.length, 0);
        assert.equal(pricing.totals.inputTokens, 0);
    },
};
