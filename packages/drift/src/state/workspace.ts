/**
 * Drift — Workspace<S>
 * 
 * Shared reactive "workstation" for multi-agent collaboration.
 * A Workspace holds named Windows and optional shared state.
 * 
 * Windows are the primary data containers — each Window manages
 * its own items and state. The Workspace groups them and controls
 * which ones each agent can see.
 * 
 * Workspace.state is a simple shared state blob for cross-cutting
 * concerns (stats, config, etc.) — it's NOT subdivided into "slices".
 * 
 *   const ws = new Workspace('sprint', { projectName: 'drift' });
 *   ws.addWindow('files', codebaseWindow);
 *   ws.addWindow('tasks', taskBoardWindow);
 *   ws.getWindow('tasks');  // → TaskBoardWindow
 */

import { EventEmitter } from 'node:events';
import type { Window, WindowItem } from './window.ts';

// ── Types ───────────────────────────────────────────

export type WorkspaceAction = 'setState' | 'windowAdded' | 'windowRemoved' | 'sync';

export interface WorkspaceChangeEvent<S = any> {
    action: WorkspaceAction;
    /** Window name (for windowAdded/windowRemoved) */
    windowName?: string;
    /** Current full state snapshot */
    state: S;
    /** Patch applied (for setState) */
    patch?: Partial<S>;
}

// ── Workspace<S> ────────────────────────────────────

export class Workspace<S extends Record<string, any> = Record<string, any>> extends EventEmitter {
    private _state: S;
    private _windows: Map<string, Window<any, any>>;
    private _name: string;

    constructor(name: string, initialState?: S) {
        super();
        this._name = name;
        this._state = initialState || {} as S;
        this._windows = new Map();
    }

    // ── Identity ───────────────────────────────────

    /** Workspace name (used as persistence key). */
    get name(): string {
        return this._name;
    }

    // ── Windows ───────────────────────────────────

    /**
     * Register a named window in this workspace.
     * Sets the window's name property for identification.
     */
    addWindow(name: string, window: Window<any, any>): void {
        window.name = name;
        this._windows.set(name, window);
        this._emit('windowAdded', name);
    }

    /** Get a window by name. */
    getWindow<W extends Window<any, any> = Window<any, any>>(name: string): W | undefined {
        return this._windows.get(name) as W | undefined;
    }

    /** Remove a window by name. */
    removeWindow(name: string): boolean {
        const existed = this._windows.delete(name);
        if (existed) this._emit('windowRemoved', name);
        return existed;
    }

    /** All registered window names. */
    get windowNames(): string[] {
        return [...this._windows.keys()];
    }

    /** Read-only access to the windows map. */
    get windows(): Map<string, Window<any, any>> {
        return this._windows;
    }

    /** Check if a window exists. */
    hasWindow(name: string): boolean {
        return this._windows.has(name);
    }

    // ── State ──────────────────────────────────────

    /** Full state (readonly reference). */
    get state(): Readonly<S> {
        return this._state;
    }

    /** Shallow merge into state (like React setState). Emits 'change'. */
    setState(patch: Partial<S>): void {
        this._state = { ...this._state, ...patch };
        this._emit('setState', undefined, patch);
    }

    // ── Agent Prompt Rendering ─────────────────────

    /**
     * Render workspace content as XML for injection into agent system prompt.
     * If windowNames is provided, only those windows are rendered.
     * If omitted, all windows are rendered.
     */
    render(windowNames?: string[]): string {
        const names = windowNames || [...this._windows.keys()];
        const sections: string[] = [];

        for (const name of names) {
            const window = this._windows.get(name);
            if (!window) continue;
            const content = window.render();
            if (content) {
                sections.push(content);
            }
        }

        // Add state if non-empty
        const stateKeys = Object.keys(this._state);
        if (stateKeys.length > 0) {
            const stateContent = JSON.stringify(this._state, null, 2);
            sections.push(`  <state>\n${stateContent}\n  </state>`);
        }

        if (sections.length === 0) return '';

        return `\n\n<workspace name="${this._name}">\n${sections.join('\n')}\n</workspace>`;
    }

    // ── Serialization ──────────────────────────────

    /** Serialize for persistence. */
    toJSON(): { name: string; state: S; windows: Record<string, any> } {
        const windowData: Record<string, any> = {};
        for (const [name, window] of this._windows) {
            windowData[name] = window.toJSON();
        }
        return {
            name: this._name,
            state: this._state,
            windows: windowData,
        };
    }

    /** Restore state from serialized data (windows must be re-added manually). */
    loadJSON(data: { state?: S }): void {
        if (data.state) {
            this._state = data.state;
        }
    }

    // ── Internals ──────────────────────────────────

    private _emit(action: WorkspaceAction, windowName?: string, patch?: Partial<S>): void {
        const event: WorkspaceChangeEvent<S> = {
            action,
            windowName,
            state: this._state,
            patch,
        };
        this.emit('change', event);
    }
}
