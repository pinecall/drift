/**
 * Integration Tests — TaskBoard (Real API Calls)
 * 
 * Tests TaskBoard end-to-end with real Haiku dispatches.
 * Requires ANTHROPIC_API_KEY env var.
 * 
 * Uses ultra-simple agents so tasks complete fast and reliably:
 * - UpperAgent: convert text to uppercase
 * - ReverseAgent: reverse the input string
 * - SummaryAgent: return word count
 */

import { Agent, TaskBoard } from '../../packages/drift/src/index.ts';
import type { DispatchFn, Card } from '../../packages/drift/src/index.ts';
import { Session } from '../../packages/drift/src/core/session.ts';

export const name = 'Integration — TaskBoard';

// ── Tiny agents ──

class UpperAgent extends Agent {
    model = 'haiku';
    prompt = 'Convert the user message to ALL UPPERCASE. Reply with ONLY the uppercase text, nothing else.';
    thinking = false;
    maxIterations = 1;
}

class ReverseAgent extends Agent {
    model = 'haiku';
    prompt = 'Reverse the user message character by character. Reply with ONLY the reversed text, nothing else. Example: "hello" → "olleh"';
    thinking = false;
    maxIterations = 1;
}

class CountAgent extends Agent {
    model = 'haiku';
    prompt = 'Count the words in the user message. Reply with ONLY the number, nothing else. Example: "hello world" → "2"';
    thinking = false;
    maxIterations = 1;
}

// ── Real dispatch ──

function createRealDispatch(agentMap: Map<string, Agent>): DispatchFn {
    return async (agentName, message, options) => {
        const agent = agentMap.get(agentName);
        if (!agent) throw new Error(`Unknown agent: "${agentName}"`);
        const sid = options?.sessionId || `__dispatch__:${agentName}:${Date.now()}`;
        const session = new Session(agent, { id: sid });
        const result = await session.run(message, { timeout: options?.timeout || 30_000 });
        return {
            text: result.text,
            cost: result.cost,
            toolCalls: result.toolCalls.map(tc => ({ name: tc.name, params: tc.input })),
            sessionId: sid,
            aborted: result.aborted,
        };
    };
}

// ── Tests ──

