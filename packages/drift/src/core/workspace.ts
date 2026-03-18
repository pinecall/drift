/**
 * Drift — Workspace<S>
 * 
 * Shared reactive state container for multi-agent collaboration.
 * Unlike Window (items + state per-agent), Workspace is a single
 * flat state object shared across ALL agents in the server.
 * 
 * Top-level keys are "slices" — each agent can read/write any slice,
 * and declare which slices it sees in its system prompt via `workspaceSlices`.
 * 
 * Inspired by Ruflo's shared_state pattern:
 *   - Per-slice optimistic versioning (prevents concurrent write conflicts)
 *   - structuredClone on reads (prevents accidental mutation)
 *   - Change events for real-time UI sync
 *   - Serialization for persistence
 * 
 *   const ws = new Workspace('terminal', { market: {}, signals: [] });
 *   ws.setSlice('market', { btc: 67000 });  // bumps version
 *   ws.select('market');  // returns deep copy, safe to mutate
 */

import { EventEmitter } from 'node:events';

// ── Types ───────────────────────────────────────────

export type WorkspaceAction = 'setState' | 'setSlice' | 'sync';

export interface WorkspaceChangeEvent<S = any> {
    action: WorkspaceAction;
    /** Which slice changed (for setSlice) */
    slice?: string;
    /** Current full state snapshot */
    state: S;
    /** Patch applied (for setState) */
    patch?: Partial<S>;
    /** Version of the changed slice */
    version?: number;
    /** All current versions */
    versions: Record<string, number>;
}

// ── Workspace<S> ────────────────────────────────────

export class Workspace<S extends Record<string, any> = Record<string, any>> extends EventEmitter {
    private _state: S;
    private _versions: Record<string, number>;
    private _name: string;

    constructor(name: string, initialState: S) {
        super();
        this._name = name;
        this._state = initialState;

        // Initialize version counters for each slice
        this._versions = {} as Record<string, number>;
        for (const key of Object.keys(initialState)) {
            this._versions[key] = 0;
        }
    }

    // ── Identity ───────────────────────────────────

    /** Workspace name (used as persistence key). */
    get name(): string {
        return this._name;
    }

    // ── Read ───────────────────────────────────────

    /** Full state (readonly reference — use select() for safe copies). */
    get state(): Readonly<S> {
        return this._state;
    }

    /**
     * Read a single slice by key. Returns a deep copy (structuredClone)
     * so callers can't accidentally mutate internal state.
     */
    select<K extends keyof S>(key: K): S[K] {
        return structuredClone(this._state[key]);
    }

    /** Current version of a slice. */
    version<K extends keyof S>(key: K): number {
        return this._versions[key as string] ?? 0;
    }

    /** All current versions. */
    get versions(): Readonly<Record<string, number>> {
        return { ...this._versions };
    }

    // ── Write ──────────────────────────────────────

    /**
     * Shallow merge into state (like React setState).
     * Bumps version for each changed key.
     */
    setState(patch: Partial<S>): void {
        for (const key of Object.keys(patch)) {
            this._versions[key] = (this._versions[key] ?? 0) + 1;
        }
        this._state = { ...this._state, ...patch };
        this._emit('setState', undefined, patch);
    }

    /**
     * Replace a single slice atomically.
     * Supports optimistic locking: if expectedVersion is provided and
     * doesn't match the current version, the write is rejected (returns false).
     * 
     * @returns true if write succeeded, false if version mismatch
     */
    setSlice<K extends keyof S>(key: K, value: S[K], expectedVersion?: number): boolean {
        const k = key as string;
        const currentVersion = this._versions[k] ?? 0;

        // Optimistic lock check
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
            return false;
        }

        this._versions[k] = currentVersion + 1;
        this._state = { ...this._state, [key]: value };
        this._emit('setSlice', k, { [key]: value } as unknown as Partial<S>);
        return true;
    }

    // ── Agent Prompt Rendering ─────────────────────

    /**
     * Render workspace slices as XML for injection into agent system prompt.
     * If sliceKeys is provided, only those slices are rendered.
     * If omitted, all slices are rendered.
     */
    render(sliceKeys?: (keyof S)[]): string {
        const keys = sliceKeys
            ? sliceKeys.map(k => String(k))
            : Object.keys(this._state);

        if (keys.length === 0) return '';

        const slices = keys.map(key => {
            const value = this._state[key as keyof S];
            const v = this._versions[key] ?? 0;
            const content = typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2);
            return `  <slice name="${key}" v="${v}">\n${content}\n  </slice>`;
        });

        return `\n\n<workspace name="${this._name}">\n${slices.join('\n')}\n</workspace>`;
    }

    // ── Serialization ──────────────────────────────

    /** Serialize for persistence. */
    toJSON(): { name: string; state: S; versions: Record<string, number> } {
        return {
            name: this._name,
            state: this._state,
            versions: { ...this._versions },
        };
    }

    /** Restore from serialized data. */
    loadJSON(data: { state: S; versions?: Record<string, number> }): void {
        this._state = data.state;
        if (data.versions) {
            this._versions = { ...data.versions };
        } else {
            // Initialize versions if not present (migration from old data)
            for (const key of Object.keys(data.state)) {
                this._versions[key] = 0;
            }
        }
    }

    // ── Internals ──────────────────────────────────

    private _emit(action: WorkspaceAction, slice?: string, patch?: Partial<S>): void {
        const event: WorkspaceChangeEvent<S> = {
            action,
            slice,
            state: this._state,
            patch,
            version: slice ? this._versions[slice] : undefined,
            versions: { ...this._versions },
        };
        this.emit('change', event);
    }
}
