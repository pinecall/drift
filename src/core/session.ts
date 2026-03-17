/**
 * Drift — Session
 * 
 * Owns the conversation history. Agents are stateless w.r.t. history —
 * the session provides the conversation at run() time.
 * 
 *   const session = new Session(agent);
 *   await session.run('Hello');
 *   session.swap(otherAgent);   // keep history, switch agent
 *   await session.run('Continue from where we left off');
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { Conversation } from './conversation.ts';
import type { Agent, StreamBuilder } from './agent.ts';
import type { AgentResult } from '../types.ts';

export class Session extends EventEmitter {
    /** Unique session identifier */
    readonly id: string;

    /** Conversation history (owned by this session) */
    readonly conversation: Conversation;

    /** Current active agent */
    private _agent: Agent;

    /** Is the agent currently running in this session? */
    private _isRunning: boolean = false;

    /** Creation timestamp */
    readonly createdAt: number;

    constructor(agent: Agent, options?: { id?: string; maxMessages?: number }) {
        super();
        // Default error handler
        this.on('error', () => {});

        this.id = options?.id || crypto.randomUUID();
        this._agent = agent;
        this.conversation = new Conversation(options?.maxMessages);
        this.createdAt = Date.now();
    }

    // ── Public API ──────────────────────────────────────

    /**
     * Run the current agent with a message, using this session's conversation.
     */
    async run(input: string, options?: { timeout?: number }): Promise<AgentResult> {
        if (this._isRunning) {
            throw new Error(`Session ${this.id} is already running`);
        }

        this._isRunning = true;
        this.emit('started', { agent: this._agent.constructor.name });

        try {
            const result = await this._agent.runWithConversation(input, this.conversation, options);
            this.emit('done', { agent: this._agent.constructor.name, result });
            return result;
        } catch (err: any) {
            this.emit('error', { agent: this._agent.constructor.name, error: err.message });
            throw err;
        } finally {
            this._isRunning = false;
        }
    }

    /**
     * Stream the current agent, using this session's conversation.
     */
    stream(input: string): StreamBuilder {
        if (this._isRunning) {
            throw new Error(`Session ${this.id} is already running`);
        }

        this._isRunning = true;
        this.emit('started', { agent: this._agent.constructor.name });

        const builder = this._agent.streamWithConversation(input, this.conversation);

        // Track completion
        builder.onDone(() => {
            this._isRunning = false;
            this.emit('done', { agent: this._agent.constructor.name });
        });
        builder.onError(() => {
            this._isRunning = false;
        });

        return builder;
    }

    /**
     * Swap the active agent, keeping conversation history.
     */
    swap(newAgent: Agent): void {
        if (this._isRunning) {
            throw new Error('Cannot swap agent while running');
        }

        const oldName = this._agent.constructor.name;
        this._agent = newAgent;
        const newName = newAgent.constructor.name;

        this.emit('swapped', { from: oldName, to: newName });
    }

    /**
     * Abort the current run.
     */
    abort(): void {
        this._agent.abort();
    }

    /**
     * Clear conversation history.
     */
    clear(): void {
        this.conversation.clear();
    }

    // ── Accessors ───────────────────────────────────────

    /** Current active agent */
    get agent(): Agent { return this._agent; }

    /** Is the agent currently running? */
    get isRunning(): boolean { return this._isRunning; }
}
