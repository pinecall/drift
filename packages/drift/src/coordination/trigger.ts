/**
 * Drift — Trigger Base Class
 * 
 * Reactive rules engine for inter-agent coordination.
 * Triggers watch workspace/window changes and auto-dispatch agents.
 * 
 * Auto-discovered from `triggersDir` (like agents from `agentsDir`).
 * 
 * Two modes:
 * 
 * 1. Override mode — full control:
 * 
 *   class MyTrigger extends Trigger {
 *       watch = 'window' as const;
 *       cooldown = 15_000;
 *       condition(e) { return e.action === 'update' && e.item?.status === 'done'; }
 *       async run(e) { await this.dispatch('reviewer', `Review "${e.item.title}"`); }
 *   }
 * 
 * 2. StateMachine mode — declarative `field` + `on` handlers:
 * 
 *   class TaskLifecycle extends Trigger {
 *       watch = 'window' as const;
 *       cooldown = 10_000;
 *       field = 'status';
 *       on = {
 *           'done':  (e) => this.dispatch('reviewer', `Review "${e.item.title}"`),
 *           'doing': (e) => this.dispatch('task-agent', `Task started: "${e.item.title}"`),
 *       };
 *   }
 */

import { EventEmitter } from 'node:events';
import type { Window, WindowChangeEvent, WindowItem } from './window.ts';
import type { Workspace, WorkspaceChangeEvent } from './workspace.ts';

// ── Dispatch Types (shared with ws.ts) ──────────────

export interface DispatchResult {
    /** Final text response from the dispatched agent. */
    text: string;
    /** Total cost in USD. */
    cost: number;
    /** Tool calls made during the dispatch. */
    toolCalls: { name: string; params: any; result?: any }[];
    /** Session ID used for the dispatch. */
    sessionId: string;
    /** Whether the dispatch was aborted. */
    aborted: boolean;
}

export interface DispatchOptions {
    /** Reuse an existing session (default: auto-generated __dispatch__:agent:timestamp). */
    sessionId?: string;
    /** Don't broadcast events to UI (default: false). */
    silent?: boolean;
    /** Max execution time in ms (default: 120_000). */
    timeout?: number;
    /** Who triggered the dispatch (e.g. 'trigger:auto-review', 'agent:planner', 'ui'). */
    source?: string;
}

export type DispatchFn = (
    agentName: string,
    message: string,
    options?: DispatchOptions,
) => Promise<DispatchResult>;

// ── Trigger Base Class ──────────────────────────────

export class Trigger {
    /** Unique name. Defaults to kebab-case of class name (set by loadTriggers). */
    name?: string;

    /** What to observe: 'workspace' or 'window'. */
    watch: 'workspace' | 'window' = 'window';

    /** Cooldown in ms between firings (prevents spam). 0 = no cooldown. */
    cooldown: number = 0;

    /** Enable/disable this trigger. */
    enabled: boolean = true;

    // ── StateMachine mode ──

    /** Field to track for state transitions (used with `on`). */
    field?: string;

    /**
     * Declarative handlers keyed by new field value.
     * When `field` is set and a change event updates that field,
     * the handler matching the new value is called.
     */
    on?: Record<string, (event: any) => Promise<void> | void>;

    // ── Injected by server ──

    /** Shared workspace reference (injected by DriftServer). */
    workspace?: Workspace<any>;

    /** Shared window reference (injected by DriftServer). */
    window?: Window<any>;

    /** @internal — Dispatch function injected by server. */
    _dispatchFn?: DispatchFn;

    /** @internal — Timestamp of last firing. */
    _lastFired: number = 0;

    // ── Override these for full control ──

    /**
     * Condition to evaluate on each change event.
     * Return `true` to fire the trigger.
     * 
     * Default behavior (StateMachine mode):
     * Returns true if `event.action === 'update'` and `event.patch` contains `this.field`.
     */
    condition(event: WindowChangeEvent | WorkspaceChangeEvent): boolean {
        if (this.field && this.on) {
            // StateMachine mode: fire on update when field is in patch,
            // AND on add when the added item has the field set
            if (event.action === 'update' || event.action === 'setState') {
                if ('patch' in event && event.patch) return this.field in event.patch;
                return false;
            }
            if (event.action === 'add') {
                // New item added — check if the item has the field we're watching
                if ('item' in event && event.item) {
                    return this.field in event.item;
                }
                return false;
            }
            return false;
        }
        return false;
    }

