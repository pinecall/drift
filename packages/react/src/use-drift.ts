/**
 * @drift/react — useDrift()
 * 
 * Connection status + agent listing + active agent management.
 * 
 *   const { connected, agents, activeAgent, setActiveAgent } = useDrift();
 */

import { useState, useCallback } from 'react';
import { useDriftContext } from './provider.tsx';
import type { AgentInfo } from './types.ts';

export interface UseDriftReturn {
    /** Is connected to server? */
    connected: boolean;
    /** Available agents */
    agents: AgentInfo[];
    /** Currently selected agent name */
    activeAgent: string;
    /** Switch active agent */
    setActiveAgent: (name: string) => void;
    /** Send raw WebSocket message */
    send: (msg: any) => void;
    /** Refresh agent list from server */
    refreshAgents: () => void;
}

export function useDrift(): UseDriftReturn {
    const { send, connected, agents } = useDriftContext();
    const [activeAgent, setActiveAgent] = useState<string>('');

    // Auto-select first agent
    if (!activeAgent && agents.length > 0) {
        setActiveAgent(agents[0].name);
    }

    const refreshAgents = useCallback(() => {
        send({ action: 'agents:list' });
    }, [send]);

    return {
        connected,
        agents,
        activeAgent,
        setActiveAgent,
        send,
        refreshAgents,
    };
}
