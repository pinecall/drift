/**
 * Drift — TaskBoard (Kanban Coordination)
 * 
 * Extends Window<Card, BoardState> to provide Kanban-style task management:
 *   - Columns: TODO → IN_PROGRESS → IN_REVIEW → QA → DONE
 *   - Card assignment → auto-dispatch agents
 *   - Dependencies: cards block until deps are DONE
 *   - Human review gates
 *   - Per-card context accumulation
 *   - Auto-advance on completion
 * 
 * Usage:
 *   const board = new TaskBoard();
 *   board.addCard({ title: 'Implement auth', assignee: 'coder' });
 *   board.on('card:assigned', ({ card, agent }) => dispatch(agent, ...));
 */

import { Window } from '../state/window.ts';
import type { DispatchFn } from './trigger.ts';

// ── Types ───────────────────────────────────────────

export const DEFAULT_COLUMNS = ['todo', 'in_progress', 'in_review', 'qa', 'done'] as const;
export type Column = typeof DEFAULT_COLUMNS[number];

export interface Card {
    id: string;
    title: string;
    description?: string;
    column: string;
    assignee?: string;
    dependsOn?: string[];
    requiresHumanReview?: boolean;
    context?: string;
    priority?: number;
    labels?: string[];
    createdAt: number;
    updatedAt: number;
    result?: string;
}

export interface BoardState {
    columns: string[];
    autoAssign: boolean;
    autoAdvance: boolean;
}

export type CardInput = Omit<Card, 'id' | 'column' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    column?: string;
};

// ── TaskBoard ───────────────────────────────────────

let _idCounter = 0;

export class TaskBoard extends Window<Card, BoardState> {
    /** @internal Dispatch function — injected by DriftServer */
    _dispatchFn?: DispatchFn;

    constructor(columns?: string[]) {
        const cols = columns || [...DEFAULT_COLUMNS];
        super({
            columns: cols,
            autoAssign: true,
            autoAdvance: true,
        });
    }

    // ── Card Management ─────────────────────────────

    /**
     * Add a new card. Defaults to 'todo' column.
     * If the card has an assignee + autoAssign is on, emits 'card:assigned'.
     */
    addCard(input: CardInput): Card {
        const now = Date.now();
        const id = input.id || `card-${++_idCounter}-${now.toString(36)}`;
        const card: Card = {
            title: input.title,
            description: input.description,
            column: input.column || 'todo',
            assignee: input.assignee,
            dependsOn: input.dependsOn,
            requiresHumanReview: input.requiresHumanReview,
            context: input.context,
            priority: input.priority ?? 3,
            labels: input.labels,
            createdAt: now,
            updatedAt: now,
            result: input.result,
            id,
        };

        this.add(id, card);

        // Auto-dispatch if assigned + not blocked
        if (card.assignee && this._state.autoAssign && !this.isBlocked(id)) {
            this.emit('card:assigned', { card, agent: card.assignee });
        }

        return card;
    }

    /**
     * Move a card to a different column.
     * Emits 'card:moved'. If moved to DONE, triggers dependency unblocking.
     */
    moveCard(id: string, column: string): void {
        const card = this.get(id);
        if (!card) return;

        const prevColumn = card.column;
        this.update(id, { column, updatedAt: Date.now() } as Partial<Card>);
        this.emit('card:moved', { card: this.get(id)!, from: prevColumn, to: column });

        // If moved to done → unblock dependents
        if (this._isDone(column)) {
            this._unblockDependents(id);
        }
    }

    /**
     * Assign a card to an agent. Emits 'card:assigned' for auto-dispatch.
     */
    assignCard(id: string, agent: string): void {
        const card = this.get(id);
        if (!card) return;

        this.update(id, { assignee: agent, updatedAt: Date.now() } as Partial<Card>);
        const updated = this.get(id)!;

        if (this._state.autoAssign && !this.isBlocked(id)) {
            this.emit('card:assigned', { card: updated, agent });
        }
    }

    /** Unassign a card. */
    unassignCard(id: string): void {
        this.update(id, { assignee: undefined, updatedAt: Date.now() } as Partial<Card>);
    }

    // ── Dependencies ────────────────────────────────

    /** Check if a card is blocked by unfinished dependencies. */
    isBlocked(id: string): boolean {
        const card = this.get(id);
        if (!card?.dependsOn?.length) return false;
        return card.dependsOn.some(depId => {
            const dep = this.get(depId);
            return !dep || !this._isDone(dep.column);
        });
    }

    /** Get cards that are blocking this card. */
    getBlockers(id: string): Card[] {
        const card = this.get(id);
        if (!card?.dependsOn?.length) return [];
        return card.dependsOn
            .map(depId => this.get(depId))
            .filter((dep): dep is Card => !!dep && !this._isDone(dep.column));
    }

    /** Get TODO cards that have all dependencies satisfied. */
    getReady(): Card[] {
        return this.byColumn('todo').filter(card => !this.isBlocked(card.id));
    }

    // ── Context ─────────────────────────────────────

    /** Append text to a card's context (accumulative). */
    appendContext(id: string, text: string): void {
        const card = this.get(id);
        if (!card) return;
        const existing = card.context || '';
        const separator = existing ? '\n\n---\n\n' : '';
        this.update(id, {
            context: existing + separator + text,
            updatedAt: Date.now(),
        } as Partial<Card>);
    }

