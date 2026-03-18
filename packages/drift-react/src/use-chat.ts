/**
 * drift-react — useChat()
 * 
 * Full chat with streaming, history, multi-turn, tool calls.
 * Follows the legacy pattern: everything is a message.
 *   - chat:started → creates assistant message with parts: []
 *   - chat:text/tool/thinking → updateLast() appends parts to the last message
 *   - chat:done → marks the message as done
 * 
 * No separate "streaming state" — it's all in messages[].
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDriftContext } from './provider.tsx';
import type { ChatMessage, AgentConfig, MessagePart } from './types.ts';

/** Options for nudge() — UI-triggered agent explanations. */
export interface NudgeOptions {
    /** Override the model for this nudge (e.g., 'haiku' for fast explanations). */
    model?: string;
    /** If true, nudge won't be saved to conversation history. Default: false. */
    ephemeral?: boolean;
    /** System instruction for this nudge (e.g., 'Be very brief, one sentence max'). */
    system?: string;
}

export interface UseChatReturn {
    /** Full conversation history (includes the in-progress assistant message) */
    messages: ChatMessage[];
    /** Send a message to the agent */
    send: (text: string) => void;
    /** Nudge the agent — trigger an explanation from a UI interaction. Auto-aborts current run. */
    nudge: (prompt: string, options?: NudgeOptions) => void;
    /** Abort the current run */
    abort: () => void;
    /** Clear conversation history */
    clear: () => void;
    /** Request full history from server */
    requestHistory: () => void;
    /** Swap the active agent within this session (keeps conversation) */
    swap: (newAgentName: string) => void;
    /** Is the agent currently streaming? */
    isStreaming: boolean;
    /** Last error */
    lastError: string | null;
    /** Current agent config (model, thinking, effort, etc.) */
    config: AgentConfig | null;
    /** Update agent settings at runtime */
    updateSettings: (patch: Partial<Pick<AgentConfig, 'model' | 'thinking' | 'effort' | 'webSearch'>>) => void;
    /** Session ID */
    sessionId: string;
    /** Currently active agent name (may change after swap) */
    activeAgent: string;
}

