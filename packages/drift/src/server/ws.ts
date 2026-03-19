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
 *   dispatch:run — Programmatic agent dispatch
 *   trigger:list, trigger:enable, trigger:disable — Trigger management
 *   pipeline:run, pipeline:list — Pipeline execution
 *   window:* — Window CRUD
 *   agents:list, agents:detail — Agent queries
 *   models:list — Available model catalog
 */

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Agent } from '../core/agent.ts';
import { Session } from '../core/session.ts';
import type { Window } from '../state/window.ts';
import type { Workspace } from '../state/workspace.ts';
import type { TaskBoard, Card } from '../coordination/taskboard.ts';
import { CodebaseWindow } from '../windows/codebase-window.tsx';
import type { LoadedAgent } from './config.ts';
import { listModels, getModel } from '../provider/models.ts';
import type { Effort } from '../types.ts';
import type { Storage } from '../storage/storage.ts';
import { NoAuth, type DriftAuth, type DriftUser } from '../auth/auth.ts';
import { TriggerManager, type DispatchFn, type DispatchResult, type DispatchOptions } from '../coordination/trigger.ts';
import { PipelineManager } from '../coordination/pipeline.ts';

// ── Debug Logger ────────────────────────────────────

const DEBUG = !!process.env.DRIFT_DEBUG;

function _debugLog(direction: '←' | '→' | '⚡' | '🔔', label: string, data?: any) {
    if (!DEBUG) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const colors: Record<string, string> = { '←': '\x1b[36m', '→': '\x1b[32m', '⚡': '\x1b[33m', '🔔': '\x1b[35m' };
    const reset = '\x1b[0m';
    const color = colors[direction] || '';
    const summary = data ? _summarize(data) : '';
    console.log(`${color}[${ts}] ${direction} ${label}${reset}${summary ? ` ${summary}` : ''}`);
}

