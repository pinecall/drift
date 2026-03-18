/**
 * Unit Tests — Agent Subscribes (Blackboard pattern via Trigger)
 * 
 * Tests that agent.subscribes auto-generates Trigger instances
 * that dispatch the agent when subscribed workspace slices change.
 * 
 * No API calls — uses mock dispatch + Trigger._evaluate().
 */

import { Agent } from '../../packages/drift/src/core/agent.ts';
import { Trigger, TriggerManager } from '../../packages/drift/src/core/trigger.ts';
import { Workspace } from '../../packages/drift/src/core/workspace.ts';
import type { DispatchFn, DispatchResult } from '../../packages/drift/src/core/trigger.ts';
import type { WorkspaceChangeEvent } from '../../packages/drift/src/core/workspace.ts';

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
    sliceName: string,
    cooldown: number,
    dispatchFn: DispatchFn,
    workspace?: Workspace,
): Trigger {
    const trigger = new Trigger();
    trigger.name = `__subscribe__:${agentName}:${sliceName}`;
    trigger.watch = 'workspace';
    trigger.cooldown = cooldown;
    trigger.workspace = workspace;
    trigger._dispatchFn = dispatchFn;

    trigger.condition = (event: any) => {
        if (event.action === 'setSlice') return event.slice === sliceName;
        if (event.action === 'setState' && event.patch) return sliceName in event.patch;
        return false;
    };

    trigger.run = async (event: any) => {
        const value = event.state?.[sliceName];
        let message: string | null;

        if (agent.onSliceChange) {
            message = agent.onSliceChange(sliceName, value, event);
        } else {
            const preview = typeof value === 'string' ? value.slice(0, 500)
                : JSON.stringify(value, null, 2)?.slice(0, 500) || '';
            message = `Workspace slice "${sliceName}" was updated:\n\n${preview}`;
        }

        if (message !== null) {
            await dispatchFn(agentName, message, {
                source: `subscribe:${agentName}:${sliceName}`,
                silent: false,
            });
        }
    };

    return trigger;
}

// ── Tests ──

