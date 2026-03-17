/**
 * Integration Tests — Streaming (Haiku)
 * 
 * Run with: node --import tsx test/run.ts --integration
 * 
 * Tests streaming-specific features with real API calls.
 */

import { Agent, tool } from '../../packages/drift/src/index.ts';

export const name = 'Integration — Streaming';

class WikiAgent extends Agent {
    model = 'haiku';
    prompt = 'You are a wiki bot. Use the lookup tool when asked about topics. Be concise.';
    thinking = false;
    maxIterations = 3;

    @tool('Look up a topic', {
        topic: { type: 'string', description: 'Topic to look up' },
    })
    async lookup({ topic }: { topic: string }) {
        const facts: Record<string, string> = {
            typescript: 'TypeScript is a typed superset of JavaScript developed by Microsoft.',
            node: 'Node.js is a JavaScript runtime built on V8.',
        };
        return {
            success: true,
            result: facts[topic.toLowerCase()] || `${topic}: no data found`,
        };
    }
}

export const tests = {
    async 'stream emits text chunks'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Say "hello world" and nothing else.',
            thinking: false,
            maxIterations: 1,
        });

        const chunks: string[] = [];

        await new Promise<void>((resolve, reject) => {
            agent.stream('go')
                .onText(chunk => chunks.push(chunk))
                .onDone(() => resolve())
                .onError(reject);
        });

        assert.gt(chunks.length, 0, 'received multiple text chunks');
        const fullText = chunks.join('');
        assert.ok(fullText.length > 0, 'text is non-empty');
    },

    async 'stream emits tool events'(assert: any) {
        const agent = new WikiAgent();
        const toolEvents: any[] = [];
        const toolResults: any[] = [];

        await new Promise<void>((resolve, reject) => {
            agent.stream('Look up TypeScript')
                .onTool(info => toolEvents.push(info))
                .onToolResult(info => toolResults.push(info))
                .onDone(() => resolve())
                .onError(reject);
        });

        assert.gt(toolEvents.length, 0, 'tool event emitted');
        assert.equal(toolEvents[0].name, 'lookup', 'correct tool');
        assert.gt(toolResults.length, 0, 'tool result emitted');
        assert.gte(toolResults[0].ms, 0, 'ms is non-negative');
    },

    async 'stream emits cost events'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Reply with one word.',
            thinking: false,
            maxIterations: 1,
        });

        let costEvent: any = null;

        await new Promise<void>((resolve, reject) => {
            agent.stream('hi')
                .onCost(info => { costEvent = info; })
                .onDone(() => resolve())
                .onError(reject);
        });

        assert.ok(costEvent, 'cost event fired');
        assert.gt(costEvent.total, 0, 'total cost > 0');
    },

    async 'stream done result has all fields'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Reply briefly.',
            thinking: false,
            maxIterations: 1,
        });

        let result: any = null;

        await new Promise<void>((resolve, reject) => {
            agent.stream('hello')
                .onDone(r => { result = r; resolve(); })
                .onError(reject);
        });

        assert.ok(result, 'got result');
        assert.ok(result.ok, 'ok is true');
        assert.ok(result.text, 'has text');
        assert.gt(result.cost, 0, 'cost > 0');
        assert.gt(result.duration, 0, 'duration > 0');
        assert.includes(result.model, 'Haiku', 'model name');
        assert.ok(Array.isArray(result.toolCalls), 'has toolCalls array');
    },
};