function _summarize(data: any): string {
    if (!data) return '';
    const parts: string[] = [];
    if (data.action) parts.push(`action=${data.action}`);
    if (data.event) parts.push(`event=${data.event}`);
    if (data.agent) parts.push(`agent=${data.agent}`);
    if (data.sessionId) parts.push(`sid=${String(data.sessionId).slice(0, 12)}`);
    if (data.message) parts.push(`msg="${String(data.message).slice(0, 60)}"`);
    if (data.windowClass) parts.push(`win=${data.windowClass}`);
    if (data.id) parts.push(`id=${data.id}`);
    if (data.error) parts.push(`err="${String(data.error).slice(0, 60)}"`);
    return parts.length ? `{ ${parts.join(', ')} }` : '';
}

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
    workspace?: Workspace<any>,
    taskboard?: TaskBoard,
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
        _debugLog('→', `BROADCAST (${clients.size} clients)`, data);
        const msg = JSON.stringify(data);
        for (const ws of clients) {
            if (ws.readyState === 1) ws.send(msg);
        }
    }

    function send(ws: WebSocket, data: any) {
        _debugLog('→', 'SEND', data);
        if (ws.readyState === 1) ws.send(JSON.stringify(data));
    }

    // ── Wire window change events → broadcast ──────

    for (const [className, window] of windows) {
        window.on('change', (event) => {
            broadcast({ event: 'window:changed', windowClass: className, ...event });
            // Evaluate triggers against window changes
            triggerManager.evaluate('window', event);
        });
    }

    // ── Wire workspace change events → broadcast + debounced persist ──

    let _workspacePersistTimer: ReturnType<typeof setTimeout> | null = null;
    if (workspace) {
        workspace.on('change', (event) => {
            broadcast({ event: 'workspace:changed', name: workspace.name, ...event });
            // Debounced persistence — broadcast is instant, SQLite write max 1x/100ms
            if (storage) {
                if (_workspacePersistTimer) clearTimeout(_workspacePersistTimer);
                _workspacePersistTimer = setTimeout(() => _persistWorkspace(), 100);
            }
            // Evaluate triggers against workspace changes
            triggerManager.evaluate('workspace', event);
        });
    }

    // ── Trigger Manager ─────────────────────────────

    const triggerManager = new TriggerManager();
    triggerManager.on('fired', (data) => {
        broadcast({ event: 'trigger:fired', trigger: data.trigger, source: data.source });
    });

    // Pipeline manager
    const pipelineManager = new PipelineManager();
    pipelineManager.on('started', (data) => {
        broadcast({ event: 'pipeline:started', ...data });
    });
    pipelineManager.on('step', (data) => {
        broadcast({ event: 'pipeline:step', ...data });
    });
    pipelineManager.on('done', (data) => {
        broadcast({ event: 'pipeline:done', ...data });
    });
    pipelineManager.on('error', (data) => {
        broadcast({ event: 'pipeline:error', ...data });
    });

    // ── Dispatch (inter-agent coordination primitive) ──

    /**
     * Dispatch an agent to perform a task.
     * Creates an internal Session, runs the agent, and returns the result.
     * Used by: triggers, agents (via dispatch_agent tool), and the UI (dispatch:run).
     */
    const dispatch: DispatchFn = async (
        agentName: string,
        message: string,
        options?: DispatchOptions,
    ): Promise<DispatchResult> => {
        return _dispatchImpl(agentName, message, options);
    };

    let _dispatchNonceCounter = 0;
    const _dispatchContext = new AsyncLocalStorage<{ nonce: number }>();

    const _dispatchImpl = async (
        agentName: string,
        message: string,
        options?: DispatchOptions,
    ): Promise<DispatchResult> => {
        const agent = _resolveAgent(agentName);
        const sid = options?.sessionId || `__dispatch__:${agentName}:${Date.now()}`;
        const silent = options?.silent ?? false;
        const source = options?.source || 'dispatch';

        // Unique nonce for this dispatch — used to isolate concurrent streams
        const nonce = ++_dispatchNonceCounter;

        // Get or create session
        let session = sessions.get(sid);
        if (!session) {
            session = new Session(agent, { id: sid });
            sessions.set(sid, session);
        }

        // Broadcast start
        if (!silent) {
            broadcast({ event: 'dispatch:started', agent: agentName, sessionId: sid, source });
        }

        // Wire agent events → broadcast (unless silent)
        const runId = _claimAgentRun(agentName);
        const cleanup = _wireAgentEvents(
            agent, agentName, sid,
            silent ? () => {} : broadcast,
            runId,
            options?.streamTo,
            nonce,
        );

        try {
            // Prepend timestamp + source context
            const now = new Date();
            const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            const stamped = `[${ts}] [dispatch from ${source}] ${message}`;

            // Run inside AsyncLocalStorage context for nonce isolation
            const result = await _dispatchContext.run({ nonce }, () =>
                session!.run(stamped, { timeout: options?.timeout })
            );

            // Broadcast done
            if (!silent) {
                broadcast({
                    event: 'dispatch:done',
                    agent: agentName,
                    sessionId: sid,
                    source,
                    result: { text: result.text?.slice(0, 500), cost: result.cost },
                });
            }

            // Persist
            if (storage) {
                storage.saveSession(session.toJSON());
                storage.saveMessages(sid, session.conversation.toJSON());
                if (agent.window) {
                    const winClass = agent.window.constructor.name;
                    storage.saveWindow(sid, winClass, agent.window.toJSON());
                }
            }

            return {
                text: result.text,
                cost: result.cost,
                toolCalls: result.toolCalls.map(tc => ({ name: tc.name, params: tc.input })),
                sessionId: sid,
                aborted: result.aborted,
            };
        } catch (err: any) {
            if (!silent) {
                broadcast({ event: 'dispatch:error', agent: agentName, sessionId: sid, source, error: err.message });
            }
            throw err;
        } finally {
            cleanup();
        }
    };

    // Inject dispatch into all canDispatch agents
    for (const { agent } of agents) {
        if (agent.canDispatch) {
            agent._dispatchFn = dispatch;
        }
    }

    // ── TaskBoard event wiring ─────────────────────

    if (taskboard) {
        // Inject dispatch function
        taskboard._dispatchFn = dispatch;

        // Inject taskboard into agents
        for (const { agent } of agents) {
            agent.taskboard = taskboard;
        }

        // Auto-dispatch on card assignment
        taskboard.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const agentObj = agentMap.get(agentName);
            if (!agentObj) return;

            const message = taskboard.buildDispatchMessage(card);

            // Create per-card window if agent uses CodebaseWindow
            if (!card.window && agentObj.window instanceof CodebaseWindow) {
                card.window = new CodebaseWindow({ cwd: (agentObj.window as CodebaseWindow).cwd });
            }

            // Inherit files from done dependencies
            if (card.dependsOn?.length && card.window) {
                for (const depId of card.dependsOn) {
                    const dep = taskboard.get(depId);
                    if (dep?.window) {
                        for (const file of dep.window.list()) {
                            if (!card.window.has(file.id)) {
                                card.window.open((file as any).fullPath);
                            }
                        }
                    }
                }
            }

            // Swap agent's window to this card's window during dispatch
            const originalWindow = agentObj.window;
            if (card.window) agentObj.window = card.window;

            try {
                taskboard.moveCard(card.id, 'in_progress');
                const result = await dispatch(agentName, message, {
                    source: `board:${card.id}`,
                    silent: false,
                });

                // Smart auto-advance: only if agent didn't move card manually
                const current = taskboard.get(card.id);
                if (current?.column === 'in_progress' && result?.text) {
                    taskboard.setResult(card.id, result.text);
                }
            } catch (err: any) {
                taskboard.appendContext(card.id, `\u274c Error: ${err.message}`);
                taskboard.moveCard(card.id, 'todo');
            } finally {
                // Restore agent's original window
                agentObj.window = originalWindow;
            }
        });

        // Broadcast all board changes
        taskboard.on('change', (event: any) => {
            broadcast({ event: 'board:changed', ...event });
        });

        // Broadcast specific board events
        for (const evt of ['card:moved', 'card:unblocked', 'card:approved', 'card:rejected', 'card:removed', 'card:updated']) {
            taskboard.on(evt, (data: any) => {
                broadcast({ event: `board:${evt.replace('card:', '')}`, ...data });
            });
        }
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

        // Send current workspace state
        if (workspace) {
            send(ws, {
                event: 'workspace:changed',
                name: workspace.name,
                action: 'sync',
                state: workspace.state,
                windowNames: workspace.windowNames,
            });
        }

        // Send current board state
        if (taskboard) {
            send(ws, {
                event: 'board:changed',
                action: 'sync',
                items: taskboard.list(),
                state: taskboard.state,
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
        _debugLog('←', `CLIENT ${msg.action}`, msg);
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
                const runId = _claimAgentRun(agentName);
                const cleanup = _wireAgentEvents(agent, agentName, sessionId, broadcast, runId);

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
                const runId = _claimAgentRun(agentName);
                const cleanup = _wireAgentEvents(agent, agentName, sessionId, broadcast, runId);
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

            // ── Threads (contextual mini-chats) ─────

            case 'thread:send': {
                const agentName = msg.agent || '';
                const agent = _resolveAgent(agentName);
                const threadSessionId = msg.sessionId || '';
                const threadContext = msg.context || '';
                const threadSystem = msg.system || '';

                // Get or create thread session
                let session = sessions.get(threadSessionId);
                let isNewSession = false;
                if (!session) {
                    session = new Session(agent, { id: threadSessionId });
                    sessions.set(threadSessionId, session);
                    isNewSession = true;
                }

                // Auto-abort if running
                if (session.isRunning) {
                    session.abort();
                    for (let i = 0; i < 40 && session.isRunning; i++) {
                        await new Promise(r => setTimeout(r, 50));
                    }
                }

                // Build the message with thread context
                const now = new Date();
                const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                const contextPrefix = threadContext ? `[THREAD context: ${threadContext}]\n` : '';
                const systemSuffix = threadSystem ? `\n[Thread instruction: ${threadSystem}]` : '';
                const fullMessage = `${contextPrefix}[${ts}] ${msg.message}${systemSuffix}`;

                // Optional model override
                const originalModel = agent.model;
                if (msg.model) agent.model = msg.model;

                // Wire events & run (claim agent run to prevent event bleed)
                const runId = _claimAgentRun(agentName);
                const cleanup = _wireAgentEvents(agent, agentName, threadSessionId, broadcast, runId);
                broadcast({ event: 'chat:started', agent: agentName, sessionId: threadSessionId });

                try {
                    const result = await session.run(fullMessage);
                    broadcast({ event: 'chat:done', agent: agentName, sessionId: threadSessionId, result: { text: result.text, cost: result.cost } });
                } catch (err: any) {
                    broadcast({ event: 'chat:error', agent: agentName, sessionId: threadSessionId, error: err.message });
                } finally {
                    cleanup();
                    if (msg.model) agent.model = originalModel;

                    // Persist thread session & messages
                    if (storage && session) {
                        storage.saveSession(session.toJSON());
                        storage.saveMessages(threadSessionId, session.conversation.toJSON());
                    }
                    broadcast({ event: 'sessions:updated', session: _serializeSession(session!) });
                }

                if (isNewSession) {
                    broadcast({ event: 'sessions:created', session: _serializeSession(session!) });
                }
                break;
            }

            case 'thread:history': {
                const threadSessionId = msg.sessionId || '';
                const session = sessions.get(threadSessionId);
                if (session) {
                    send(ws, {
                        event: 'chat:history',
                        sessionId: threadSessionId,
                        agent: msg.agent,
                        messages: _formatHistory(session.conversation.messages),
                    });
                } else {
                    // No history yet — empty
                    send(ws, {
                        event: 'chat:history',
                        sessionId: threadSessionId,
                        agent: msg.agent,
                        messages: [],
                    });
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

            // ── Workspace ─────────────────────────────

            case 'workspace:setState': {
                if (workspace && msg.patch) {
                    workspace.setState(msg.patch);
                }
                break;
            }

            // ── TaskBoard ──────────────────────────────

            case 'board:addCard': {
                if (taskboard && msg.card) {
                    const card = taskboard.addCard(msg.card);
                    send(ws, { event: 'board:cardAdded', card });
                }
                break;
            }

            case 'board:moveCard': {
                if (taskboard && msg.id && msg.column) {
                    taskboard.moveCard(msg.id, msg.column);
                }
                break;
            }

            case 'board:assignCard': {
                if (taskboard && msg.id && msg.agent) {
                    taskboard.assignCard(msg.id, msg.agent);
                }
                break;
            }

            case 'board:approveCard': {
                if (taskboard && msg.id) {
                    taskboard.approveCard(msg.id);
                }
                break;
            }

            case 'board:rejectCard': {
                if (taskboard && msg.id) {
                    taskboard.rejectCard(msg.id, msg.reason);
                }
                break;
            }

            case 'board:list': {
                if (taskboard) {
                    send(ws, { event: 'board:list', ...taskboard.serializeBoard() });
                }
                break;
            }

            case 'board:getCard': {
                if (taskboard && msg.id) {
                    const card = taskboard.get(msg.id);
                    if (card) {
                        send(ws, { event: 'board:card', card: taskboard.serializeCard(card) });
                    } else {
                        send(ws, { event: 'board:card', card: null, error: 'Card not found' });
                    }
                }
                break;
            }

            case 'board:addComment': {
                if (taskboard && msg.id && msg.text) {
                    taskboard.appendContext(msg.id, msg.text);
                    const card = taskboard.get(msg.id);
                    if (card) {
                        broadcast({ event: 'board:commented', card: taskboard.serializeCard(card), text: msg.text });
                    }
                }
                break;
            }

            case 'board:updateCard': {
                if (taskboard && msg.id) {
                    const fields: Record<string, any> = {};
                    for (const key of ['title', 'description', 'priority', 'labels', 'assignee', 'requiresHumanReview']) {
                        if (msg[key] !== undefined) fields[key] = msg[key];
                    }
                    const updated = taskboard.updateCard(msg.id, fields);
                    if (updated) {
                        send(ws, { event: 'board:card', card: taskboard.serializeCard(updated) });
                    }
                }
                break;
            }

            case 'board:removeCard': {
                if (taskboard && msg.id) {
                    const ok = taskboard.removeCard(msg.id);
                    if (ok) {
                        broadcast({ event: 'board:removed', id: msg.id });
                    }
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

            // ── Dispatch ────────────────────────

            case 'dispatch:run': {
                const agentName = msg.agent || '';
                const message = msg.message || '';
                if (!agentName || !message) {
                    send(ws, { event: 'error', error: 'dispatch:run requires agent and message' });
                    return;
                }
                try {
                    const result = await dispatch(agentName, message, {
                        silent: msg.silent,
                        timeout: msg.timeout,
                        source: 'ui',
                    });
                    send(ws, { event: 'dispatch:result', agent: agentName, result });
                } catch (err: any) {
                    send(ws, { event: 'dispatch:error', agent: agentName, error: err.message });
                }
                break;
            }

            // ── Triggers ───────────────────────

            case 'trigger:list': {
                const triggers = triggerManager.list().map(t => ({
                    name: t.name || t.constructor.name,
                    watch: t.watch,
                    cooldown: t.cooldown,
                    enabled: t.enabled,
                }));
                send(ws, { event: 'trigger:list', triggers });
                break;
            }

            case 'trigger:enable': {
                if (msg.name) triggerManager.enable(msg.name);
                break;
            }

            case 'trigger:disable': {
                if (msg.name) triggerManager.disable(msg.name);
                break;
            }

            // ── Pipelines ─────────────────────

            case 'pipeline:list': {
                const pipes = pipelineManager.list().map(p => ({
                    name: p.name || p.constructor.name,
                    steps: p.steps.map((s: any) => typeof s === 'string' ? s : s.agent),
                }));
                send(ws, { event: 'pipeline:list', pipelines: pipes });
                break;
            }

            case 'pipeline:run': {
                const { pipeline: pName, input, silent } = msg;
                if (!pName || !input) {
                    send(ws, { event: 'error', error: 'pipeline:run requires { pipeline, input }' });
                    break;
                }
                // Run async
                pipelineManager.run(pName, input, { silent, source: 'ui' }).then(result => {
                    send(ws, { event: 'pipeline:result', pipeline: pName, result });
                }).catch(err => {
                    send(ws, { event: 'pipeline:error', pipeline: pName, error: err.message });
                });
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

    /** Persist workspace state to storage (debounced — called from change listener) */
    function _persistWorkspace() {
        if (!storage || !workspace) return;
        storage.saveWorkspace(workspace.name, workspace.toJSON());
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

    // Track active run per agent to prevent event bleed between concurrent sessions
    const _agentRunIds = new Map<string, number>();
    let _runIdCounter = 0;

    /** Claim a run slot for this agent. Returns a runId. Only the holder of the current runId should emit events. */
    function _claimAgentRun(agentName: string): number {
        const runId = ++_runIdCounter;
        _agentRunIds.set(agentName, runId);
        return runId;
    }

    function _wireAgentEvents(agent: Agent, agentName: string, sessionId: string, broadcast: (data: any) => void, runId?: number, streamTo?: { itemId: string; field: string }, nonce?: number): () => void {
        const handlers: [string, (...args: any[]) => void][] = [];
        let accText = '';
        let accThinking = '';

        // Gate: only forward events that belong to THIS dispatch
        // Uses AsyncLocalStorage context to identify which dispatch emitted the event
        const isActive = () => {
            if (nonce !== undefined) {
                const ctx = _dispatchContext.getStore();
                if (ctx) return ctx.nonce === nonce;
            }
            return runId === undefined || _agentRunIds.get(agentName) === runId;
        };

        function on(event: string, handler: (...args: any[]) => void) {
            agent.on(event, handler);
            handlers.push([event, handler]);
        }

        on('text:delta', (data) => {
            if (!isActive()) return;
            accText += data.chunk;
            broadcast({ event: 'chat:text', agent: agentName, sessionId, delta: data.chunk, full: accText, ...(streamTo ? { streamTo } : {}) });
        });
        on('thinking:delta', (data) => {
            if (!isActive()) return;
            accThinking += data.text;
            broadcast({ event: 'chat:thinking', agent: agentName, sessionId, thinking: accThinking });
        });
        on('tool:execute', (data) => {
            if (!isActive()) return;
            broadcast({ event: 'chat:tool', agent: agentName, sessionId, name: data.name, params: data.params });
        });
        on('tool:result', (data) => {
            if (!isActive()) return;
            broadcast({ event: 'chat:tool:result', agent: agentName, sessionId, name: data.name, result: data.result, ms: data.ms });
        });

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
        dispatch,
        triggerManager,
        pipelineManager,
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
