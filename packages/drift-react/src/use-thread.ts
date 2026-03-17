/**
 * drift-react — useThread()
 * 
 * Contextual mini-chat scoped to an entity (card, item, etc.).
 * Each thread has its own conversation history, isolated from the main chat.
 * 
 * Internally, a thread is a sub-session with id: `${parentSession}::thread::${threadId}`
 * 
 *   const thread = useThread({
 *       agent: 'task-agent',
 *       threadId: `card:${task.id}`,
 *       parentSession: sessionId,
 *       context: `Task: "${task.title}" — ${task.description}`,
 *   });
 *   
 *   thread.send('What does this task involve?');
 *   thread.messages  // this thread's history
 *   thread.isOpen    // panel visibility
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDriftContext } from './provider.tsx';
import type { ChatMessage, MessagePart } from './types.ts';

// ── Types ───────────────────────────────────────────

export interface ThreadOptions {
    /** Which agent to use */
    agent: string;
    /** Unique thread identifier (e.g. 'card:task-1') */
    threadId: string;
    /** Parent session ID — the thread inherits window access */
    parentSession: string;
    /** Context injected into the agent's system prompt for this thread */
    context: string;
    /** Model override for this thread */
    model?: string;
    /** Custom system instruction */
    system?: string;
}

export interface UseThreadReturn {
    /** Thread conversation messages */
    messages: ChatMessage[];
    /** Send a message in this thread */
    send: (text: string) => void;
    /** Abort current streaming response */
    abort: () => void;
    /** Clear thread history */
    clear: () => void;
    /** Is the agent currently responding? */
    isStreaming: boolean;
    /** Open the thread panel */
    open: () => void;
    /** Close the thread panel */
    close: () => void;
    /** Toggle open/closed */
    toggle: () => void;
    /** Is the thread panel visible? */
    isOpen: boolean;
    /** Minimize (keep history, hide panel) */
    minimize: () => void;
    /** Is minimized? */
    isMinimized: boolean;
    /** Has any previous messages? */
    hasHistory: boolean;
    /** Thread session ID */
    sessionId: string;
    /** Last error */
    lastError: string | null;
}

// ── Hook ────────────────────────────────────────────

export function useThread(options: ThreadOptions): UseThreadReturn {
    const { send: wsSend, subscribe } = useDriftContext();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    // Derive thread session ID
    const sessionId = `${options.parentSession}::thread::${options.threadId}`;

    // Request history on mount
    const initializedRef = useRef(false);
    useEffect(() => {
        if (!initializedRef.current) {
            initializedRef.current = true;
            wsSend({ action: 'thread:history', agent: options.agent, sessionId });
        }
    }, [wsSend, options.agent, sessionId]);

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

    // Subscribe to thread events
    useEffect(() => {
        return subscribe((event) => {
            // Only handle events for this thread's session
            if (event.sessionId !== sessionId) return;

            switch (event.event) {
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

                case 'chat:tool':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i].type === 'thinking' && parts[i].active) {
                                parts[i] = { ...parts[i], active: false };
                            }
                        }
                        parts.push({ type: 'tool', name: event.name, params: event.params, status: 'executing' });
                        return { ...l, parts, status: 'tool' };
                    });
                    break;

                case 'chat:tool:result':
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        for (let i = parts.length - 1; i >= 0; i--) {
                            if (parts[i].type === 'tool' && parts[i].name === event.name && parts[i].status === 'executing') {
                                parts[i] = { ...parts[i], result: event.result, ms: event.ms, status: 'done' };
                                break;
                            }
                        }
                        return { ...l, parts };
                    });
                    break;

                case 'chat:done':
                    setIsStreaming(false);
                    updateLast(l => {
                        const parts = [...(l.parts || [])];
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i].type === 'thinking' && parts[i].active) {
                                parts[i] = { ...parts[i], active: false };
                            }
                        }
                        return { ...l, parts, content: event.result?.text || l.content, status: 'done' };
                    });
                    break;

                case 'chat:error':
                    setIsStreaming(false);
                    setLastError(event.error);
                    updateLast(l => ({ ...l, status: 'error' }));
                    break;

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
            }
        });
    }, [subscribe, sessionId]);

    // ── Actions ─────────────────────────────────────

    const send = useCallback((text: string) => {
        setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            timestamp: Date.now(),
        }]);
        setIsStreaming(true);
        setLastError(null);
        wsSend({
            action: 'thread:send',
            agent: options.agent,
            sessionId,
            parentSession: options.parentSession,
            threadId: options.threadId,
            context: options.context,
            message: text,
            ...(options.model && { model: options.model }),
            ...(options.system && { system: options.system }),
        });
    }, [wsSend, options, sessionId]);

    const abort = useCallback(() => {
        wsSend({ action: 'chat:abort', agent: options.agent, sessionId });
    }, [wsSend, options.agent, sessionId]);

    const clear = useCallback(() => {
        wsSend({ action: 'chat:clear', agent: options.agent, sessionId });
    }, [wsSend, options.agent, sessionId]);

    const open = useCallback(() => {
        setIsOpen(true);
        setIsMinimized(false);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        setIsMinimized(false);
    }, []);

    const toggle = useCallback(() => {
        setIsOpen(prev => !prev);
        setIsMinimized(false);
    }, []);

    const minimize = useCallback(() => {
        setIsMinimized(true);
    }, []);

    return {
        messages,
        send,
        abort,
        clear,
        isStreaming,
        open,
        close,
        toggle,
        isOpen,
        minimize,
        isMinimized,
        hasHistory: messages.length > 0,
        sessionId,
        lastError,
    };
}
