/**
 * drift-react — useSessions()
 * 
 * Tracks all sessions on the server. Provides create, delete, and refresh.
 * Subscribes to sessions:list, sessions:created, sessions:deleted, sessions:updated events.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDriftContext } from './provider.tsx';

export interface SessionInfo {
    id: string;
    agentName: string;
    createdAt: number;
    messageCount: number;
    lastMessage?: string;
    isRunning?: boolean;
}

export interface UseSessionsReturn {
    /** All known sessions */
    sessions: SessionInfo[];
    /** Create a new session (returns immediately, sessionId comes via event) */
    createSession: (agentName?: string) => void;
    /** Delete a session */
    deleteSession: (sessionId: string) => void;
    /** Refresh sessions list from server */
    refreshSessions: () => void;
}

export function useSessions(): UseSessionsReturn {
    const { send: wsSend, subscribe } = useDriftContext();
    const [sessions, setSessions] = useState<SessionInfo[]>([]);

    useEffect(() => {
        return subscribe((event) => {
            switch (event.event) {
                case 'sessions:list':
                    setSessions(event.sessions || []);
                    break;

                case 'sessions:created':
                    if (event.session) {
                        setSessions(prev => {
                            // Avoid duplicates
                            if (prev.some(s => s.id === event.session.id)) return prev;
                            return [...prev, event.session];
                        });
                    }
                    break;

                case 'sessions:deleted':
                    setSessions(prev => prev.filter(s => s.id !== event.sessionId));
                    break;

                case 'sessions:updated':
                    if (event.session) {
                        setSessions(prev => prev.map(s =>
                            s.id === event.session.id ? event.session : s
                        ));
                    }
                    break;
            }
        });
    }, [subscribe]);

    const createSession = useCallback((agentName?: string) => {
        wsSend({ action: 'sessions:create', agent: agentName });
    }, [wsSend]);

    const deleteSession = useCallback((sessionId: string) => {
        wsSend({ action: 'sessions:delete', sessionId });
    }, [wsSend]);

    const refreshSessions = useCallback(() => {
        wsSend({ action: 'sessions:list' });
    }, [wsSend]);

    return { sessions, createSession, deleteSession, refreshSessions };
}
