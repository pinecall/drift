/**
 * @drift/react — useWindow()
 * 
 * ★ The star hook. Real-time reactive window state.
 * 
 *   const { items, state, open, close, refresh, disable, enable, setState } = useWindow();
 *   const { items } = useWindow('files');  // filter by window name
 * 
 * Every window:changed event from the server updates React state.
 * Every action dispatches to the server and auto-syncs back.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDriftContext } from './provider.tsx';
import type { WindowItem } from './types.ts';

export interface UseWindowReturn<T extends WindowItem = WindowItem, S = Record<string, any>> {
    /** All items in the window (reactive) */
    items: T[];
    /** Window state (reactive) */
    state: S;
    /** Open a file/item */
    open: (path: string) => void;
    /** Close a file/item */
    close: (path: string) => void;
    /** Refresh a file (or all if no path) */
    refresh: (path?: string) => void;
    /** Disable a file (exclude from agent prompt but keep open) */
    disable: (path: string) => void;
    /** Enable a disabled file */
    enable: (path: string) => void;
    /** Update window state (shallow merge) */
    setState: (patch: Partial<S>) => void;
    /** Update an item by id (shallow merge) */
    updateItem: (id: string, patch: Partial<T>) => void;
    /** Remove an item by id */
    removeItem: (id: string) => void;
    /** Number of items */
    size: number;
}

/**
 * @param windowName Optional — filter events by window name (for workspace windows).
 *                   If omitted, listens to all window:changed events.
 */
export function useWindow<T extends WindowItem = WindowItem, S = Record<string, any>>(windowName?: string): UseWindowReturn<T, S> {
    const { send, subscribe } = useDriftContext();
    const [items, setItems] = useState<T[]>([]);
    const [state, setState_] = useState<S>({} as S);

    // Subscribe to window:changed events (optionally filtered by windowName)
    useEffect(() => {
        return subscribe((event) => {
            if (event.event === 'window:changed') {
                // If windowName provided, filter by it
                if (windowName && event.windowName && event.windowName !== windowName) {
                    return;
                }
                if (event.items) setItems(event.items);
                if (event.state) setState_(event.state);
            }
        });
    }, [subscribe, windowName]);

    // ── Actions ─────────────────────────────────────

    const open = useCallback((path: string) => {
        send({ action: 'window:open', path });
    }, [send]);

    const close = useCallback((path: string) => {
        send({ action: 'window:close', path });
    }, [send]);

    const refresh = useCallback((path?: string) => {
        send({ action: 'window:refresh', path });
    }, [send]);

    const disable = useCallback((path: string) => {
        send({ action: 'window:disable', path });
    }, [send]);

    const enable = useCallback((path: string) => {
        send({ action: 'window:enable', path });
    }, [send]);

    const setState = useCallback((patch: Partial<S>) => {
        send({ action: 'window:setState', patch });
    }, [send]);

    const updateItem = useCallback((id: string, patch: Partial<T>) => {
        send({ action: 'window:item:update', id, patch });
    }, [send]);

    const removeItem = useCallback((id: string) => {
        send({ action: 'window:item:remove', id });
    }, [send]);

    return {
        items,
        state,
        open,
        close,
        refresh,
        disable,
        enable,
        setState,
        updateItem,
        removeItem,
        size: items.length,
    };
}
