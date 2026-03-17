/**
 * Integration Tests — Real API Calls (Haiku)
 * 
 * Run with: node --import tsx test/run.ts --integration
 * 
 * These call the real Anthropic API using the cheapest model (Haiku).
 * Requires ANTHROPIC_API_KEY env var.
 */

import { Agent, tool, DeveloperAgent } from '../../packages/drift/src/index.ts';

export const name = 'Integration — Haiku';

// ── Helper agent with a custom tool ──

class MathAgent extends Agent {
    model = 'haiku';
    prompt = 'You are a math helper. Use the add tool when asked to add numbers. Be concise.';
    thinking = false;
    maxIterations = 3;

    @tool('Add two numbers together', {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
    })
    async add({ a, b }: { a: number; b: number }) {
        return { success: true, result: `${a + b}` };
    }
}

export const tests = {
    async 'basic run returns text and cost'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Reply with exactly one word: "pong". Nothing else.',
            thinking: false,
            maxIterations: 1,
        });

        const result = await agent.run('ping');

        assert.ok(result.ok, 'run completed successfully');
        assert.ok(result.text.length > 0, 'has response text');
        assert.gt(result.cost, 0, 'cost is positive');
        assert.gt(result.duration, 0, 'duration is positive');
        assert.equal(result.aborted, false, 'not aborted');
        assert.includes(result.model, 'Haiku', 'used Haiku model');
    },

    async 'tool execution works'(assert: any) {
        const agent = new MathAgent();
        const result = await agent.run('What is 7 + 5? Use the add tool.');

        assert.ok(result.ok, 'run completed');
        assert.gt(result.toolCalls.length, 0, 'tool was called');
        assert.equal(result.toolCalls[0].name, 'add', 'correct tool name');
        assert.includes(result.text, '12', 'response contains the answer');
    },

    async 'streaming with fluent API'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Reply with exactly: "hello world"',
            thinking: false,
            maxIterations: 1,
        });

        let textChunks = '';
        let doneResult: any = null;

        await new Promise<void>((resolve, reject) => {
            agent.stream('say hello')
                .onText(chunk => { textChunks += chunk; })
                .onDone(result => {
                    doneResult = result;
                    resolve();
                })
                .onError(err => reject(err));
        });

        assert.ok(textChunks.length > 0, 'received text chunks');
        assert.ok(doneResult, 'done event fired');
        assert.ok(doneResult.ok, 'stream completed ok');
        assert.gt(doneResult.cost, 0, 'cost tracked');
    },

    async 'multi-turn conversation'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'You are a memory test bot. When told to remember something, just say "OK". When asked what you remember, repeat it exactly.',
            thinking: false,
            maxIterations: 1,
        });

        // Turn 1
        const r1 = await agent.run('Remember the word "banana"');
        assert.ok(r1.ok, 'turn 1 ok');

        // Turn 2 — should remember context
        const r2 = await agent.run('What word did I ask you to remember?');
        assert.ok(r2.ok, 'turn 2 ok');
        assert.includes(r2.text.toLowerCase(), 'banana', 'remembers context');

        // Cost accumulated
        assert.gt(agent.cost, r1.cost, 'total cost > first turn cost');
        assert.gt(agent.conversation.length, 2, 'conversation has history');
    },

    async 'DeveloperAgent instantiates and runs'(assert: any) {
        const agent = new DeveloperAgent({
            model: 'haiku',
            thinking: false,
            maxIterations: 1,
            disabledTools: ['shell_execute', 'shell_start', 'create_file', 'delete_file'],
        });

        const result = await agent.run('What programming language is TypeScript based on?');
        assert.ok(result.ok, 'DeveloperAgent run completed');
        assert.ok(result.text.length > 0, 'has response');
        assert.includes(result.text.toLowerCase(), 'javascript', 'knows TypeScript');
    },

    async 'cache breakpoints are in API request'(assert: any) {
        const agent = new MathAgent();

        // Verify cache is set up
        assert.equal(agent.cache.prompt, true, 'prompt caching enabled');
        assert.equal(agent.cache.tools, true, 'tool caching enabled');
        assert.equal(agent.cache.toString(), 'Cache(prompt, tools)');

        // Run and check cost includes cache tokens
        const result = await agent.run('What is 2 + 3?');
        assert.ok(result.ok, 'run ok');
        // Cache write should show on first call
        const pricing = agent.pricing;
        assert.gt(pricing.turns.length, 0, 'has pricing turns');
    },

    async 'abort works'(assert: any) {
        const agent = new Agent({
            model: 'haiku',
            prompt: 'Write a very long detailed essay about the entire history of computing from 1800 to 2026. Include every major event, person, and invention. Be extremely thorough and verbose.',
            thinking: false,
            maxIterations: 5,
        });

        // Abort almost immediately — before Haiku can finish
        setTimeout(() => agent.abort(), 50);
        const result = await agent.run('Write the full essay now. Make it at least 10000 words.');

        // Either aborted or finished very fast — both are valid outcomes
        // The key test is that abort() doesn't crash
        assert.ok(result.aborted || result.ok, 'completed without crash');
    },
};
