/**
 * Drift — Conversation (message history management)
 * 
 * Features:
 *   - Message dedup, tool result grouping
 *   - Smart trim that preserves tool_use/tool_result pairs
 *   - Auto-trim when maxMessages exceeded
 *   - Orphan cleanup post-trim
 */

import type { Message, ContentBlock, ToolResultBlock } from '../types.ts';

export interface TrimStats {
    before: number;
    after: number;
    removed: number;
}

export class Conversation {
    private history: Message[] = [];
    private _maxMessages: number;
    private _autoTrim: boolean;

    constructor(maxMessages: number = 100, autoTrim: boolean = true) {
        this._maxMessages = maxMessages;
        this._autoTrim = autoTrim;
    }

    // ── Add Messages ────────────────────────────────────

    /**
     * Add a user message.
     */
    addUser(text: string): void {
        // Dedup: skip consecutive identical user messages
        const last = this.history[this.history.length - 1];
        if (last?.role === 'user' && last.content === text) return;

        this.history.push({ role: 'user', content: text });
        this._autoTrimIfNeeded();
    }

    /**
     * Add an assistant message with content blocks.
     */
    addAssistant(content: ContentBlock[]): void {
        if (content.length === 0) return;
        this.history.push({ role: 'assistant', content });
        this._autoTrimIfNeeded();
    }

    /**
     * Add a tool result.
     * Groups multiple tool results from the same turn into one user message.
     */
    addToolResult(toolUseId: string, name: string, result: string, isError: boolean = false): void {
        const block: ToolResultBlock = {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: result,
        };
        if (isError) block.is_error = true;

        // If last message is user with tool_results, append to same message
        const last = this.history[this.history.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content) &&
            (last.content as ContentBlock[]).every(b => b.type === 'tool_result')) {
            (last.content as ContentBlock[]).push(block);
        } else {
            this.history.push({ role: 'user', content: [block] });
        }
        this._autoTrimIfNeeded();
    }

    // ── Build ───────────────────────────────────────────

    /**
     * Build messages for API call.
     * Ensures: first message is user role.
     */
    buildMessages(): Message[] {
        if (this.history.length === 0) {
            return [{ role: 'user', content: '[conversation continued]' }];
        }

        const messages = [...this.history];

        // Ensure first message is user
        if (messages[0]?.role !== 'user') {
            messages.unshift({ role: 'user', content: '[conversation continued]' });
        }

        return messages;
    }

    // ── Smart Trim ──────────────────────────────────────

    /**
     * Smart trim — keeps the last N messages while preserving
     * tool_use/tool_result pairs (never orphans them).
     * 
     * Rules:
     *   1. Can't start on a tool_result message (orphan)
     *   2. Can't start on an assistant with tool_use (needs its result after)
     *   3. Must start on a user text message (API requires first = user)
     *   4. Post-trim cleanup removes any orphan tool_results
     * 
     * @param keepCount Number of messages to keep (default: 10)
     * @returns Stats about what was trimmed
     */
    trim(keepCount: number = 10): TrimStats {
        if (this.history.length <= keepCount) {
            return { before: this.history.length, after: this.history.length, removed: 0 };
        }

        const beforeCount = this.history.length;
        let startIdx = Math.max(0, this.history.length - keepCount);

        // Walk backwards past tool_result messages — can't orphan them
        while (startIdx > 0) {
            const msg = this.history[startIdx];
            if (this._isToolResultMessage(msg)) {
                startIdx--;
            } else {
                break;
            }
        }

        // If we landed on an assistant with tool_use, include its pair
        if (startIdx > 0 && this.history[startIdx].role === 'assistant' && Array.isArray(this.history[startIdx].content)) {
            const hasToolUse = (this.history[startIdx].content as ContentBlock[]).some(
                b => b.type === 'tool_use'
            );
            if (hasToolUse) {
                // Try to include the user message before it
                startIdx--;
            }
        }

        // If we still landed on an assistant, skip forward past it + its tool_results
        if (this.history[startIdx]?.role === 'assistant') {
            startIdx++;
            while (startIdx < this.history.length && this._isToolResultMessage(this.history[startIdx])) {
                startIdx++;
            }
        }

        // Final safety: ensure we start on a user message
        while (startIdx < this.history.length && this.history[startIdx].role !== 'user') {
            startIdx++;
        }

        this.history = this.history.slice(startIdx);

        // Post-trim: remove orphan tool_results at the start
        this._removeOrphanToolResults();

        return {
            before: beforeCount,
            after: this.history.length,
            removed: beforeCount - this.history.length,
        };
    }

    // ── Auto-trim ───────────────────────────────────────

    /**
     * Auto-trim when history exceeds maxMessages.
     * Keeps ~75% of maxMessages to avoid trimming on every message.
     */
    private _autoTrimIfNeeded(): void {
        if (!this._autoTrim) return;
        if (this.history.length <= this._maxMessages) return;

        // Trim to 75% of max to create some runway
        const keepCount = Math.floor(this._maxMessages * 0.75);
        this.trim(keepCount);
    }

    // ── Helpers ─────────────────────────────────────────

    /**
     * Check if a message is a user message containing only tool_results.
     */
    private _isToolResultMessage(msg: Message): boolean {
        return msg.role === 'user' &&
            Array.isArray(msg.content) &&
            (msg.content as ContentBlock[]).some(b => b.type === 'tool_result');
    }

    /**
     * Remove orphan tool_result messages from the start of history.
     * An orphan is a tool_result whose tool_use_id doesn't match
     * any tool_use in the preceding assistant message.
     */
    private _removeOrphanToolResults(): void {
        while (this.history.length > 0) {
            const first = this.history[0];
            if (this._isToolResultMessage(first)) {
                this.history.shift();
            } else {
                break;
            }
        }
    }

    // ── Public API ──────────────────────────────────────

    /**
     * Clear history.
     */
    clear(): void {
        this.history = [];
    }

    // ── Serialization ──────────────────────────────────

    /** Serialize messages for persistence. */
    toJSON(): Message[] {
        return [...this.history];
    }

    /** Restore messages from persistence. */
    loadJSON(messages: Message[]): void {
        this.history = [...messages];
    }

    /**
     * Get/set max messages.
     */
    get maxMessages(): number { return this._maxMessages; }
    set maxMessages(val: number) { this._maxMessages = val; }

    /**
     * Get/set auto-trim.
     */
    get autoTrim(): boolean { return this._autoTrim; }
    set autoTrim(val: boolean) { this._autoTrim = val; }

    /**
     * Get message count.
     */
    get length(): number {
        return this.history.length;
    }

    /**
     * Get raw history (for inspection).
     */
    get messages(): readonly Message[] {
        return this.history;
    }
}
