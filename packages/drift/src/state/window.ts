/**
 * Drift — Window<T, S> Base Class
 * 
 * Generic reactive container for agent context.
 * Two data layers:
 *   - items: Map<string, T> — collection of domain objects (files, positions, etc.)
 *   - state: S             — arbitrary state object (like React useState)
 * 
 * Every mutation emits 'change' — UI hooks into this for real-time sync.
 * Subclass and override render() to define how data appears in the agent's prompt.
 * 
 *   agent.window = new CodebaseWindow({ cwd: '/my/project' });
 *   agent.window.on('change', (event) => ws.send(JSON.stringify(event)));
 */

import { EventEmitter } from 'node:events';

// ── Types ───────────────────────────────────────────

export interface WindowItem {
    id: string;
    [key: string]: any;
}

export type ChangeAction = 'add' | 'remove' | 'update' | 'clear' | 'setState';

export interface WindowChangeEvent<T extends WindowItem = WindowItem, S = any> {
    action: ChangeAction;
    /** Item id (for add/remove/update) */
    id?: string;
    /** Full item (for add/update) */
    item?: T;
    /** Partial patch (for update/setState) */
    patch?: Partial<T> | Partial<S>;
    /** Current items snapshot */
    items: T[];
    /** Current state snapshot */
    state: S;
}

// ── Window<T, S> ────────────────────────────────────

export class Window<T extends WindowItem = WindowItem, S extends Record<string, any> = Record<string, any>> extends EventEmitter {
    /** Optional name — set when registered in a Workspace. */
    name?: string;

    protected _items = new Map<string, T>();
    protected _state: S;
    protected _turn: number = 0;

    constructor(initialState?: S) {
        super();
        this._state = initialState || {} as S;
    }

    // ── State (React-like) ──────────────────────────

    /** Current state. */
    get state(): Readonly<S> {
        return this._state;
    }

    /** Update state (shallow merge, like React setState). Emits 'change'. */
    setState(patch: Partial<S>): void {
        this._state = { ...this._state, ...patch };
        this._emit('setState', undefined, undefined, patch);
    }

    // ── Items CRUD ──────────────────────────────────

    /** Add an item. Replaces if id already exists. */
    add(id: string, item: T): void {
        this._items.set(id, item);
        this._emit('add', id, item);
    }

    /** Remove an item by id. Returns true if it existed. */
    remove(id: string): boolean {
        const existed = this._items.delete(id);
        if (existed) this._emit('remove', id);
        return existed;
    }

    /** Patch an existing item (shallow merge). */
    update(id: string, patch: Partial<T>): void {
        const existing = this._items.get(id);
        if (!existing) return;
        const updated = { ...existing, ...patch } as T;
        this._items.set(id, updated);
        this._emit('update', id, updated, patch);
    }

    /** Get an item by id. */
    get(id: string): T | undefined {
        return this._items.get(id);
    }

    /** Check if an item exists. */
    has(id: string): boolean {
        return this._items.has(id);
    }

    /** All items as an array. */
    list(): T[] {
        return [...this._items.values()];
    }

    /** All ids. */
    keys(): string[] {
        return [...this._items.keys()];
    }

    /** Clear all items. */
    clear(): void {
        this._items.clear();
        this._emit('clear');
    }

    /** Number of items. */
    get size(): number {
        return this._items.size;
    }

    // ── Turn Management ─────────────────────────────

    /** Advance the turn counter (called by agent at start of each iteration). */
    nextTurn(): void {
        this._turn++;
    }

    /** Current turn number. */
    get turn(): number {
        return this._turn;
    }

    // ── Agent Integration (override in subclass) ────

    /**
     * Render window content for injection into the agent's system prompt.
     * Override this in domain-specific subclasses.
     * Return empty string to skip injection.
     */
    render(): string {
        if (this._items.size === 0) return '';
        const lines = this.list().map(item => `  ${item.id}: ${JSON.stringify(item)}`);
        return `\n\n<window>\n${lines.join('\n')}\n</window>`;
    }

    /**
     * Render a short metadata summary for user messages.
     * Override in subclass for domain-specific summaries.
     */
    renderMetadata(): string {
        return `Window: ${this._items.size} item(s)`;
    }

    // ── Serialization ───────────────────────────────

    /** Serialize to plain object for persistence. */
    toJSON(): { items: [string, T][]; state: S; turn: number } {
        return {
            items: [...this._items.entries()],
            state: this._state,
            turn: this._turn,
        };
    }

    /** Restore from serialized data. */
    loadJSON(data: { items: [string, T][]; state?: S; turn?: number }): void {
        this._items.clear();
        for (const [id, item] of data.items) {
            this._items.set(id, item);
        }
        if (data.state) this._state = data.state;
        this._turn = data.turn || 0;
    }

    // ── Internals ───────────────────────────────────

    private _emit(action: ChangeAction, id?: string, item?: T, patch?: any): void {
        const event: WindowChangeEvent<T, S> = {
            action,
            id,
            item,
            patch,
            items: this.list(),
            state: this._state,
        };
        this.emit('change', event);
    }
}
