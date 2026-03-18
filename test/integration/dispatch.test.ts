/**
 * Integration Tests — Dispatch (Real API Calls)
 * 
 * Run with: npx tsx test/run.ts --integration
 * 
 * Tests dispatch end-to-end using real Haiku API calls.
 * Requires ANTHROPIC_API_KEY env var.
 */

import { Agent, tool, Trigger, TriggerManager } from '../../packages/drift/src/index.ts';
import type { DispatchFn, DispatchResult } from '../../packages/drift/src/index.ts';
import { Session } from '../../packages/drift/src/core/session.ts';

export const name = 'Integration — Dispatch';

// ── Helper agents ──

class PingAgent extends Agent {
    model = 'haiku';
    prompt = 'Reply with exactly one word: the word you received in the message, but in ALL CAPS. Nothing else.';
    thinking = false;
    maxIterations = 1;
}

class MathAgent extends Agent {
    model = 'haiku';
    prompt = 'You are a math helper. Use the add tool when asked to add numbers. Reply concisely with just the result.';
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

class DispatcherAgent extends Agent {
    model = 'haiku';
    prompt = `You can dispatch other agents using the dispatch_agent tool.
When asked to delegate a task, use dispatch_agent with the agent name and a clear message.
Be concise in your response — just report what happened with the dispatch.`;
    thinking = false;
    maxIterations = 5;
    canDispatch = true;
}

// ── Real dispatch function (creates sessions, runs agents) ──

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
    async 'dispatch() creates session, runs agent, returns text result'(assert: any) {
        const agentMap = new Map<string, Agent>([
            ['ping', new PingAgent()],
        ]);
        const dispatch = createRealDispatch(agentMap);

        const result = await dispatch('ping', 'hello');

        assert.ok(result.text.length > 0, 'has response text');
        assert.includes(result.text.toUpperCase(), 'HELLO', 'response is the word in caps');
        assert.gt(result.cost, 0, 'cost is positive');
        assert.ok(result.sessionId.startsWith('__dispatch__:'), 'dispatch session ID prefix');
        assert.equal(result.aborted, false, 'not aborted');
    },

    async 'dispatch() with tool-using agent'(assert: any) {
        const agentMap = new Map<string, Agent>([
            ['math', new MathAgent()],
        ]);
        const dispatch = createRealDispatch(agentMap);

        const result = await dispatch('math', 'What is 7 + 5? Use the add tool.');

        assert.ok(result.text.length > 0, 'has response');
        assert.includes(result.text, '12', 'response contains the answer');
        assert.gt(result.toolCalls.length, 0, 'tool was called');
        assert.equal(result.toolCalls[0].name, 'add', 'correct tool name');
    },

    async 'dispatch() throws on unknown agent'(assert: any) {
        const dispatch = createRealDispatch(new Map());
        let error = '';
        try {
            await dispatch('nonexistent', 'hello');
        } catch (err: any) {
            error = err.message;
        }
        assert.includes(error, 'Unknown agent', 'throws on unknown agent');
    },

    async 'canDispatch agent uses dispatch_agent tool'(assert: any) {
        const ping = new PingAgent();
        const dispatcher = new DispatcherAgent();

        const agentMap = new Map<string, Agent>([
            ['ping', ping],
            ['dispatcher', dispatcher],
        ]);

        const dispatch = createRealDispatch(agentMap);
        dispatcher._dispatchFn = dispatch;

        // The dispatcher agent should use dispatch_agent tool to delegate to ping
        const session = new Session(dispatcher, { id: 'test-dispatch' });
        const result = await session.run('Please dispatch the "ping" agent with the message "world"', { timeout: 30_000 });

        assert.ok(result.ok, 'dispatcher run completed');
        assert.gt(result.toolCalls.length, 0, 'tools were used');
        // The dispatch_agent tool should have been called
        const dispatchCall = result.toolCalls.find(tc => tc.name === 'dispatch_agent');
        assert.ok(dispatchCall, 'dispatch_agent tool was called');
        assert.equal(dispatchCall?.input?.agent, 'ping', 'dispatched to ping agent');
    },

    async 'Trigger + dispatch integration'(assert: any) {
        const dispatched: { agent: string; message: string }[] = [];

        // Create a trigger that dispatches on status=done
        class ReviewTrigger extends Trigger {
            watch = 'window' as const;
            field = 'status';
            on = {
                'done': async (event: any) => {
                    dispatched.push({ agent: 'reviewer', message: `Review ${event.item.title}` });
                    await this.dispatch('reviewer', `Review ${event.item.title}`);
                },
            };
        }

        // Mock dispatch for this test (don't need real API)
        const mockDispatch: DispatchFn = async (agent, message) => ({
            text: `reviewed`, cost: 0, toolCalls: [], sessionId: '__mock__', aborted: false,
        });

        const trigger = new ReviewTrigger();
        trigger.name = 'review-trigger';
        trigger._dispatchFn = mockDispatch;

        const manager = new TriggerManager();
        manager.add(trigger);

        // Simulate a window change event
        await manager.evaluate('window', {
            action: 'update',
            item: { id: 'task-1', status: 'done', title: 'Implement auth' },
            patch: { status: 'done' },
            items: [], state: {},
        });

        // Wait for async trigger
        await new Promise(r => setTimeout(r, 50));

        assert.equal(dispatched.length, 1, 'trigger dispatched');
        assert.equal(dispatched[0].agent, 'reviewer', 'dispatched correct agent');
        assert.includes(dispatched[0].message, 'Implement auth', 'message includes task title');
    },
};