export const tests = {

    async 'single card: assign → auto-dispatch → result + done'(assert: any) {
        const board = new TaskBoard();
        const dispatch = createRealDispatch(new Map([['upper', new UpperAgent()]]));

        // Manually wire dispatch (in real server this is automatic)
        board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const message = board.buildDispatchMessage(card);
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            if (result?.text) board.setResult(card.id, result.text);
        });

        const card = board.addCard({
            title: 'Uppercase this',
            description: 'Convert "hello world" to uppercase',
            assignee: 'upper',
        });

        // Wait for async dispatch to complete
        await new Promise(resolve => setTimeout(resolve, 15_000));

        const updated = board.get(card.id)!;
        assert.equal(updated.column, 'done', 'card moved to done');
        assert.ok(updated.result, 'result is set');
        assert.includes(updated.result!.toUpperCase(), 'HELLO', 'result contains uppercase text');
    },

    async 'dependency chain: card-2 waits for card-1, receives its context'(assert: any) {
        const board = new TaskBoard();
        const dispatch = createRealDispatch(new Map([
            ['upper', new UpperAgent()],
            ['count', new CountAgent()],
        ]));

        // Wire dispatch
        board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const message = board.buildDispatchMessage(card);
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            if (result?.text) board.setResult(card.id, result.text);
        });

        // Card 1: uppercase "hello world"
        const card1 = board.addCard({
            title: 'Uppercase text',
            description: 'Convert "hello world" to uppercase',
            assignee: 'upper',
        });

        // Card 2: depends on card1, will count words in its result
        const card2 = board.addCard({
            title: 'Count words in result',
            description: 'Count the words in the previous card result',
            assignee: 'count',
            dependsOn: [card1.id],
        });

        // Card2 should be blocked
        assert.ok(board.isBlocked(card2.id), 'card2 is blocked initially');

        // Wait for card1 to finish + card2 to unblock and finish
        await new Promise(resolve => setTimeout(resolve, 25_000));

        const final1 = board.get(card1.id)!;
        const final2 = board.get(card2.id)!;

        assert.equal(final1.column, 'done', 'card1 is done');
        assert.ok(final1.result, 'card1 has result');

        assert.equal(final2.column, 'done', 'card2 is done');
        assert.ok(final2.result, 'card2 has result');
        // Card2 should have received card1's result as context
        assert.ok(final2.result!.match(/\d/), 'card2 result contains a number (word count)');
    },

    async 'human review gate: card pauses at in_review'(assert: any) {
        const board = new TaskBoard();
        const dispatch = createRealDispatch(new Map([['upper', new UpperAgent()]]));

        // Wire dispatch
        board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const message = board.buildDispatchMessage(card);
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            if (result?.text) board.setResult(card.id, result.text);
        });

        const card = board.addCard({
            title: 'Needs review',
            description: 'Convert "test" to uppercase',
            assignee: 'upper',
            requiresHumanReview: true,
        });

        // Wait for dispatch
        await new Promise(resolve => setTimeout(resolve, 15_000));

        const afterAgent = board.get(card.id)!;
        assert.equal(afterAgent.column, 'in_review', 'stopped at in_review (not done)');
        assert.ok(afterAgent.result, 'agent produced result');

        // Simulate human approval
        board.approveCard(card.id);
        assert.equal(board.get(card.id)!.column, 'qa', 'moved to qa after approval');
    },

    async 'reject card: back to todo with reason in context'(assert: any) {
        const board = new TaskBoard();
        const dispatch = createRealDispatch(new Map([['upper', new UpperAgent()]]));

        // Wire dispatch
        board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const message = board.buildDispatchMessage(card);
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            if (result?.text) board.setResult(card.id, result.text);
        });

        const card = board.addCard({
            title: 'Will be rejected',
            description: 'Convert "abc" to uppercase',
            assignee: 'upper',
            requiresHumanReview: true,
        });

        // Wait for dispatch
        await new Promise(resolve => setTimeout(resolve, 15_000));

        assert.equal(board.get(card.id)!.column, 'in_review', 'at in_review');

        // Reject it
        board.rejectCard(card.id, 'Output not good enough');

        const rejected = board.get(card.id)!;
        assert.equal(rejected.column, 'todo', 'back to todo');
        assert.includes(rejected.context!, 'Rejected', 'context has rejection reason');
        assert.includes(rejected.context!, 'not good enough', 'reason text preserved');
    },

    async 'parallel cards: two agents work simultaneously'(assert: any) {
        const board = new TaskBoard();
        const dispatch = createRealDispatch(new Map([
            ['upper', new UpperAgent()],
            ['reverse', new ReverseAgent()],
        ]));

        const startTime = Date.now();

        // Wire dispatch
        board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
            const message = board.buildDispatchMessage(card);
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            if (result?.text) board.setResult(card.id, result.text);
        });

        // Two independent cards — should dispatch in parallel
        const c1 = board.addCard({ title: 'Upper hello', description: 'Convert "hello" to uppercase', assignee: 'upper' });
        const c2 = board.addCard({ title: 'Reverse hello', description: 'Reverse "hello"', assignee: 'reverse' });

        // Wait for both
        await new Promise(resolve => setTimeout(resolve, 20_000));

        const f1 = board.get(c1.id)!;
        const f2 = board.get(c2.id)!;

        assert.equal(f1.column, 'done', 'card1 done');
        assert.equal(f2.column, 'done', 'card2 done');
        assert.ok(f1.result, 'card1 has result');
        assert.ok(f2.result, 'card2 has result');
        assert.includes(f1.result!.toUpperCase(), 'HELLO', 'uppercased');
    },
};