    /**
     * Set the card's result and auto-advance to the next column.
     * If autoAdvance is on:
     *   - requiresHumanReview → move to 'in_review'
     *   - otherwise → move to 'done'
     */
    setResult(id: string, result: string): void {
        const card = this.get(id);
        if (!card) return;

        this.update(id, { result, updatedAt: Date.now() } as Partial<Card>);

        if (this._state.autoAdvance) {
            if (card.requiresHumanReview) {
                this.moveCard(id, 'in_review');
            } else {
                this.moveCard(id, 'done');
            }
        }
    }

    // ── Human Review ────────────────────────────────

    /** Approve a card — move from in_review to the next column (qa or done). */
    approveCard(id: string): void {
        const card = this.get(id);
        if (!card) return;

        const cols = this._state.columns;
        const reviewIdx = cols.indexOf('in_review');
        const nextCol = reviewIdx >= 0 && reviewIdx < cols.length - 1
            ? cols[reviewIdx + 1]
            : 'done';

        this.moveCard(id, nextCol);
        this.emit('card:approved', { card: this.get(id)! });
    }

    /** Reject a card — move back to todo with optional reason in context. */
    rejectCard(id: string, reason?: string): void {
        const card = this.get(id);
        if (!card) return;

        if (reason) {
            this.appendContext(id, `❌ Rejected: ${reason}`);
        }

        this.moveCard(id, 'todo');
        this.emit('card:rejected', { card: this.get(id)!, reason });
    }

    // ── Queries ─────────────────────────────────────

    /** Get all cards in a specific column. */
    byColumn(column: string): Card[] {
        return this.list().filter(c => c.column === column);
    }

    /** Get all cards assigned to a specific agent. */
    byAssignee(agent: string): Card[] {
        return this.list().filter(c => c.assignee === agent);
    }

    /** Get all blocked cards. */
    blocked(): Card[] {
        return this.list().filter(c => this.isBlocked(c.id));
    }

    /** Get all unblocked cards. */
    unblocked(): Card[] {
        return this.list().filter(c => !this.isBlocked(c.id));
    }

    // ── Prompt Rendering ────────────────────────────

    /** Render board as Kanban XML for agent system prompt. */
    override render(): string {
        const cards = this.list();
        if (cards.length === 0) return '';

        const cols = this._state.columns;
        const sections = cols.map(col => {
            const colCards = cards
                .filter(c => c.column === col)
                .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));

            if (colCards.length === 0) return `  <column name="${col}" count="0" />`;

            const items = colCards.map(c => {
                const attrs: string[] = [`id="${c.id}"`, `priority="${c.priority ?? 3}"`];
                if (c.assignee) attrs.push(`assignee="${c.assignee}"`);
                if (this.isBlocked(c.id)) attrs.push('blocked="true"');
                if (c.requiresHumanReview) attrs.push('human-review="true"');
                if (c.dependsOn?.length) attrs.push(`depends-on="${c.dependsOn.join(',')}"`);
                if (c.labels?.length) attrs.push(`labels="${c.labels.join(',')}"`);

                const body = c.description || c.title;
                return `      <card ${attrs.join(' ')}>${body}</card>`;
            });

            return `  <column name="${col}" count="${colCards.length}">\n${items.join('\n')}\n  </column>`;
        });

        return `\n\n<taskboard count="${cards.length}">\n${sections.join('\n')}\n</taskboard>`;
    }

    // ── Build dispatch message ───────────────────────

    /** Build the message sent to an agent when a card is assigned. */
    buildDispatchMessage(card: Card): string {
        const parts: string[] = [];
        parts.push(`You have been assigned card "${card.title}" [${card.id}].`);

        if (card.description) {
            parts.push(`\nDescription: ${card.description}`);
        }

        if (card.priority !== undefined) {
            const labels: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Lowest' };
            parts.push(`Priority: ${labels[card.priority] || card.priority}`);
        }

        // Include context from dependencies
        if (card.dependsOn?.length) {
            const depContexts = card.dependsOn
                .map(depId => this.get(depId))
                .filter((d): d is Card => !!d && !!d.result)
                .map(d => `--- ${d.title} [${d.id}] ---\n${d.result}`);

            if (depContexts.length > 0) {
                parts.push(`\n<dependency_results>\n${depContexts.join('\n\n')}\n</dependency_results>`);
            }
        }

        // Include card's own context
        if (card.context) {
            parts.push(`\n<card_context>\n${card.context}\n</card_context>`);
        }

        return parts.join('\n');
    }

    // ── Internals ───────────────────────────────────

    /** Check if a column name represents "done" (last column). */
    private _isDone(column: string): boolean {
        const cols = this._state.columns;
        return column === cols[cols.length - 1];
    }

    /** When a card moves to DONE, unblock and potentially dispatch dependent cards. */
    private _unblockDependents(doneCardId: string): void {
        for (const card of this.list()) {
            if (!card.dependsOn?.includes(doneCardId)) continue;
            if (this.isBlocked(card.id)) continue;  // still has other blockers

            // This card just became unblocked
            this.emit('card:unblocked', { card });

            // If it's in TODO and has an assignee, auto-dispatch
            if (card.column === 'todo' && card.assignee && this._state.autoAssign) {
                this.emit('card:assigned', { card, agent: card.assignee });
            }
        }
    }
}