    /**
     * Action to perform when the trigger fires.
     * 
     * Default behavior (StateMachine mode):
     * Looks up the new field value in `this.on` and calls the matching handler.
     */
    async run(event: any): Promise<void> {
        if (this.field && this.on) {
            // For window events: use item[field]
            // For workspace events: use state[field]
            const value = event.item?.[this.field] ?? event.state?.[this.field];
            const handler = this.on[value];
            if (handler) await handler.call(this, event);
        }
    }

    // ── API available to subclasses ──

    /**
     * Dispatch an agent to perform a task.
     * Available in `condition()`, `run()`, and `on` handlers.
     */
    protected dispatch(agent: string, message: string, options?: Partial<DispatchOptions>): Promise<DispatchResult> {
        if (!this._dispatchFn) throw new Error(`Trigger "${this.name}": dispatch not wired (trigger not attached to server)`);
        const name = this.name || this.constructor.name;
        return this._dispatchFn(agent, message, { source: `trigger:${name}`, ...options });
    }

    /** Read a workspace state value. */
    protected select<T = any>(key: string): T | undefined {
        return this.workspace?.state?.[key] as T | undefined;
    }

    // ── Internal evaluation ──

    /**
     * @internal — Called by TriggerManager on every change event.
     * Evaluates condition, respects cooldown, fires run().
     * Returns true if the trigger fired.
     */
    async _evaluate(source: 'workspace' | 'window', event: any): Promise<boolean> {
        if (!this.enabled) return false;
        if (this.watch !== source) return false;

        // Evaluate condition (catch errors to prevent one trigger breaking all)
        let match = false;
        try {
            match = this.condition(event);
        } catch {
            return false;
        }
        if (!match) return false;

        // Cooldown check
        if (this.cooldown > 0 && Date.now() - this._lastFired < this.cooldown) {
            return false;
        }

        // Fire!
        this._lastFired = Date.now();

        // Run async — don't block the event loop
        this.run(event).catch(err => {
            console.warn(`  ⚠ Trigger "${this.name}" error: ${err.message}`);
        });

        return true;
    }
}

// ── Trigger Manager ─────────────────────────────────

/**
 * Manages all triggers and evaluates them against change events.
 * Lives on the DriftServer, wired to workspace/window 'change' events.
 */
export class TriggerManager extends EventEmitter {
    private _triggers: Trigger[] = [];

    /** Add a trigger to the manager. */
    add(trigger: Trigger): void {
        // Prevent duplicate names
        const name = trigger.name || trigger.constructor.name;
        this._triggers = this._triggers.filter(t =>
            (t.name || t.constructor.name) !== name
        );
        this._triggers.push(trigger);
    }

    /** Remove a trigger by name. */
    remove(name: string): void {
        this._triggers = this._triggers.filter(t =>
            (t.name || t.constructor.name) !== name
        );
    }

    /** Enable a trigger by name. */
    enable(name: string): void {
        const trigger = this._find(name);
        if (trigger) trigger.enabled = true;
    }

    /** Disable a trigger by name. */
    disable(name: string): void {
        const trigger = this._find(name);
        if (trigger) trigger.enabled = false;
    }

    /** List all triggers. */
    list(): Trigger[] {
        return [...this._triggers];
    }

    /** Get a trigger by name. */
    get(name: string): Trigger | undefined {
        return this._find(name);
    }

    /**
     * Evaluate all triggers against a change event.
     * Called by the server when workspace or window emits 'change'.
     */
    async evaluate(source: 'workspace' | 'window', event: any): Promise<void> {
        for (const trigger of this._triggers) {
            try {
                const fired = await trigger._evaluate(source, event);
                if (fired) {
                    const name = trigger.name || trigger.constructor.name;
                    this.emit('fired', {
                        trigger: name,
                        source,
                        event,
                    });
                }
            } catch (err: any) {
                console.warn(`  ⚠ TriggerManager error evaluating "${trigger.name}": ${err.message}`);
            }
        }
    }

    private _find(name: string): Trigger | undefined {
        return this._triggers.find(t =>
            (t.name || t.constructor.name) === name
        );
    }
}
