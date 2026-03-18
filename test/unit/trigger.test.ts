/**
 * Unit Tests — Trigger + TriggerManager
 * 
 * Tests the Trigger base class (condition/cooldown/StateMachine mode)
 * and TriggerManager (evaluate/add/remove/enable/disable).
 * 
 * No API calls — pure logic tests.
 */

import { Trigger, TriggerManager } from '../../packages/drift/src/core/trigger.ts';
import type { DispatchResult, DispatchFn } from '../../packages/drift/src/core/trigger.ts';

export const name = 'Trigger';

// ── Helpers ──

function mockDispatch(): { fn: DispatchFn; calls: { agent: string; message: string }[] } {
    const calls: { agent: string; message: string }[] = [];
    const fn: DispatchFn = async (agent, message) => {
        calls.push({ agent, message });
        return { text: `dispatched ${agent}`, cost: 0.001, toolCalls: [], sessionId: `__dispatch__:${agent}`, aborted: false };
    };
    return { fn, calls };
}

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Tests ──

export const tests = {
    async 'Trigger._evaluate fires when condition matches'(assert: any) {
        class TestTrigger extends Trigger {
            watch = 'window' as const;
            condition(e: any) { return e.action === 'update' && e.item?.status === 'done'; }
            async run(e: any) { await this.dispatch('reviewer', `Review ${e.item.title}`); }
        }

        const { fn, calls } = mockDispatch();
        const trigger = new TestTrigger();
        trigger._dispatchFn = fn;
        trigger.name = 'test';

        const fired = await trigger._evaluate('window', {
            action: 'update',
            item: { id: '1', status: 'done', title: 'Test Task' },
            patch: { status: 'done' },
            items: [], state: {},
        });

        assert.ok(fired, 'trigger should fire');
        // Wait for async run()
        await sleep(10);
        assert.equal(calls.length, 1, 'dispatch called once');
        assert.equal(calls[0].agent, 'reviewer', 'dispatched reviewer');
        assert.includes(calls[0].message, 'Test Task', 'message includes task title');
    },

    async 'Trigger._evaluate respects cooldown'(assert: any) {
        class CooldownTrigger extends Trigger {
            watch = 'window' as const;
            cooldown = 1000;
            condition() { return true; }
            async run() { await this.dispatch('agent', 'test'); }
        }

        const { fn, calls } = mockDispatch();
        const trigger = new CooldownTrigger();
        trigger._dispatchFn = fn;
        trigger.name = 'cooldown-test';

        const event = { action: 'update', items: [], state: {} };

        // First fire should work
        const fired1 = await trigger._evaluate('window', event);
        assert.ok(fired1, 'first fire ok');

        // Second fire should be blocked by cooldown
        const fired2 = await trigger._evaluate('window', event);
        assert.ok(!fired2, 'second fire blocked by cooldown');

        await sleep(10);
        assert.equal(calls.length, 1, 'only one dispatch call');
    },

    async 'Trigger._evaluate skips when disabled'(assert: any) {
        class DisabledTrigger extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
        }

        const trigger = new DisabledTrigger();
        trigger.enabled = false;

        const fired = await trigger._evaluate('window', { action: 'update', items: [], state: {} });
        assert.ok(!fired, 'disabled trigger should not fire');
    },

    async 'Trigger._evaluate skips wrong watch source'(assert: any) {
        class WindowTrigger extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
        }

        const trigger = new WindowTrigger();
        const fired = await trigger._evaluate('workspace', { action: 'update', items: [], state: {} });
        assert.ok(!fired, 'window trigger should not fire on workspace event');
    },

    async 'StateMachine mode: on() handlers fire for matching field value'(assert: any) {
        const dispatched: string[] = [];

        class StateTrigger extends Trigger {
            watch = 'window' as const;
            field = 'status';
            on = {
                'done': async (e: any) => {
                    dispatched.push('done');
                    await this.dispatch('reviewer', 'Review task');
                },
                'doing': async (e: any) => {
                    dispatched.push('doing');
                },
            };
        }

        const { fn, calls } = mockDispatch();
        const trigger = new StateTrigger();
        trigger._dispatchFn = fn;
        trigger.name = 'state-test';

        // Fire with status=done
        const fired = await trigger._evaluate('window', {
            action: 'update',
            item: { id: '1', status: 'done' },
            patch: { status: 'done' },
            items: [], state: {},
        });

        assert.ok(fired, 'trigger fired');
        await sleep(10);
        assert.equal(dispatched.length, 1, 'one handler called');
        assert.equal(dispatched[0], 'done', 'done handler fire');
        assert.equal(calls.length, 1, 'dispatch called');
    },

    async 'StateMachine mode: condition auto-checks field in patch'(assert: any) {
        class FieldTrigger extends Trigger {
            watch = 'window' as const;
            field = 'status';
            on = { 'done': () => {} };
        }

        const trigger = new FieldTrigger();

        // Event with matching field in patch → should match
        const match = trigger.condition({
            action: 'update' as any,
            patch: { status: 'done' },
            items: [], state: {},
        } as any);
        assert.ok(match, 'condition matches when field is in patch');

        // Event without field in patch → should not match
        const noMatch = trigger.condition({
            action: 'update' as any,
            patch: { title: 'new title' },
            items: [], state: {},
        } as any);
        assert.ok(!noMatch, 'condition does not match when field not in patch');
    },

    async 'TriggerManager.evaluate runs all triggers'(assert: any) {
        let trigger1Fired = false;
        let trigger2Fired = false;

        class T1 extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
            async run() { trigger1Fired = true; }
        }
        class T2 extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
            async run() { trigger2Fired = true; }
        }

        const manager = new TriggerManager();
        const t1 = new T1(); t1.name = 'trigger-1';
        const t2 = new T2(); t2.name = 'trigger-2';
        manager.add(t1);
        manager.add(t2);

        await manager.evaluate('window', { action: 'update', items: [], state: {} });
        await sleep(10);

        assert.ok(trigger1Fired, 'trigger 1 fired');
        assert.ok(trigger2Fired, 'trigger 2 fired');
    },

    async 'TriggerManager.add/remove/enable/disable'(assert: any) {
        const manager = new TriggerManager();

        class TestTrigger extends Trigger {
            watch = 'window' as const;
        }

        const trigger = new TestTrigger();
        trigger.name = 'test-trigger';

        manager.add(trigger);
        assert.equal(manager.list().length, 1, 'added');

        manager.disable('test-trigger');
        assert.ok(!manager.get('test-trigger')?.enabled, 'disabled');

        manager.enable('test-trigger');
        assert.ok(manager.get('test-trigger')?.enabled, 'enabled');

        manager.remove('test-trigger');
        assert.equal(manager.list().length, 0, 'removed');
    },

    async 'TriggerManager emits fired event'(assert: any) {
        let firedEvent: any = null;

        class FireTrigger extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
            async run() { /* no-op */ }
        }

        const manager = new TriggerManager();
        const trigger = new FireTrigger();
        trigger.name = 'fire-test';
        manager.add(trigger);

        manager.on('fired', (data) => { firedEvent = data; });

        await manager.evaluate('window', { action: 'update', items: [], state: {} });

        assert.ok(firedEvent, 'fired event emitted');
        assert.equal(firedEvent.trigger, 'fire-test', 'correct trigger name');
        assert.equal(firedEvent.source, 'window', 'correct source');
    },

    async 'Trigger.dispatch throws when not wired'(assert: any) {
        class BrokenTrigger extends Trigger {
            watch = 'window' as const;
            condition() { return true; }
            async run() { await this.dispatch('agent', 'msg'); }
        }

        const trigger = new BrokenTrigger();
        trigger.name = 'broken';
        // No _dispatchFn set

        const fired = await trigger._evaluate('window', { action: 'update', items: [], state: {} });
        assert.ok(fired, 'trigger fires');
        // Error is caught internally by _evaluate (async run, no throw to caller)
        await sleep(10);
    },

    async 'Trigger condition error does not crash evaluation'(assert: any) {
        class ErrorTrigger extends Trigger {
            watch = 'window' as const;
            condition() { throw new Error('boom'); }
        }

        const trigger = new ErrorTrigger();
        trigger.name = 'error-test';

        const fired = await trigger._evaluate('window', { action: 'update', items: [], state: {} });
        assert.ok(!fired, 'trigger does not fire on error');
    },

    async 'TriggerManager prevents duplicate names'(assert: any) {
        const manager = new TriggerManager();

        class T1 extends Trigger { watch = 'window' as const; }
        class T2 extends Trigger { watch = 'workspace' as const; }

        const t1 = new T1(); t1.name = 'same-name';
        const t2 = new T2(); t2.name = 'same-name';

        manager.add(t1);
        manager.add(t2);

        assert.equal(manager.list().length, 1, 'only one trigger with same name');
        assert.equal(manager.get('same-name')?.watch, 'workspace', 'latest wins');
    },
};
