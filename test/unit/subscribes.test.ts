/**
 * Unit Tests — Agent Subscribes (Blackboard pattern via Trigger)
 * 
 * Tests that agent.subscribes auto-generates Trigger instances
 * that dispatch the agent when subscribed workspace windows change.
 * 
 * No API calls — uses mock dispatch + Trigger._evaluate().
 */

import { Agent } from '../../packages/drift/src/core/agent.ts';
import { Trigger, TriggerManager } from '../../packages/drift/src/coordination/trigger.ts';
import { Workspace } from '../../packages/drift/src/state/workspace.ts';
import { Window } from '../../packages/drift/src/state/window.ts';
import type { DispatchFn, DispatchResult } from '../../packages/drift/src/coordination/trigger.ts';

export const name = 'Agent Subscribes (Blackboard)';

// ── Helpers ──

function mockDispatch(): { fn: DispatchFn; calls: { agent: string; message: string; source?: string }[] } {
    const calls: { agent: string; message: string; source?: string }[] = [];
    const fn: DispatchFn = async (agent, message, opts) => {
        calls.push({ agent, message, source: opts?.source });
        return { text: `OK from ${agent}`, cost: 0.001, toolCalls: [], sessionId: `__dispatch__:${agent}`, aborted: false };
    };
    return { fn, calls };
}

/** Simulates what server/index.ts does: create a trigger from agent.subscribes */
function createSubscriptionTrigger(
    agentName: string,
    agent: Agent,
    windowName: string,
    cooldown: number,
    dispatchFn: DispatchFn,
    workspace?: Workspace,
): Trigger {
    const trigger = new Trigger();
    trigger.name = `__subscribe__:${agentName}:${windowName}`;
    trigger.watch = 'window';
    trigger.cooldown = cooldown;
    trigger.workspace = workspace;
    trigger._dispatchFn = dispatchFn;

    trigger.condition = (event: any) => {
        return event.windowName === windowName || event.name === windowName;
    };

    trigger.run = async (event: any) => {
        let message: string | null;

        if (agent.onWindowChange) {
            message = agent.onWindowChange(windowName, event);
        } else {
            const preview = JSON.stringify(event, null, 2)?.slice(0, 500) || '';
            message = `Window "${windowName}" was updated:\n\n${preview}`;
        }

        if (message !== null) {
            await dispatchFn(agentName, message, {
                source: `subscribe:${agentName}:${windowName}`,
                silent: false,
            });
        }
    };

    return trigger;
}

// ── Tests ──

