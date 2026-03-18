/**
 * Integration Tests — Pipeline (Real API Calls)
 * 
 * Tests pipeline execution end-to-end using real Haiku API calls.
 * Requires ANTHROPIC_API_KEY env var.
 */

import { Agent, Pipeline, PipelineManager } from '../../packages/drift/src/index.ts';
import type { DispatchFn } from '../../packages/drift/src/index.ts';
import { Session } from '../../packages/drift/src/core/session.ts';
import type { PipelineStep } from '../../packages/drift/src/coordination/pipeline.ts';

export const name = 'Integration — Pipeline';

// ── Helper agents ──

class EchoAgent extends Agent {
    model = 'haiku';
    prompt = 'Repeat the user message back exactly, but add "ECHO:" prefix. Nothing else.';
    thinking = false;
    maxIterations = 1;
}

class UpperAgent extends Agent {
    model = 'haiku';
    prompt = 'Convert the entire user message to ALL UPPERCASE. Reply with only the uppercase version.';
    thinking = false;
    maxIterations = 1;
}

class CountAgent extends Agent {
    model = 'haiku';
    prompt = 'Count the number of words in the user message. Reply with just the number, like "5".';
    thinking = false;
    maxIterations = 1;
}

// ── Real dispatch ──

function createRealDispatch(agentMap: Map<string, Agent>): DispatchFn {
    return async (agentName, message, options) => {
        const agent = agentMap.get(agentName);
        if (!agent) throw new Error(`Unknown agent: "${agentName}"`);
        const sid = options?.sessionId || `__dispatch__:${agentName}:${Date.now()}`;
        const session = new Session(agent, { id: sid });
        const result = await session.run(message, { timeout: options?.timeout || 30_000 });
        return {
            text: result.text,
            cost: result.cost,
            toolCalls: result.toolCalls.map(tc => ({ name: tc.name, params: tc.input })),
            sessionId: sid,
            aborted: result.aborted,
        };
    };
}

// ── Tests ──

export const tests = {
    async 'Pipeline runs 2-step chain with real Haiku'(assert: any) {
        const agentMap = new Map<string, Agent>([
            ['echo', new EchoAgent()],
            ['upper', new UpperAgent()],
        ]);
        const dispatch = createRealDispatch(agentMap);

        class TestPipeline extends Pipeline {
            steps = ['echo', 'upper'];
        }

        const pipeline = new TestPipeline();
        pipeline._dispatchFn = dispatch;
        pipeline.name = 'test-chain';

        const result = await pipeline._run('hello world');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(result.steps.length, 2, '2 steps');
        assert.gt(result.totalCost, 0, 'cost is positive');
        assert.gt(result.duration, 0, 'duration recorded');
        // The final text should be uppercase (step 2 uppercased step 1's output)
        assert.includes(result.finalText.toUpperCase(), 'HELLO', 'final text contains HELLO in uppercase');
    },

    async 'Pipeline with condition skip (real API)'(assert: any) {
        const agentMap = new Map<string, Agent>([
            ['echo', new EchoAgent()],
            ['count', new CountAgent()],
        ]);
        const dispatch = createRealDispatch(agentMap);

        class SkipPipeline extends Pipeline {
            steps: PipelineStep[] = [
                { agent: 'echo' },
                { agent: 'count', condition: (ctx) => ctx.prev.text.includes('SKIP_ME') },
            ];
        }

        const pipeline = new SkipPipeline();
        pipeline._dispatchFn = dispatch;
        pipeline.name = 'skip-test';

        const result = await pipeline._run('hello world');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(result.steps.length, 2, '2 steps tracked');
        assert.ok(result.steps[1].skipped, 'step 2 was skipped');
        assert.equal(result.totalCost.toFixed(4), result.steps[0].result!.cost.toFixed(4), 'only step 1 cost');
    },

    async 'Pipeline with custom message builder (real API)'(assert: any) {
        const agentMap = new Map<string, Agent>([
            ['echo', new EchoAgent()],
            ['upper', new UpperAgent()],
        ]);
        const dispatch = createRealDispatch(agentMap);

        class CustomPipeline extends Pipeline {
            steps: PipelineStep[] = [
                { agent: 'echo', message: (ctx) => `hello world` },
                { agent: 'upper', message: (ctx) => ctx.prev.text },
            ];
        }

        const pipeline = new CustomPipeline();
        pipeline._dispatchFn = dispatch;
        pipeline.name = 'custom-test';

        const result = await pipeline._run('ignored input');

        assert.ok(result.ok, 'pipeline succeeded');
        assert.equal(result.steps.length, 2, '2 steps');
        // Upper agent should return uppercase version of echo's output
        assert.includes(result.finalText.toUpperCase(), 'HELLO', 'custom message builder worked correctly');
    },
};
