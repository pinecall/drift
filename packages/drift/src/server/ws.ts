/**
 * Drift Server — WebSocket Protocol
 * 
 * JSON bidirectional protocol over native Node.js WebSocket.
 * Handles chat (agent runs), window operations, and agent listing.
 * 
 * Client → Server: { action, ...payload }
 * Server → Client: { event, ...payload }
 * 
 * Actions:
 *   chat:send, chat:abort, chat:clear, chat:history — Chat operations
 *   chat:settings — Runtime model/thinking/effort changes
 *   window:* — Window CRUD
 *   agents:list, agents:detail — Agent queries
 *   models:list — Available model catalog
 */

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Agent } from '../core/agent.ts';
import { Session } from '../core/session.ts';
import type { Window } from '../core/window.ts';
import type { CodebaseWindow } from '../windows/codebase-window.tsx';
import type { LoadedAgent } from './config.ts';
import { listModels, getModel } from '../provider/models.ts';
import type { Effort } from '../types.ts';
import type { Storage } from '../core/storage.ts';
import { NoAuth, type DriftAuth, type DriftUser } from '../core/auth.ts';

// ── Types ───────────────────────────────────────────

interface ClientMessage {
    action: string;
    agent?: string;
    [key: string]: any;
}

// ── WebSocket Handler ───────────────────────────────

