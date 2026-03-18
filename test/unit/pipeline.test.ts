/**
 * Unit Tests — Pipeline + PipelineManager
 * 
 * Tests the Pipeline class (sequential execution, hooks, conditions, error handling)
 * and PipelineManager (add/remove/list/get/run).
 * 
 * No API calls — uses mock dispatch.
 */

import { Pipeline, PipelineManager } from '../../packages/drift/src/coordination/pipeline.ts';
import type { DispatchFn, DispatchResult } from '../../packages/drift/src/coordination/trigger.ts';
import type { PipelineStep, PipelineContext } from '../../packages/drift/src/coordination/pipeline.ts';

export const name = 'Pipeline';

// ── Helpers ──

function mockDispatch(responses?: Record<string, string>): { fn: DispatchFn; calls: { agent: string; message: string }[] } {
    const calls: { agent: string; message: string }[] = [];
    const fn: DispatchFn = async (agent, message) => {
        calls.push({ agent, message });
        const text = responses?.[agent] || `Response from ${agent}`;
        return { text, cost: 0.001, toolCalls: [], sessionId: `__dispatch__:${agent}`, aborted: false };
    };
    return { fn, calls };
}

function failingDispatch(failAgent: string): DispatchFn {
    return async (agent, message) => {
        if (agent === failAgent) throw new Error(`Agent "${agent}" unavailable`);
        return { text: `OK from ${agent}`, cost: 0.001, toolCalls: [], sessionId: `__dispatch__:${agent}`, aborted: false };
    };
}

// ── Tests ──

