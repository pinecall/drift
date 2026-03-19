/**
 * useAgentStream — Subscribe to streaming text from dispatched agents.
 * 
 * When triggers dispatch agents with `streamTo: { itemId, field }`,
 * this hook collects the streaming text keyed by itemId.
 * 
 *   const streams = useAgentStream();
 *   const stream = streams.get(slide.id);
 *   // { text: '...accumulated...', field: 'research', agent: 'researcher-agent', isStreaming: true }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDriftContext } from './provider.tsx';

export interface AgentStreamEntry {
    /** Accumulated text from the agent */
    text: string;
    /** Which field this maps to (e.g. 'research', 'content') */
    field: string;
    /** Agent name producing this stream */
    agent: string;
    /** Session ID of the dispatch */
    sessionId: string;
    /** Is the agent still streaming? */
    isStreaming: boolean;
}

/**
 * Subscribe to text streams from dispatched agents.
 * Returns a Map<itemId, AgentStreamEntry> that updates in real-time.
 */
export function useAgentStream(): Map<string, AgentStreamEntry> {
    const { subscribe } = useDriftContext();
    const [streams, setStreams] = useState<Map<string, AgentStreamEntry>>(new Map());
    const streamsRef = useRef(streams);
    streamsRef.current = streams;

    useEffect(() => {
        return subscribe((event) => {
            // Text streaming with streamTo metadata
            if (event.event === 'chat:text' && event.streamTo) {
                const { itemId, field } = event.streamTo;
                setStreams(prev => {
                    const next = new Map(prev);
                    next.set(itemId, {
                        text: event.full || '',
                        field,
                        agent: event.agent || '',
                        sessionId: event.sessionId || '',
                        isStreaming: true,
                    });
                    return next;
                });
            }

            // Dispatch done → mark stream as finished
            if (event.event === 'dispatch:done' || event.event === 'dispatch:error') {
                const sessionId = event.sessionId;
                setStreams((prev: Map<string, AgentStreamEntry>) => {
                    let changed = false;
                    const next = new Map(prev);
                    for (const [id, entry] of next) {
                        if (entry.sessionId === sessionId && entry.isStreaming) {
                            next.set(id, { ...entry, isStreaming: false });
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
            }

            // Window changed with new item data → clear finished streams
            // (the real data is now in the window item)
            if (event.event === 'window:changed' && event.action === 'update') {
                setStreams(prev => {
                    if (prev.has(event.id) && !prev.get(event.id)!.isStreaming) {
                        const next = new Map(prev);
                        next.delete(event.id);
                        return next;
                    }
                    return prev;
                });
            }
        });
    }, [subscribe]);

    return streams;
}
