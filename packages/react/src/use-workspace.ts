/**
 * @drift/react — useWorkspace()
 * 
 * Reactive hook for shared workspace state (cross-agent).
 * 
 *   const { state, setState, windowNames } = useWorkspace<MyState>();
 * 
 * Subscribes to workspace:changed events from the server.
 * Mutations dispatch to the server and auto-sync back.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDriftContext } from './provider.tsx';

export interface UseWorkspaceReturn<S = Record<string, any>> {
    /** Full workspace state (reactive — updates on every server change) */
    state: S;
    /** Update state (shallow merge) */
    setState: (patch: Partial<S>) => void;
    /** Available window names in the workspace */
    windowNames: string[];
}

export function useWorkspace<S = Record<string, any>>(): UseWorkspaceReturn<S> {
    const { send, subscribe } = useDriftContext();
    const [state, setState_] = useState<S>({} as S);
    const [windowNames, setWindowNames] = useState<string[]>([]);

    // Subscribe to workspace:changed events
    useEffect(() => {
        return subscribe((event) => {
            if (event.event === 'workspace:changed') {
                if (event.state) setState_(event.state);
                if (event.windowNames) setWindowNames(event.windowNames);
            }
        });
    }, [subscribe]);

    // ── Actions ─────────────────────────────────────

    const setState = useCallback((patch: Partial<S>) => {
        send({ action: 'workspace:setState', patch });
    }, [send]);

    return { state, setState, windowNames };
}