export const tests = {
    async 'Pipeline._run() executes steps sequentially'(assert: any) {
        class TestPipeline extends Pipeline {
            steps = ['agent-a', 'agent-b', 'agent-c'];
        }

        const { fn, calls } = mockDispatch();
        const pipeline = new TestPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'test';

        const result = await pipeline._run('Start');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(result.steps.length, 3, '3 steps executed');
        assert.equal(calls.length, 3, '3 dispatch calls');
        assert.equal(calls[0].agent, 'agent-a', 'first agent');
        assert.equal(calls[1].agent, 'agent-b', 'second agent');
        assert.equal(calls[2].agent, 'agent-c', 'third agent');
    },

    async 'Pipeline passes previous text to next step'(assert: any) {
        class ChainPipeline extends Pipeline {
            steps = ['first', 'second'];
        }

        const responses = { first: 'Step 1 output', second: 'Step 2 output' };
        const { fn, calls } = mockDispatch(responses);
        const pipeline = new ChainPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'chain';

        const result = await pipeline._run('Original input');

        // Step 0 gets original input
        assert.equal(calls[0].message, 'Original input', 'step 0 gets original input');
        // Step 1 gets step 0's text output
        assert.equal(calls[1].message, 'Step 1 output', 'step 1 gets prev text');
        assert.equal(result.finalText, 'Step 2 output', 'final text is last step');
    },

    async 'PipelineStep.message() custom builder works'(assert: any) {
        class CustomPipeline extends Pipeline {
            steps: PipelineStep[] = [
                { agent: 'scanner', message: (ctx) => `SCAN: ${ctx.input}` },
                { agent: 'analyzer', message: (ctx) => `ANALYZE: ${ctx.prev.text} (step ${ctx.step})` },
            ];
        }

        const responses = { scanner: 'Found 5 items' };
        const { fn, calls } = mockDispatch(responses);
        const pipeline = new CustomPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'custom';

        await pipeline._run('BTC market');

        assert.equal(calls[0].message, 'SCAN: BTC market', 'custom message for step 0');
        assert.includes(calls[1].message, 'ANALYZE: Found 5 items', 'custom message uses prev');
        assert.includes(calls[1].message, 'step 1', 'ctx.step is correct');
    },

    async 'PipelineStep.condition() skips when false'(assert: any) {
        class ConditionalPipeline extends Pipeline {
            steps: PipelineStep[] = [
                { agent: 'step-1' },
                { agent: 'step-2', condition: () => false },
                { agent: 'step-3' },
            ];
        }

        const { fn, calls } = mockDispatch();
        const pipeline = new ConditionalPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'conditional';

        const result = await pipeline._run('Input');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(calls.length, 2, 'only 2 dispatches (step-2 skipped)');
        assert.equal(calls[0].agent, 'step-1', 'step-1 ran');
        assert.equal(calls[1].agent, 'step-3', 'step-3 ran');
        assert.ok(result.steps[1].skipped, 'step-2 marked as skipped');
    },

    async 'Pipeline.beforeStep() can override message'(assert: any) {
        class HookPipeline extends Pipeline {
            steps = ['agent-x'];
            beforeStep(step: number, ctx: PipelineContext): string | void {
                return 'OVERRIDDEN MESSAGE';
            }
        }

        const { fn, calls } = mockDispatch();
        const pipeline = new HookPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'hook';

        await pipeline._run('Original');

        assert.equal(calls[0].message, 'OVERRIDDEN MESSAGE', 'beforeStep override works');
    },

    async 'Pipeline.afterStep() called after each step'(assert: any) {
        const afterCalls: number[] = [];

        class AfterPipeline extends Pipeline {
            steps = ['a', 'b'];
            afterStep(step: number) { afterCalls.push(step); }
        }

        const { fn } = mockDispatch();
        const pipeline = new AfterPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'after';

        await pipeline._run('Test');

        assert.equal(afterCalls.length, 2, 'afterStep called twice');
        assert.equal(afterCalls[0], 0, 'called for step 0');
        assert.equal(afterCalls[1], 1, 'called for step 1');
    },

    async 'Pipeline.onError() returns abort → stops pipeline'(assert: any) {
        class AbortPipeline extends Pipeline {
            steps = ['good', 'bad', 'after-bad'];
            onError() { return 'abort' as const; }
        }

        const fn = failingDispatch('bad');
        const pipeline = new AbortPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'abort';

        const result = await pipeline._run('Test');

        assert.ok(!result.ok, 'pipeline failed');
        assert.ok(result.aborted, 'pipeline aborted');
        assert.equal(result.steps.length, 2, 'stopped at step 2 (bad)');
        assert.includes(result.error!, 'unavailable', 'error message present');
    },

    async 'Pipeline.onError() returns skip → continues'(assert: any) {
        class SkipPipeline extends Pipeline {
            steps = ['good', 'bad', 'after-bad'];
            onError() { return 'skip' as const; }
        }

        const fn = failingDispatch('bad');
        const pipeline = new SkipPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'skip';

        const result = await pipeline._run('Test');

        assert.ok(result.ok, 'pipeline succeeded despite error');
        assert.equal(result.steps.length, 3, 'all 3 steps attempted');
        assert.ok(result.steps[1].skipped, 'bad step marked as skipped');
        assert.ok(!result.steps[2].skipped, 'after-bad step ran');
    },

    async 'Pipeline.onError() returns retry → retries once'(assert: any) {
        let attempts = 0;

        class RetryPipeline extends Pipeline {
            steps: PipelineStep[] = [
                { agent: 'flaky' },
            ];
            onError() { return 'retry' as const; }
        }

        const fn: DispatchFn = async (agent, message) => {
            attempts++;
            if (attempts === 1) throw new Error('Transient error');
            return { text: 'OK', cost: 0.001, toolCalls: [], sessionId: '__retry__', aborted: false };
        };

        const pipeline = new RetryPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'retry';

        const result = await pipeline._run('Test');

        assert.ok(result.ok, 'pipeline succeeded after retry');
        assert.equal(attempts, 2, 'retried once');
    },

    async 'PipelineResult.totalCost aggregates all steps'(assert: any) {
        class CostPipeline extends Pipeline {
            steps = ['a', 'b', 'c'];
        }

        const fn: DispatchFn = async (agent) => ({
            text: `from ${agent}`, cost: 0.01, toolCalls: [], sessionId: `__${agent}__`, aborted: false,
        });

        const pipeline = new CostPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'cost';

        const result = await pipeline._run('Test');

        assert.equal(result.totalCost.toFixed(2), '0.03', 'cost aggregated');
    },

    async 'PipelineManager.add/remove/list/get'(assert: any) {
        const manager = new PipelineManager();

        class P1 extends Pipeline { steps = ['a']; }
        class P2 extends Pipeline { steps = ['b']; }

        const p1 = new P1(); p1.name = 'p1';
        const p2 = new P2(); p2.name = 'p2';

        manager.add(p1);
        manager.add(p2);
        assert.equal(manager.list().length, 2, 'added 2');
        assert.ok(manager.get('p1'), 'get p1');
        assert.ok(manager.get('p2'), 'get p2');

        manager.remove('p1');
        assert.equal(manager.list().length, 1, 'removed 1');
        assert.ok(!manager.get('p1'), 'p1 gone');
    },

    async 'PipelineManager.run() runs pipeline by name'(assert: any) {
        const manager = new PipelineManager();

        class SimplePipeline extends Pipeline {
            steps = ['echo'];
        }

        const { fn } = mockDispatch({ echo: 'Echoed' });
        const pipeline = new SimplePipeline();
        pipeline.name = 'simple';
        pipeline._dispatchFn = fn;
        manager.add(pipeline);

        const result = await manager.run('simple', 'Hello');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(result.finalText, 'Echoed', 'correct final text');
    },

    async 'PipelineManager.run() throws on unknown pipeline'(assert: any) {
        const manager = new PipelineManager();
        let error = '';
        try {
            await manager.run('nonexistent', 'Test');
        } catch (err: any) {
            error = err.message;
        }
        assert.includes(error, 'Unknown pipeline', 'error on unknown');
    },

    async 'PipelineManager emits events'(assert: any) {
        const events: string[] = [];

        const manager = new PipelineManager();
        manager.on('started', () => events.push('started'));
        manager.on('step', () => events.push('step'));
        manager.on('done', () => events.push('done'));

        class EventPipeline extends Pipeline {
            steps = ['a', 'b'];
        }

        const { fn } = mockDispatch();
        const pipeline = new EventPipeline();
        pipeline.name = 'event-pipe';
        pipeline._dispatchFn = fn;
        manager.add(pipeline);

        await manager.run('event-pipe', 'Test');

        assert.ok(events.includes('started'), 'started emitted');
        // Each step emits 'running' + 'done' = 2 step events per step = 4 total
        assert.equal(events.filter(e => e === 'step').length, 4, 'step emitted per step (running + done)');
        assert.ok(events.includes('done'), 'done emitted');
    },

    async 'Pipeline with mixed string and PipelineStep steps'(assert: any) {
        class MixedPipeline extends Pipeline {
            steps: (string | PipelineStep)[] = [
                'agent-a',
                { agent: 'agent-b', message: (ctx) => `Custom: ${ctx.prev.text}` },
                'agent-c',
            ];
        }

        const { fn, calls } = mockDispatch({ 'agent-a': 'Output A' });
        const pipeline = new MixedPipeline();
        pipeline._dispatchFn = fn;
        pipeline.name = 'mixed';

        const result = await pipeline._run('Start');

        assert.ok(result.ok, 'mixed pipeline ok');
        assert.equal(calls.length, 3, '3 dispatches');
        assert.equal(calls[1].message, 'Custom: Output A', 'custom message builder used');
    },

    async 'Pipeline dispatch not wired throws'(assert: any) {
        class BrokenPipeline extends Pipeline {
            steps = ['a'];
        }

        const pipeline = new BrokenPipeline();
        pipeline.name = 'broken';
        // No _dispatchFn

        let error = '';
        try {
            await pipeline._run('Test');
        } catch (err: any) {
            error = err.message;
        }
        assert.includes(error, 'dispatch not wired', 'throws when not wired');
    },
};