export const tests = {
    async 'Agent with subscribes triggers dispatch on slice change'(assert: any) {
        class MarketAgent extends Agent {
            model = 'haiku';
            subscribes = ['prices'];
        }

        const agent = new MarketAgent();
        const { fn, calls } = mockDispatch();
        const ws = new Workspace('test', { prices: { btc: 60000 }, signals: [] });

        const trigger = createSubscriptionTrigger('market', agent, 'prices', 0, fn, ws);

        // Simulate workspace change
        const event = {
            action: 'setSlice' as const,
            slice: 'prices',
            state: { prices: { btc: 67000 }, signals: [] },
            versions: { prices: 1, signals: 0 },
        };

        const fired = await trigger._evaluate('workspace', event);
        assert.ok(fired, 'trigger fired');

        // Wait for async dispatch
        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls.length, 1, 'dispatch called once');
        assert.equal(calls[0].agent, 'market', 'dispatched to correct agent');
        assert.includes(calls[0].message, 'prices', 'message mentions slice');
        assert.includes(calls[0].source!, 'subscribe:market:prices', 'source is correct');
    },

    async 'Agent subscribe ignores unrelated slices'(assert: any) {
        class MarketAgent extends Agent {
            model = 'haiku';
            subscribes = ['prices'];
        }

        const agent = new MarketAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('market', agent, 'prices', 0, fn);

        // Simulate change to 'signals' (not subscribed)
        const event = {
            action: 'setSlice' as const,
            slice: 'signals',
            state: { prices: {}, signals: ['BUY'] },
            versions: { prices: 0, signals: 1 },
        };

        const fired = await trigger._evaluate('workspace', event);
        assert.ok(!fired, 'trigger did not fire');
        assert.equal(calls.length, 0, 'no dispatch');
    },

    async 'Custom onSliceChange overrides message'(assert: any) {
        class ExecutorAgent extends Agent {
            model = 'haiku';
            subscribes = ['signals'];

            onSliceChange(slice: string, value: any): string | null {
                if (value?.action === 'BUY') {
                    return `Execute BUY for ${value.symbol}`;
                }
                return null;
            }
        }

        const agent = new ExecutorAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('executor', agent, 'signals', 0, fn);

        // Trigger with BUY signal
        const event = {
            action: 'setSlice' as const,
            slice: 'signals',
            state: { signals: { action: 'BUY', symbol: 'BTC' } },
            versions: { signals: 1 },
        };

        await trigger._evaluate('workspace', event);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls.length, 1, 'dispatch called');
        assert.equal(calls[0].message, 'Execute BUY for BTC', 'custom message used');
    },

    async 'onSliceChange returning null skips dispatch'(assert: any) {
        class FilterAgent extends Agent {
            model = 'haiku';
            subscribes = ['signals'];

            onSliceChange(): string | null {
                return null;  // always skip
            }
        }

        const agent = new FilterAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('filter', agent, 'signals', 0, fn);

        const event = {
            action: 'setSlice' as const,
            slice: 'signals',
            state: { signals: 'anything' },
            versions: { signals: 1 },
        };

        await trigger._evaluate('workspace', event);
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
            action: 'setSlice' as const,
            slice: 'data',
            state: { data: 'v1' },
            versions: { data: 1 },
        };

        // First fire
        const fired1 = await trigger._evaluate('workspace', event);
        assert.ok(fired1, 'first fire');

        // Second fire (within cooldown)
        const fired2 = await trigger._evaluate('workspace', { ...event, state: { data: 'v2' } });
        assert.ok(!fired2, 'blocked by cooldown');
    },

    async 'Per-slice cooldown config works'(assert: any) {
        class ConfigAgent extends Agent {
            model = 'haiku';
            subscribes = [
                { slice: 'fast', cooldown: 0 },
                { slice: 'slow', cooldown: 60_000 },
            ];
        }

        const agent = new ConfigAgent();
        const { fn: fn1, calls: calls1 } = mockDispatch();
        const { fn: fn2, calls: calls2 } = mockDispatch();

        const fastTrigger = createSubscriptionTrigger('test', agent, 'fast', 0, fn1);
        const slowTrigger = createSubscriptionTrigger('test', agent, 'slow', 60_000, fn2);

        const fastEvent = { action: 'setSlice' as const, slice: 'fast', state: { fast: 1 }, versions: { fast: 1 } };
        const slowEvent = { action: 'setSlice' as const, slice: 'slow', state: { slow: 1 }, versions: { slow: 1 } };

        // Fast can fire twice
        await fastTrigger._evaluate('workspace', fastEvent);
        await fastTrigger._evaluate('workspace', fastEvent);
        
        // Slow fires once, blocked second time
        await slowTrigger._evaluate('workspace', slowEvent);
        await slowTrigger._evaluate('workspace', slowEvent);

        await new Promise(r => setTimeout(r, 50));
        assert.equal(calls1.length, 2, 'fast fired twice');
        assert.equal(calls2.length, 1, 'slow fired once');
    },

    async 'setState triggers for subscribed slices in patch'(assert: any) {
        class PatchAgent extends Agent {
            model = 'haiku';
            subscribes = ['prices'];
        }

        const agent = new PatchAgent();
        const { fn, calls } = mockDispatch();
        const trigger = createSubscriptionTrigger('patch-test', agent, 'prices', 0, fn);

        // setState with patch containing 'prices'
        const event = {
            action: 'setState' as const,
            patch: { prices: { btc: 70000 } },
            state: { prices: { btc: 70000 }, signals: [] },
            versions: { prices: 2, signals: 0 },
        };

        const fired = await trigger._evaluate('workspace', event);
        assert.ok(fired, 'trigger fired on setState with matching patch');
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
        regularTrigger.watch = 'workspace';
        regularTrigger._dispatchFn = fn;
        regularTrigger.condition = (e: any) => e.action === 'setSlice' && e.slice === 'data';
        regularTrigger.run = async () => { await fn('regular-target', 'Regular trigger fired'); };

        const subTrigger = createSubscriptionTrigger('sub-agent', agent, 'data', 0, fn);

        const manager = new TriggerManager();
        manager.add(regularTrigger);
        manager.add(subTrigger);

        const event = {
            action: 'setSlice' as const,
            slice: 'data',
            state: { data: 'hello' },
            versions: { data: 1 },
        };

        await manager.evaluate('workspace', event);
        await new Promise(r => setTimeout(r, 50));

        // Both should fire
        assert.equal(calls.length, 2, 'both triggers dispatched');
    },

    async 'Trigger name follows __subscribe__:agent:slice pattern'(assert: any) {
        class NameAgent extends Agent {
            model = 'haiku';
            subscribes = ['metrics'];
        }

        const agent = new NameAgent();
        const { fn } = mockDispatch();
        const trigger = createSubscriptionTrigger('monitor', agent, 'metrics', 5000, fn);

        assert.equal(trigger.name, '__subscribe__:monitor:metrics', 'correct name');
        assert.equal(trigger.watch, 'workspace', 'watches workspace');
        assert.equal(trigger.cooldown, 5000, 'correct cooldown');
    },
};