export function createWSHandler(
    httpServer: HttpServer,
    agents: LoadedAgent[],
    windows: Map<string, Window<any, any>>,
    storage?: Storage,
    auth?: DriftAuth,
) {
    const wss = new WebSocketServer({ server: httpServer });
    const clients = new Set<WebSocket>();
    const clientUsers = new WeakMap<WebSocket, DriftUser>();
    const agentMap = new Map<string, Agent>(agents.map(a => [a.name, a.agent]));
    const sessions = new Map<string, Session>();
    const resolvedAuth: DriftAuth = auth || new NoAuth();

    // Restore sessions from storage on startup
    if (storage) {
        _restoreSessions(storage, sessions, agentMap, agents);
    }

    // ── Broadcast to all clients ────────────────────

    function broadcast(data: any) {
        const msg = JSON.stringify(data);
        for (const ws of clients) {
            if (ws.readyState === 1) ws.send(msg);
        }
    }

    function send(ws: WebSocket, data: any) {
        if (ws.readyState === 1) ws.send(JSON.stringify(data));
    }

    // ── Wire window change events → broadcast ──────

    for (const [className, window] of windows) {
        window.on('change', (event) => {
            broadcast({ event: 'window:changed', windowClass: className, ...event });
        });
    }

    // ── Connection handler ──────────────────────────

    wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
        // ── Auth gate ──
        let user: DriftUser;
        try {
            user = await resolvedAuth.authenticate(req);
        } catch (err: any) {
            ws.close(4001, err.message || 'Unauthorized');
            return;
        }

        clients.add(ws);
        clientUsers.set(ws, user);

        // Send agent list on connect
        send(ws, {
            event: 'agents:list',
            agents: agents.map(a => ({
                name: a.name,
                model: a.agent.model,
                builtin: a.builtin,
                hasWindow: !!a.agent.window,
                windowClass: a.agent.window?.constructor.name || null,
                config: _getAgentConfig(a.agent),
            })),
        });

        // Send sessions list on connect
        send(ws, {
            event: 'sessions:list',
            sessions: [...sessions.values()].map(_serializeSession),
        });

        // Send current window state for each window
        for (const [className, window] of windows) {
            send(ws, {
                event: 'window:changed',
                windowClass: className,
                action: 'sync',
                items: window.list(),
                state: window.state,
            });
        }

        ws.on('message', async (raw: Buffer) => {
            let msg: ClientMessage;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                send(ws, { event: 'error', error: 'Invalid JSON' });
                return;
            }

            try {
                const user = clientUsers.get(ws)!;

                // Optional per-message authorization
                if (resolvedAuth.authorize) {
                    await resolvedAuth.authorize(user, msg.action, msg);
                }
                await handleMessage(ws, msg);
            } catch (err: any) {
                send(ws, { event: 'error', action: msg.action, error: err.message });
            }
        });

        ws.on('close', () => {
            clients.delete(ws);
        });
    });

    // ── Message Router ──────────────────────────────

    async function handleMessage(ws: WebSocket, msg: ClientMessage) {
        switch (msg.action) {

            // ── Chat ────────────────────────────────

            case 'chat:send': {
                const agentName = msg.agent || '';
                const agent = _resolveAgent(agentName);
                const sessionId = msg.sessionId || agentName; // backward compat: use agent name if no sessionId

                // Get or create session
                let session = sessions.get(sessionId);
                let isNewSession = false;
                if (!session) {
                    session = new Session(agent, { id: sessionId });
                    sessions.set(sessionId, session);
                    isNewSession = true;
                }

                if (session.isRunning) {
                    send(ws, { event: 'chat:error', agent: agentName, sessionId, error: 'Session is already running' });
                    return;
                }

                // Wire agent events → broadcast
                const cleanup = _wireAgentEvents(agent, agentName, sessionId, broadcast);

                // Notify clients: new assistant turn started
                broadcast({ event: 'chat:started', agent: agentName, sessionId });

                try {
                    // Prepend timestamp so the agent has temporal context
                    const now = new Date();
                    const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                    const stamped = `[${ts}] ${msg.message}`;
                    const result = await session.run(stamped);
                    broadcast({ event: 'chat:done', agent: agentName, sessionId, result: { text: result.text, cost: result.cost } });
                } catch (err: any) {
                    broadcast({ event: 'chat:error', agent: agentName, sessionId, error: err.message });
                } finally {
                    cleanup();
                    // Persist after run
                    if (storage && session) {
                        storage.saveSession(session.toJSON());
                        storage.saveMessages(sessionId, session.conversation.toJSON());
                        // Save window state if agent has one
                        if (agent.window) {
                            const winClass = agent.window.constructor.name;
                            storage.saveWindow(sessionId, winClass, agent.window.toJSON());
                        }
                    }
                    // Broadcast session update after run completes
                    broadcast({ event: 'sessions:updated', session: _serializeSession(session!) });
                }

                // If this was a new session, broadcast creation after first message
                if (isNewSession) {
                    broadcast({ event: 'sessions:created', session: _serializeSession(session!) });
                }
                break;
            }

            case 'chat:abort': {
                const sessionId = msg.sessionId || msg.agent || '';
                const session = sessions.get(sessionId);
                if (session) {
                    session.abort();
                } else {
                    // Backward compat: abort by agent name
                    const agent = _resolveAgent(msg.agent || '');
                    agent.abort();
                }
                break;
            }

            case 'chat:nudge': {
                const agentName = msg.agent || '';
                const agent = _resolveAgent(agentName);
                const sessionId = msg.sessionId || agentName;

                // Get or create session
                let session = sessions.get(sessionId);
                let isNewSession = false;
                if (!session) {
                    session = new Session(agent, { id: sessionId });
                    sessions.set(sessionId, session);
                    isNewSession = true;
                }

                // Auto-abort if currently running (interrupt mode)
                if (session.isRunning) {
                    session.abort();
                    // Wait until session actually stops (up to 2s)
                    for (let i = 0; i < 40 && session.isRunning; i++) {
                        await new Promise(r => setTimeout(r, 50));
                    }
                }

                // Prefix message so the agent knows it's a nudge
                const now = new Date();
                const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                const nudgePrompt = `[${ts}] [NUDGE from UI] ${msg.prompt}`;

                // Optional: inject custom system instruction
                const systemSuffix = msg.system
                    ? `\n\n[Nudge instruction: ${msg.system}]`
                    : '\n\n[This is a nudge from the UI. Respond briefly and helpfully.]';
                const fullPrompt = nudgePrompt + systemSuffix;

                // Optional: temporarily override model
                const originalModel = agent.model;
                if (msg.model) {
                    agent.model = msg.model;
                }

                // Wire events & run
                const cleanup = _wireAgentEvents(agent, agentName, sessionId, broadcast);
                broadcast({ event: 'chat:started', agent: agentName, sessionId, nudge: true });

                try {
                    const result = await session.run(fullPrompt);
                    broadcast({ event: 'chat:done', agent: agentName, sessionId, nudge: true, result: { text: result.text, cost: result.cost } });
                } catch (err: any) {
                    broadcast({ event: 'chat:error', agent: agentName, sessionId, error: err.message });
                } finally {
                    cleanup();
                    // Restore original model
                    if (msg.model) agent.model = originalModel;

                    // Persist (unless ephemeral)
                    if (storage && session && !msg.ephemeral) {
                        storage.saveSession(session.toJSON());
                        storage.saveMessages(sessionId, session.conversation.toJSON());
                        if (agent.window) {
                            const winClass = agent.window.constructor.name;
                            storage.saveWindow(sessionId, winClass, agent.window.toJSON());
                        }
                    }
                    broadcast({ event: 'sessions:updated', session: _serializeSession(session!) });
                }

                if (isNewSession) {
                    broadcast({ event: 'sessions:created', session: _serializeSession(session!) });
                }
                break;
            }

            case 'chat:swap': {
                const sessionId = msg.sessionId || '';
                const newAgentName = msg.agent || '';
                const session = sessions.get(sessionId);
                if (!session) {
                    send(ws, { event: 'chat:error', sessionId, error: `No session: ${sessionId}` });
                    return;
                }
                const newAgent = _resolveAgent(newAgentName);
                session.swap(newAgent);
                broadcast({
                    event: 'chat:swapped',
                    sessionId,
                    agent: newAgentName,
                    config: _getAgentConfig(newAgent),
                });
                break;
            }

            case 'chat:history': {
                const sessionId = msg.sessionId || msg.agent || '';
                const session = sessions.get(sessionId);
                if (session) {
                    send(ws, {
                        event: 'chat:history',
                        sessionId,
                        agent: msg.agent,
                        messages: _formatHistory(session.conversation.messages),
                    });
                } else {
                    // Backward compat fallback
                    const agent = _resolveAgent(msg.agent || '');
                    send(ws, {
                        event: 'chat:history',
                        agent: msg.agent,
                        messages: _formatHistory(agent.conversation.messages),
                    });
                }
                break;
            }

            case 'chat:clear': {
                const sessionId = msg.sessionId || msg.agent || '';
                const session = sessions.get(sessionId);
                if (session) {
                    session.clear();
                    send(ws, { event: 'chat:cleared', sessionId, agent: msg.agent });
                } else {
                    // Backward compat fallback
                    const agent = _resolveAgent(msg.agent || '');
                    agent.conversation.clear();
                    send(ws, { event: 'chat:cleared', agent: msg.agent });
                }
                break;
            }

            // ── Window ──────────────────────────────

            case 'window:open': {
                const win = _resolveWindow(msg.agent) as CodebaseWindow;
                if (!win || typeof (win as any).open !== 'function') {
                    send(ws, { event: 'error', error: 'No codebase window available' });
                    return;
                }
                const result = (win as any).open(msg.path);
                send(ws, { event: 'window:open:result', ...result });
                break;
            }

            case 'window:close': {
                const win = _resolveWindow(msg.agent) as CodebaseWindow;
                if (win && typeof (win as any).close === 'function') (win as any).close(msg.path);
                break;
            }

            case 'window:refresh': {
                const win = _resolveWindow(msg.agent) as CodebaseWindow;
                if (!win) break;
                if (msg.path) {
                    (win as any).refresh(msg.path);
                } else {
                    (win as any).refreshAll();
                }
                break;
            }

            case 'window:disable': {
                const win = _resolveWindow(msg.agent) as CodebaseWindow;
                if (win && typeof (win as any).disable === 'function') (win as any).disable(msg.path);
                break;
            }

            case 'window:enable': {
                const win = _resolveWindow(msg.agent) as CodebaseWindow;
                if (win && typeof (win as any).enable === 'function') (win as any).enable(msg.path);
                break;
            }

            case 'window:setState': {
                const win = _resolveWindow(msg.agent);
                if (win) {
                    win.setState(msg.patch);
                    _persistWindow(msg.agent, win);
                }
                break;
            }

            // ── Generic item operations ─────────
            case 'window:item:update': {
                const win = _resolveWindow(msg.agent);
                if (win && msg.id) {
                    win.update(msg.id, msg.patch || {});
                    _persistWindow(msg.agent, win);
                }
                break;
            }

            case 'window:item:remove': {
                const win = _resolveWindow(msg.agent);
                if (win && msg.id) {
                    win.remove(msg.id);
                    _persistWindow(msg.agent, win);
                }
                break;
            }

            // ── Agents ──────────────────────────────

            case 'agents:list': {
                send(ws, {
                    event: 'agents:list',
                    agents: agents.map(a => ({
                        name: a.name,
                        model: a.agent.model,
                        builtin: a.builtin,
                        hasWindow: !!a.agent.window,
                        windowClass: a.agent.window?.constructor.name || null,
                        isRunning: [...sessions.values()].some(s => s.agent === a.agent && s.isRunning),
                        config: _getAgentConfig(a.agent),
                    })),
                });
                break;
            }

            // ── Sessions ────────────────────────────

            case 'sessions:list': {
                send(ws, {
                    event: 'sessions:list',
                    sessions: [...sessions.values()].map(_serializeSession),
                });
                break;
            }

            case 'sessions:create': {
                const agentName = msg.agent || agents[0]?.name || '';
                const agent = _resolveAgent(agentName);
                const session = new Session(agent);
                sessions.set(session.id, session);
                broadcast({ event: 'sessions:created', session: _serializeSession(session) });
                send(ws, { event: 'sessions:created:ack', sessionId: session.id });
                break;
            }

            case 'sessions:delete': {
                const sessionId = msg.sessionId || '';
                const session = sessions.get(sessionId);
                if (!session) {
                    send(ws, { event: 'error', error: `No session: ${sessionId}` });
                    return;
                }
                if (session.isRunning) session.abort();
                sessions.delete(sessionId);
                if (storage) storage.deleteSession(sessionId);
                broadcast({ event: 'sessions:deleted', sessionId });
                break;
            }

            case 'agents:detail': {
                const agent = _resolveAgent(msg.agent || '');
                send(ws, {
                    event: 'agents:detail',
                    agent: msg.agent,
                    config: _getAgentConfig(agent),
                });
                break;
            }

            // ── Settings ────────────────────────────

            case 'chat:settings': {
                const agentName = msg.agent || '';
                const agent = _resolveAgent(agentName);

                if (msg.model) {
                    const result = agent.switchModel(msg.model);
                    if (!result.success) {
                        send(ws, { event: 'chat:error', agent: agentName, error: result.message });
                        return;
                    }
                }
                if (msg.thinking !== undefined) agent.thinking = !!msg.thinking;
                if (msg.effort) agent.effort = msg.effort as Effort;
                if (msg.webSearch !== undefined) agent.webSearch = !!msg.webSearch;

                // Broadcast updated config to all clients
                broadcast({
                    event: 'chat:settings:updated',
                    agent: agentName,
                    config: _getAgentConfig(agent),
                });
                break;
            }

            // ── Models ──────────────────────────────

            case 'models:list': {
                const models = listModels().map(name => {
                    const cfg = getModel(name);
                    return cfg ? { name, id: cfg.id, displayName: cfg.name } : { name, id: name, displayName: name };
                });
                send(ws, { event: 'models:list', models });
                break;
            }

            default:
                send(ws, { event: 'error', error: `Unknown action: ${msg.action}` });
        }
    }

    // ── Helpers ──────────────────────────────────────

    function _serializeSession(session: Session) {
        const msgs = session.conversation.messages;
        const lastMsg = msgs[msgs.length - 1];
        let lastMessage: string | undefined;
        if (lastMsg) {
            if (typeof lastMsg.content === 'string') {
                lastMessage = lastMsg.content.slice(0, 100);
            } else if (Array.isArray(lastMsg.content)) {
                const textBlock = (lastMsg.content as any[]).find(b => b.type === 'text');
                if (textBlock) lastMessage = textBlock.text?.slice(0, 100);
            }
        }
        return {
            id: session.id,
            agentName: session.agent.constructor.name,
            createdAt: session.createdAt,
            messageCount: msgs.length,
            lastMessage,
            isRunning: session.isRunning,
        };
    }
    /**
     * Convert raw Anthropic API messages into simplified chat messages
     * that the client can render directly with parts.
     */
    function _formatHistory(messages: readonly any[]): any[] {
        const result: any[] = [];

        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                // Simple text message (usually user)
                result.push({
                    role: msg.role,
                    content: msg.content,
                    parts: [{ type: 'text', content: msg.content }],
                    status: 'done',
                });
            } else if (Array.isArray(msg.content)) {
                const blocks = msg.content as any[];

                // Skip user messages that are only tool_results (internal API messages)
                if (msg.role === 'user' && blocks.every(b => b.type === 'tool_result')) {
                    continue;
                }

                const parts: any[] = [];
                let textContent = '';

                for (const block of blocks) {
                    if (block.type === 'text' && block.text) {
                        parts.push({ type: 'text', content: block.text });
                        textContent += block.text;
                    } else if (block.type === 'tool_use') {
                        parts.push({
                            type: 'tool',
                            name: block.name,
                            params: block.input,
                            status: 'done',
                        });
                    } else if (block.type === 'thinking') {
                        parts.push({
                            type: 'thinking',
                            content: block.thinking || '',
                            active: false,
                        });
                    }
                }

                if (parts.length > 0) {
                    result.push({
                        role: msg.role,
                        content: textContent,
                        parts,
                        status: 'done',
                    });
                }
            }
        }

        return result;
    }

    function _resolveAgent(name?: string): Agent {
        if (!name) throw new Error('Missing agent name');
        const agent = agentMap.get(name);
        if (!agent) throw new Error(`Unknown agent: "${name}". Available: ${[...agentMap.keys()].join(', ')}`);
        return agent;
    }

    function _resolveWindow(agentName?: string): Window<any, any> | null {
        if (!agentName) {
            // Return first available window
            const first = windows.values().next();
            return first.done ? null : first.value;
        }
        const agent = agentMap.get(agentName);
        return agent?.window || null;
    }

    /** Persist shared window state to storage after UI-driven mutations */
    function _persistWindow(agentName: string | undefined, win: Window<any, any>) {
        if (!storage) return;
        const winClass = win.constructor.name;
        storage.saveWindow('__shared__', winClass, win.toJSON());
    }

    function _getAgentConfig(agent: Agent) {
        return {
            model: agent.modelConfig.shortName || agent.model,
            modelId: agent.model,
            modelName: agent.modelConfig.name,
            thinking: agent.thinking,
            effort: agent.effort,
            webSearch: !!agent.webSearch,
            maxIterations: agent.maxIterations,
            tools: agent.tools.list().map((t: any) => t.name),
        };
    }

    function _wireAgentEvents(agent: Agent, agentName: string, sessionId: string, broadcast: (data: any) => void): () => void {
        const handlers: [string, (...args: any[]) => void][] = [];
        let accText = '';
        let accThinking = '';

        function on(event: string, handler: (...args: any[]) => void) {
            agent.on(event, handler);
            handlers.push([event, handler]);
        }

        on('text:delta', (data) => {
            accText += data.chunk;
            broadcast({ event: 'chat:text', agent: agentName, sessionId, delta: data.chunk, full: accText });
        });
        on('thinking:delta', (data) => {
            accThinking += data.text;
            broadcast({ event: 'chat:thinking', agent: agentName, sessionId, thinking: accThinking });
        });
        on('tool:execute', (data) => broadcast({ event: 'chat:tool', agent: agentName, sessionId, name: data.name, params: data.params }));
        on('tool:result', (data) => broadcast({ event: 'chat:tool:result', agent: agentName, sessionId, name: data.name, result: data.result, ms: data.ms }));

        return () => {
            for (const [event, handler] of handlers) {
                agent.removeListener(event, handler);
            }
        };
    }

    // ── Public API ──────────────────────────────────

    return {
        broadcast,
        clients,
        close() {
            for (const ws of clients) ws.close();
            wss.close();
        },
    };
}

