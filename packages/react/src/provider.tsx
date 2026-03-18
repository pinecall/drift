/**
 * @drift/react — DriftProvider
 * 
 * WebSocket connection context for all drift hooks.
 * 
 *   <DriftProvider url="ws://localhost:3100">
 *       <App />
 *   </DriftProvider>
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { ServerEvent, ClientMessage, AgentInfo } from './types.ts';

// ── Context ─────────────────────────────────────────

interface DriftContextValue {
    /** Send a message to the server */
    send: (msg: ClientMessage) => void;
    /** Subscribe to events. Returns unsubscribe fn. */
    subscribe: (handler: (event: ServerEvent) => void) => () => void;
    /** Connection status */
    connected: boolean;
    /** Available agents (from server) */
    agents: AgentInfo[];
}

const DriftContext = createContext<DriftContextValue | null>(null);

// ── Provider ────────────────────────────────────────

interface DriftProviderProps {
    url: string;
    children: ReactNode;
    /** Auto-reconnect on disconnect (default: true) */
    reconnect?: boolean;
    /** Reconnect delay in ms (default: 2000) */
    reconnectDelay?: number;
}

export function DriftProvider({ url, children, reconnect = true, reconnectDelay = 2000 }: DriftProviderProps) {
    const wsRef = useRef<WebSocket | null>(null);
    const handlersRef = useRef<Set<(event: ServerEvent) => void>>(new Set());
    const [connected, setConnected] = useState(false);
    const [agents, setAgents] = useState<AgentInfo[]>([]);

    const connect = useCallback(() => {
        const ws = new WebSocket(url);

        ws.onopen = () => {
            setConnected(true);
        };

        ws.onmessage = (e) => {
            try {
                const event: ServerEvent = JSON.parse(e.data as string);
                
                // Handle agents:list internally
                if (event.event === 'agents:list') {
                    setAgents(event.agents || []);
                }

                // Sync agent config on settings change
                if (event.event === 'chat:settings:updated') {
                    setAgents(prev => prev.map(a =>
                        a.name === event.agent ? { ...a, model: event.config.model, config: event.config } : a
                    ));
                }

                // Dispatch to all subscribers
                for (const handler of handlersRef.current) {
                    handler(event);
                }
            } catch { /* ignore parse errors */ }
        };

        ws.onclose = () => {
            setConnected(false);
            wsRef.current = null;
            if (reconnect) {
                setTimeout(connect, reconnectDelay);
            }
        };

        ws.onerror = () => {
            ws.close();
        };

        wsRef.current = ws;
    }, [url, reconnect, reconnectDelay]);

    useEffect(() => {
        connect();
        return () => {
            wsRef.current?.close();
        };
    }, [connect]);

    const send = useCallback((msg: ClientMessage) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }, []);

    const subscribe = useCallback((handler: (event: ServerEvent) => void) => {
        handlersRef.current.add(handler);
        return () => { handlersRef.current.delete(handler); };
    }, []);

    return (
        <DriftContext.Provider value={{ send, subscribe, connected, agents }}>
            {children}
        </DriftContext.Provider>
    );
}

// ── Hook to access context ──────────────────────────

export function useDriftContext(): DriftContextValue {
    const ctx = useContext(DriftContext);
    if (!ctx) throw new Error('useDriftContext must be used within <DriftProvider>');
    return ctx;
}