export function useChat(agentName: string, options?: { sessionId?: string }): UseChatReturn {
    const { send: wsSend, subscribe, agents } = useDriftContext();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [activeAgent, setActiveAgent] = useState(agentName);

    // Use provided sessionId or generate stable one per hook instance
    const sessionIdRef = useRef<string>('');
    if (!sessionIdRef.current) {
        sessionIdRef.current = options?.sessionId || (
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        );
    }
    // If external sessionId changes, update the ref
    const sessionId = options?.sessionId || sessionIdRef.current;

    // If external sessionId changes (e.g. switching session), clear local messages and request history
    const prevSessionIdRef = useRef(sessionId);
    const prevAgentRef = useRef(agentName);
    useEffect(() => {
        if (sessionId !== prevSessionIdRef.current) {
            prevSessionIdRef.current = sessionId;
            sessionIdRef.current = sessionId;
            setMessages([]);
            setIsStreaming(false);
            setLastError(null);
            wsSend({ action: 'chat:history', agent: activeAgent, sessionId });
        }
    }, [sessionId, activeAgent, wsSend]);

    // If agentName prop changes (e.g. user switched agent tab), sync activeAgent
    useEffect(() => {
        if (agentName !== prevAgentRef.current) {
            prevAgentRef.current = agentName;
            setActiveAgent(agentName);
            setMessages([]);
            setIsStreaming(false);
            setLastError(null);
        }
    }, [agentName]);

    // ── Helper: update last assistant message ──
    function updateLast(updater: (msg: ChatMessage) => ChatMessage) {
        setMessages(prev => {
            const m = [...prev];
            const last = m[m.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            m[m.length - 1] = updater(last);
            return m;
        });
    }

    // Subscribe to chat events for this session
    useEffect(() => {
        return subscribe((event) => {
            // Filter by sessionId if present, fall back to agent name
            if (event.sessionId && event.sessionId !== sessionId) return;
            if (!event.sessionId && event.agent !== activeAgent) return;

            switch (event.event) {
                // ─── New assistant turn ──────────────
                case 'chat:started':
                    setIsStreaming(true);
                    setLastError(null);
                    setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: '',
                        timestamp: Date.now(),
                        parts: [],
                        status: 'streaming',
                    }]);
                    break;

                // ─── Streamed text chunk ─────────────
                case 'chat:text':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        const last = parts[parts.length - 1];
                        if (last && last.type === 'text') {
                            parts[parts.length - 1] = { ...last, content: (last.content || '') + (event.delta || '') };
                        } else {
                            parts.push({ type: 'text', content: event.delta || '' });
                        }
                        return { ...l, parts, status: 'streaming' };
                    });
                    break;

                // ─── Thinking content ────────────────
                case 'chat:thinking':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        const idx = parts.findLastIndex((p: MessagePart) => p.type === 'thinking' && p.active);
                        if (idx >= 0) {
                            parts[idx] = { ...parts[idx], content: event.thinking || '' };
                        } else {
                            parts.push({ type: 'thinking', content: event.thinking || '', active: true });
                        }
                        return { ...l, parts };
                    });
                    break;

                // ─── Tool call started ───────────────
                case 'chat:tool':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        // Mark any active thinking as done
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i].type === 'thinking' && parts[i].active) {
                                parts[i] = { ...parts[i], active: false };
                            }
                        }
                        parts.push({ type: 'tool', name: event.name, params: event.params, status: 'executing' });
                        return { ...l, parts, status: 'tool' };
                    });
                    break;

                // ─── Tool result ─────────────────────
                case 'chat:tool:result':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        // Find matching executing tool (search from end)
                        for (let i = parts.length - 1; i >= 0; i--) {
                            if (parts[i].type === 'tool' && parts[i].name === event.name && parts[i].status === 'executing') {
                                parts[i] = { ...parts[i], result: event.result, ms: event.ms, status: 'done' };
                                break;
                            }
                        }
                        return { ...l, parts };
                    });
                    break;

                // ─── Turn completed ──────────────────
                case 'chat:done':
                    setIsStreaming(false);
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        // Mark any active thinking as done
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i].type === 'thinking' && parts[i].active) {
                                parts[i] = { ...parts[i], active: false };
                            }
                        }
                        return {
                            ...l,
                            parts,
                            content: event.result?.text || l.content,
                            status: 'done',
                        };
                    });
                    break;

                // ─── Error ───────────────────────────
                case 'chat:error':
                    setIsStreaming(false);
                    setLastError(event.error);
                    updateLast(l => ({ ...l, status: 'error' }));
                    break;

                // ─── History ─────────────────────────
                case 'chat:history':
                    if (event.messages) {
                        const parsed: ChatMessage[] = event.messages.map((m: any) => ({
                            role: m.role,
                            content: m.content || '',
                            timestamp: m.timestamp || Date.now(),
                            parts: m.parts || (m.content ? [{ type: 'text', content: m.content }] : []),
                            status: m.status || 'done',
                        }));
                        setMessages(parsed);
                    }
                    break;

                case 'chat:cleared':
                    setMessages([]);
                    setLastError(null);
                    break;

                case 'chat:settings:updated':
                    setConfig(event.config);
                    break;

                case 'chat:swapped':
                    if (event.config) setConfig(event.config);
                    if (event.agent) setActiveAgent(event.agent);
                    break;
            }
        });
    }, [subscribe, sessionId, activeAgent]);

    // Sync initial config from agents list
    useEffect(() => {
        const agent = agents.find((a: any) => a.name === activeAgent);
        if (agent?.config) setConfig(agent.config);
    }, [agents, activeAgent]);

    // ── Actions ─────────────────────────────────────

    const send = useCallback((text: string) => {
        // Add user message to local history immediately
        setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            timestamp: Date.now(),
        }]);
        setIsStreaming(true);
        setLastError(null);
        wsSend({ action: 'chat:send', agent: activeAgent, sessionId, message: text });
    }, [wsSend, activeAgent, sessionId]);

    const nudge = useCallback((prompt: string, options?: NudgeOptions) => {
        // Add nudge as a user message (visually tagged)
        setMessages(prev => [...prev, {
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
            nudge: true,
        }]);
        setIsStreaming(true);
        setLastError(null);
        wsSend({
            action: 'chat:nudge',
            agent: activeAgent,
            sessionId,
            prompt,
            ...(options?.model && { model: options.model }),
            ...(options?.ephemeral && { ephemeral: true }),
            ...(options?.system && { system: options.system }),
        });
    }, [wsSend, activeAgent, sessionId]);

    const abort = useCallback(() => {
        wsSend({ action: 'chat:abort', agent: activeAgent, sessionId });
    }, [wsSend, activeAgent, sessionId]);

    const clear = useCallback(() => {
        wsSend({ action: 'chat:clear', agent: activeAgent, sessionId });
    }, [wsSend, activeAgent, sessionId]);

    const requestHistory = useCallback(() => {
        wsSend({ action: 'chat:history', agent: activeAgent, sessionId });
    }, [wsSend, activeAgent, sessionId]);

    const swap = useCallback((newAgentName: string) => {
        wsSend({ action: 'chat:swap', agent: newAgentName, sessionId });
    }, [wsSend, sessionId]);

    const updateSettings = useCallback((patch: Partial<Pick<AgentConfig, 'model' | 'thinking' | 'effort' | 'webSearch'>>) => {
        wsSend({ action: 'chat:settings', agent: activeAgent, ...patch });
    }, [wsSend, activeAgent]);

    return {
        messages,
        send,
        nudge,
        abort,
        clear,
        requestHistory,
        swap,
        isStreaming,
        lastError,
        config,
        updateSettings,
        sessionId,
        activeAgent,
    };
}
