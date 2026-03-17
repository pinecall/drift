/**
 * Unit Tests — Storage (SQLite)
 * 
 * Tests the pluggable persistence layer: SQLiteStorage and Conversation serialization.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SQLiteStorage } from '../../packages/drift/src/core/sqlite-storage.ts';
import { Conversation } from '../../packages/drift/src/core/conversation.ts';
import type { SessionData } from '../../packages/drift/src/core/storage.ts';

export const name = 'Storage';

const TEST_DB = '/tmp/drift-test-storage.db';

function freshStorage(): SQLiteStorage {
    // Clean up any existing test DB
    try { fs.unlinkSync(TEST_DB); } catch {}
    try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
    try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
    return new SQLiteStorage(TEST_DB);
}

export const tests = {
    // ── Session CRUD ──

    'save and load session'(assert: any) {
        const s = freshStorage();
        const data: SessionData = { id: 'sess-1', agentName: 'TestAgent', createdAt: 1000, updatedAt: 2000 };
        s.saveSession(data);
        const loaded = s.loadSession('sess-1');
        assert.ok(loaded, 'session should exist');
        assert.equal(loaded!.id, 'sess-1');
        assert.equal(loaded!.agentName, 'TestAgent');
        assert.equal(loaded!.createdAt, 1000);
        assert.equal(loaded!.updatedAt, 2000);
        s.close();
    },

    'list sessions returns all saved sessions'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'a', agentName: 'A', createdAt: 100, updatedAt: 300 });
        s.saveSession({ id: 'b', agentName: 'B', createdAt: 200, updatedAt: 200 });
        const list = s.listSessions();
        assert.equal(list.length, 2);
        // Ordered by updated_at DESC
        assert.equal(list[0].id, 'a');
        assert.equal(list[1].id, 'b');
        s.close();
    },

    'delete session removes session and related data'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'del-1', agentName: 'X', createdAt: 0, updatedAt: 0 });
        s.saveMessages('del-1', [{ role: 'user', content: 'hello' }]);
        s.saveWindow('del-1', 'TestWindow', { items: [], state: {} });

        s.deleteSession('del-1');
        assert.ok(!s.loadSession('del-1'), 'session should be deleted');
        assert.equal(s.loadMessages('del-1').length, 0, 'messages should be deleted');
        assert.ok(!s.loadWindow('del-1', 'TestWindow'), 'window state should be deleted');
        s.close();
    },

    'load nonexistent session returns null'(assert: any) {
        const s = freshStorage();
        assert.ok(!s.loadSession('nope'));
        s.close();
    },

    // ── Messages ──

    'save and load messages'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'msg-1', agentName: 'A', createdAt: 0, updatedAt: 0 });
        const messages = [
            { role: 'user' as const, content: 'Hello' },
            { role: 'assistant' as const, content: [{ type: 'text', text: 'Hi there!' }] },
            { role: 'user' as const, content: 'How are you?' },
        ];
        s.saveMessages('msg-1', messages);

        const loaded = s.loadMessages('msg-1');
        assert.equal(loaded.length, 3);
        assert.equal(loaded[0].role, 'user');
        assert.equal(loaded[0].content, 'Hello');
        assert.equal(loaded[1].role, 'assistant');
        assert.ok(Array.isArray(loaded[1].content), 'assistant content should be array');
        assert.equal((loaded[1].content as any)[0].text, 'Hi there!');
        assert.equal(loaded[2].content, 'How are you?');
        s.close();
    },

    'save messages replaces existing'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'repl-1', agentName: 'A', createdAt: 0, updatedAt: 0 });
        s.saveMessages('repl-1', [{ role: 'user', content: 'first' }]);
        s.saveMessages('repl-1', [{ role: 'user', content: 'second' }, { role: 'assistant', content: [{ type: 'text', text: 'reply' }] }]);

        const loaded = s.loadMessages('repl-1');
        assert.equal(loaded.length, 2);
        assert.equal(loaded[0].content, 'second');
        s.close();
    },

    // ── Window State ──

    'save and load window state'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'win-1', agentName: 'A', createdAt: 0, updatedAt: 0 });
        const windowData = {
            items: [['task-1', { id: 'task-1', title: 'Test', status: 'todo' }]],
            state: { filter: 'all' },
            turn: 5,
        };
        s.saveWindow('win-1', 'TaskBoardWindow', windowData);

        const loaded = s.loadWindow('win-1', 'TaskBoardWindow');
        assert.ok(loaded, 'window state should exist');
        assert.equal(loaded.turn, 5);
        assert.equal(loaded.state.filter, 'all');
        assert.equal(loaded.items[0][0], 'task-1');
        s.close();
    },

    'load nonexistent window returns null'(assert: any) {
        const s = freshStorage();
        assert.ok(!s.loadWindow('nope', 'Nope'));
        s.close();
    },

    // ── Conversation serialization ──

    'conversation toJSON and loadJSON roundtrip'(assert: any) {
        const conv = new Conversation();
        conv.addUser('Hello');
        conv.addAssistant([{ type: 'text', text: 'Hi!' }]);
        conv.addUser('How are you?');

        const json = conv.toJSON();
        assert.equal(json.length, 3);

        const conv2 = new Conversation();
        conv2.loadJSON(json);
        assert.equal(conv2.length, 3);
        assert.equal(conv2.messages[0].content, 'Hello');
        assert.equal(conv2.messages[2].content, 'How are you?');
    },

    'conversation loadJSON replaces existing history'(assert: any) {
        const conv = new Conversation();
        conv.addUser('Old message');
        assert.equal(conv.length, 1);

        conv.loadJSON([{ role: 'user', content: 'New' }, { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] }]);
        assert.equal(conv.length, 2);
        assert.equal(conv.messages[0].content, 'New');
    },

    // ── Upsert (save session twice) ──

    'save session twice updates existing'(assert: any) {
        const s = freshStorage();
        s.saveSession({ id: 'up-1', agentName: 'A', createdAt: 100, updatedAt: 100 });
        s.saveSession({ id: 'up-1', agentName: 'A', createdAt: 100, updatedAt: 200 });

        const list = s.listSessions();
        assert.equal(list.length, 1, 'should not duplicate');
        assert.equal(list[0].updatedAt, 200, 'should have updated timestamp');
        s.close();
    },
};
