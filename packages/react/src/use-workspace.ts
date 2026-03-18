/**
 * @drift/react — useWorkspace()
 * 
 * Reactive hook for shared workspace state (cross-agent).
 * 
 *   const { state, setState, setSlice } = useWorkspace<MyState>();
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
    /** Replace a single slice atomically */
    setSlice: <K extends keyof S>(key: K, value: S[K]) => void;
    /** Per-slice version numbers */
    versions: Record<string, number>;
}

export function useWorkspace<S = Record<string, any>>(): UseWorkspaceReturn<S> {
    const { send, subscribe } = useDriftContext();
    const [state, setState_] = useState<S>({} as S);
    const [versions, setVersions] = useState<Record<string, number>>({});

    // Subscribe to workspace:changed events
    useEffect(() => {
        return subscribe((event) => {
            if (event.event === 'workspace:changed') {
                if (event.state) setState_(event.state);
                if (event.versions) setVersions(event.versions);
            }
        });
    }, [subscribe]);

    // ── Actions ─────────────────────────────────────

    const setState = useCallback((patch: Partial<S>) => {
        send({ action: 'workspace:setState', patch });
    }, [send]);

    const setSlice = useCallback(<K extends keyof S>(key: K, value: S[K]) => {
        send({ action: 'workspace:setSlice', slice: key, value });
    }, [send]);

    return { state, setState, setSlice, versions };
}
