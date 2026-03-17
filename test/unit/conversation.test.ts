/**
 * Unit Tests — Conversation
 * 
 * Tests message management, dedup, tool result grouping, and buildMessages.
 */

import { Conversation } from '../../packages/drift/src/core/conversation.ts';

export const name = 'Conversation';

export const tests = {
    'addUser + addAssistant + buildMessages'(assert: any) {
        const conv = new Conversation();
        conv.addUser('hello');
        conv.addAssistant([{ type: 'text', text: 'hi there' }]);
        const msgs = conv.buildMessages();
        assert.equal(msgs.length, 2);
        assert.equal(msgs[0].role, 'user');
        assert.equal(msgs[1].role, 'assistant');
    },

    'addToolResult groups into one user message'(assert: any) {
        const conv = new Conversation();
        conv.addUser('do stuff');
        conv.addAssistant([
            { type: 'text', text: 'ok' },
            { type: 'tool_use', id: 't1', name: 'list_dir', input: {} },
            { type: 'tool_use', id: 't2', name: 'grep', input: {} },
        ]);
        conv.addToolResult('t1', 'list_dir', 'result1');
        conv.addToolResult('t2', 'grep', 'result2');

        const msgs = conv.buildMessages();
        const lastMsg = msgs[msgs.length - 1];
        assert.equal(lastMsg.role, 'user');
        const toolResults = (lastMsg.content as any[]).filter((b: any) => b.type === 'tool_result');
        assert.equal(toolResults.length, 2, 'both tool results in one message');
    },

    'buildMessages enforces user-first'(assert: any) {
        const conv = new Conversation();
        const msgs = conv.buildMessages();
        assert.equal(msgs[0].role, 'user', 'first message must be user');
    },

    'addUser deduplicates consecutive identical messages'(assert: any) {
        const conv = new Conversation();
        conv.addUser('same');
        conv.addUser('same');
        assert.equal(conv.length, 1, 'duplicate not added');
    },

    'addUser allows different messages'(assert: any) {
        const conv = new Conversation();
        conv.addUser('first');
        conv.addAssistant([{ type: 'text', text: 'reply' }]);
        conv.addUser('second');
        assert.equal(conv.length, 3, 'different messages added');
    },

    'clear resets history'(assert: any) {
        const conv = new Conversation();
        conv.addUser('hello');
        conv.addAssistant([{ type: 'text', text: 'hi' }]);
        conv.clear();
        assert.equal(conv.length, 0, 'history cleared');
    },

    'addToolResult with error flag'(assert: any) {
        const conv = new Conversation();
        conv.addUser('do stuff');
        conv.addAssistant([
            { type: 'tool_use', id: 't1', name: 'test', input: {} },
        ]);
        conv.addToolResult('t1', 'test', 'Error: file not found', true);

        const msgs = conv.buildMessages();
        const lastMsg = msgs[msgs.length - 1];
        const block = (lastMsg.content as any[]).find((b: any) => b.type === 'tool_result');
        assert.ok(block.is_error, 'error flag set');
    },

    'buildMessages returns readonly copy of messages'(assert: any) {
        const conv = new Conversation();
        conv.addUser('hello');
        const msgs = conv.messages;
        assert.equal(msgs.length, 1);
        assert.equal(msgs[0].role, 'user');
    },
};
