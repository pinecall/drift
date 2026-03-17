/**
 * Unit Tests — Conversation Trim
 * 
 * Tests smart trim, auto-trim, and orphan cleanup.
 */

import { Conversation } from '../../packages/drift/src/core/conversation.ts';

export const name = 'Conversation Trim';

export const tests = {
    'trim keeps last N messages'(assert: any) {
        const conv = new Conversation(100, false);
        for (let i = 0; i < 20; i++) {
            conv.addUser(`msg ${i}`);
            conv.addAssistant([{ type: 'text', text: `reply ${i}` }]);
        }
        assert.equal(conv.length, 40, 'starts with 40 messages');

        const stats = conv.trim(10);
        assert.ok(stats.after <= 12, `trimmed to ~10 (got ${stats.after})`);
        assert.gt(stats.removed, 0, 'removed some messages');
        assert.equal(stats.before, 40, 'before count correct');
    },

    'trim preserves tool_use/tool_result pairs'(assert: any) {
        const conv = new Conversation(100, false);

        // Turn 1: simple
        conv.addUser('hello');
        conv.addAssistant([{ type: 'text', text: 'hi' }]);

        // Turns 2-10: with tools
        for (let i = 0; i < 9; i++) {
            conv.addUser(`ask ${i}`);
            conv.addAssistant([
                { type: 'text', text: `thinking ${i}` },
                { type: 'tool_use', id: `tool_${i}`, name: 'test', input: {} },
            ]);
            conv.addToolResult(`tool_${i}`, 'test', `result ${i}`);
        }

        const stats = conv.trim(6);
        // After trim: first message must be user role
        const msgs = conv.messages;
        assert.equal(msgs[0].role, 'user', 'starts with user message');

        // No orphan tool_results at start
        const firstContent = msgs[0].content;
        if (Array.isArray(firstContent)) {
            const hasOrphan = (firstContent as any[]).some(b => b.type === 'tool_result');
            assert.ok(!hasOrphan, 'no orphan tool_results at start');
        }
    },

    'trim returns stats when nothing to trim'(assert: any) {
        const conv = new Conversation(100, false);
        conv.addUser('hello');
        conv.addAssistant([{ type: 'text', text: 'hi' }]);

        const stats = conv.trim(10);
        assert.equal(stats.removed, 0, 'nothing removed');
        assert.equal(stats.before, 2);
        assert.equal(stats.after, 2);
    },

    'auto-trim triggers when maxMessages exceeded'(assert: any) {
        const conv = new Conversation(10, true); // max 10, auto-trim on

        for (let i = 0; i < 12; i++) {
            conv.addUser(`msg ${i}`);
        }

        // Should have been auto-trimmed
        assert.ok(conv.length <= 10, `auto-trimmed to <= 10 (got ${conv.length})`);
    },

    'auto-trim disabled does not trim'(assert: any) {
        const conv = new Conversation(10, false); // auto-trim off

        for (let i = 0; i < 15; i++) {
            conv.addUser(`msg ${i}`);
        }

        assert.equal(conv.length, 15, 'no auto-trim when disabled');
    },

    'maxMessages and autoTrim are configurable'(assert: any) {
        const conv = new Conversation();
        assert.equal(conv.maxMessages, 100, 'default maxMessages');
        assert.equal(conv.autoTrim, true, 'default autoTrim');

        conv.maxMessages = 50;
        conv.autoTrim = false;
        assert.equal(conv.maxMessages, 50);
        assert.equal(conv.autoTrim, false);
    },

    'trim ensures first message is user role'(assert: any) {
        const conv = new Conversation(100, false);

        // Add many messages
        for (let i = 0; i < 30; i++) {
            conv.addUser(`msg ${i}`);
            conv.addAssistant([{ type: 'text', text: `reply ${i}` }]);
        }

        conv.trim(4);
        const msgs = conv.messages;
        assert.equal(msgs[0].role, 'user', 'first message is user');
    },
};