export const tests = {
    async 'Agent with subscribes triggers dispatch on window change'(assert: any) {
        class MarketAgent extends Agent {
            model = 'haiku';
            subscribes = ['prices'];
        }

        const agent = new MarketAgent();
        const { fn, calls } = mockDispatch();
        const ws = new Workspace('test', { counter: 0 });
        const pricesWindow = new Window();
        ws.addWindow('prices', pricesWindow);

        const trigger = createSubscriptionTrigger('market', agent, 'prices', 0, fn, ws);

        // Simulate window change event
        const event = {
            windowName: 'prices',
            action: 'add',
            items: [{ id: 'btc', price: 67000 }],
            state: {},
        };

        const fired = await trigger._evaluate('window', event);
        assert.ok(fired, 'trigger fired');

        // Wait for async dispatch
        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls.length, 1, 'dispatch called once');
        assert.equal(calls[0].agent, 'market', 'dispatched to correct agent');
        assert.includes(calls[0].message, 'prices', 'message mentions window');
        assert.includes(calls[0].source!, 'subscribe:market:prices', 'source is correct');
    },

    async 'Agent subscribe ignores unrelated windows'(assert: any) {
        class MarketAgent extends Agent {
            model = 'haiku';
            subscribes = ['prices'];
        }

        const agent = new MarketAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('market', agent, 'prices', 0, fn);

        // Simulate change to 'signals' window (not subscribed)
        const event = {
            windowName: 'signals',
            action: 'add',
            items: [{ id: 'signal1' }],
            state: {},
        };

        const fired = await trigger._evaluate('window', event);
        assert.ok(!fired, 'trigger did not fire');
        assert.equal(calls.length, 0, 'no dispatch');
    },

    async 'Custom onWindowChange overrides message'(assert: any) {
        class ExecutorAgent extends Agent {
            model = 'haiku';
            subscribes = ['signals'];

            onWindowChange(windowName: string, event: any): string | null {
                if (event.items?.[0]?.action === 'BUY') {
                    return `Execute BUY for ${event.items[0].symbol}`;
                }
                return null;
            }
        }

        const agent = new ExecutorAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('executor', agent, 'signals', 0, fn);

        // Trigger with BUY signal
        const event = {
            windowName: 'signals',
            action: 'add',
            items: [{ id: 's1', action: 'BUY', symbol: 'BTC' }],
            state: {},
        };

        await trigger._evaluate('window', event);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls.length, 1, 'dispatch called');
        assert.equal(calls[0].message, 'Execute BUY for BTC', 'custom message used');
    },

    async 'onWindowChange returning null skips dispatch'(assert: any) {
        class FilterAgent extends Agent {
            model = 'haiku';
            subscribes = ['signals'];

            onWindowChange(): string | null {
                return null;  // always skip
            }
        }

        const agent = new FilterAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('filter', agent, 'signals', 0, fn);

        const event = {
            windowName: 'signals',
            action: 'add',
            items: [],
            state: {},
        };

        await trigger._evaluate('window', event);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls.length, 0, 'dispatch skipped');
    },

    async 'Cooldown prevents rapid re-dispatch'(assert: any) {
        class CooldownAgent extends Agent {
            model = 'haiku';
            subscribes = ['data'];
            subscribeCooldown = 60_000;  // 60s
        }

        const agent = new CooldownAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('test', agent, 'data', 60_000, fn);

        const event = {
            windowName: 'data',
            action: 'add',
            items: [{ id: 'v1' }],
            state: {},
        };

        // First fire
        const fired1 = await trigger._evaluate('window', event);
        assert.ok(fired1, 'first fire');

        // Second fire (within cooldown)
        const fired2 = await trigger._evaluate('window', { ...event, items: [{ id: 'v2' }] });
        assert.ok(!fired2, 'blocked by cooldown');
    },

    async 'Per-window cooldown config works'(assert: any) {
        class ConfigAgent extends Agent {
            model = 'haiku';
            subscribes = [
                { window: 'fast', cooldown: 0 },
                { window: 'slow', cooldown: 60_000 },
            ];
        }

        const agent = new ConfigAgent();
        const { fn: fn1, calls: calls1 } = mockDispatch();
        const { fn: fn2, calls: calls2 } = mockDispatch();

        const fastTrigger = createSubscriptionTrigger('test', agent, 'fast', 0, fn1);
        const slowTrigger = createSubscriptionTrigger('test', agent, 'slow', 60_000, fn2);

        const fastEvent = { windowName: 'fast', action: 'add', items: [{ id: '1' }], state: {} };
        const slowEvent = { windowName: 'slow', action: 'add', items: [{ id: '1' }], state: {} };

        // Fast can fire twice
        await fastTrigger._evaluate('window', fastEvent);
        await fastTrigger._evaluate('window', fastEvent);
        
        // Slow fires once, blocked second time
        await slowTrigger._evaluate('window', slowEvent);
        await slowTrigger._evaluate('window', slowEvent);

        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls1.length, 2, 'fast fired twice');
        assert.equal(calls2.length, 1, 'slow fired once');
    },

    async 'TriggerManager evaluates subscription triggers alongside regular triggers'(assert: any) {
        class SubAgent extends Agent {
            model = 'haiku';
            subscribes = ['data'];
        }

        const agent = new SubAgent();
        const { fn, calls } = mockDispatch();

        // Create both a regular trigger and a subscription trigger
        const regularTrigger = new Trigger();
        regularTrigger.name = 'regular';
        regularTrigger.watch = 'window';
        regularTrigger._dispatchFn = fn;
        regularTrigger.condition = (e: any) => e.windowName === 'data';
        regularTrigger.run = async () => { await fn('regular-target', 'Regular trigger fired'); };

        const subTrigger = createSubscriptionTrigger('sub-agent', agent, 'data', 0, fn);

        const manager = new TriggerManager();
        manager.add(regularTrigger);
        manager.add(subTrigger);

        const event = {
            windowName: 'data',
            action: 'add',
            items: [{ id: 'hello' }],
            state: {},
        };

        await manager.evaluate('window', event);
        await new Promise(r => setTimeout(r, 50));

        // Both should fire
        assert.equal(calls.length, 2, 'both triggers dispatched');
    },

    async 'Trigger name follows __subscribe__:agent:window pattern'(assert: any) {
        class NameAgent extends Agent {
            model = 'haiku';
            subscribes = ['metrics'];
        }

        const agent = new NameAgent();
        const { fn } = mockDispatch();
        const trigger = createSubscriptionTrigger('monitor', agent, 'metrics', 5000, fn);

        assert.equal(trigger.name, '__subscribe__:monitor:metrics', 'correct name');
        assert.equal(trigger.watch, 'window', 'watches window');
        assert.equal(trigger.cooldown, 5000, 'correct cooldown');
    },
};