// ── Session Restoration ─────────────────────────────

function _restoreSessions(
    storage: Storage,
    sessions: Map<string, Session>,
    agentMap: Map<string, Agent>,
    agents: LoadedAgent[],
): void {
    try {
        const savedSessions = storage.listSessions();
        const defaultAgent = agents[0]?.agent;
        if (!defaultAgent) return;

        // Restore shared window state ONCE (before sessions)
        const restoredWindows = new Set<string>();
        for (const a of agents) {
            if (a.agent.window) {
                const winClass = a.agent.window.constructor.name;
                if (!restoredWindows.has(winClass)) {
                    const winData = storage.loadWindow('__shared__', winClass);
                    if (winData) {
                        a.agent.window.loadJSON(winData);
                        restoredWindows.add(winClass);
                    }
                }
            }
        }

        for (const data of savedSessions as any[]) {
            // Find the agent by name, fall back to default
            const agent = agentMap.get(data.agentName) || defaultAgent;
            const session = new Session(agent, { id: data.id });

            // Restore conversation messages
            const messages = storage.loadMessages(data.id);
            if (messages && (messages as any[]).length > 0) {
                session.conversation.loadJSON(messages as any[]);
            }

            sessions.set(data.id, session);
        }

        if (sessions.size > 0) {
            console.log(`  📦 Restored ${sessions.size} session(s) from storage`);
        }
        if (restoredWindows.size > 0) {
            console.log(`  🪟 Restored ${restoredWindows.size} window(s) from storage`);
        }
    } catch (err: any) {
        console.warn(`  ⚠ Failed to restore sessions: ${err.message}`);
    }
}
