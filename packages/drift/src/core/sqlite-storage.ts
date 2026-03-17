/**
 * Drift — SQLite Storage
 * 
 * Default persistence backend using better-sqlite3.
 * Stores sessions, conversation messages, and window state.
 * 
 *   const storage = new SQLiteStorage('.drift/drift.db');
 *   await storage.saveSession({ id: '...', agentName: 'TaskAgent', ... });
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from '../types.ts';
import type { Storage, SessionData } from './storage.ts';

export class SQLiteStorage implements Storage {
    private db: Database.Database;

    constructor(dbPath: string = '.drift/drift.db') {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this._migrate();
    }

    // ── Schema ──────────────────────────────────────

    private _migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT PRIMARY KEY,
                agent_name  TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                session_id  TEXT NOT NULL,
                idx         INTEGER NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                PRIMARY KEY (session_id, idx),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS window_state (
                session_id    TEXT NOT NULL,
                window_class  TEXT NOT NULL,
                state         TEXT NOT NULL,
                PRIMARY KEY (session_id, window_class),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
        `);
    }

    // ── Sessions ────────────────────────────────────

    saveSession(data: SessionData): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sessions (id, agent_name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(data.id, data.agentName, data.createdAt, data.updatedAt);
    }

    loadSession(id: string): SessionData | null {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
        if (!row) return null;
        return {
            id: row.id,
            agentName: row.agent_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    listSessions(): SessionData[] {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];
        return rows.map(row => ({
            id: row.id,
            agentName: row.agent_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }

    deleteSession(id: string): void {
        // Cascade deletes messages and window_state via FK
        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
        this.db.prepare('DELETE FROM window_state WHERE session_id = ?').run(id);
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }

    // ── Messages ────────────────────────────────────

    saveMessages(sessionId: string, messages: Message[]): void {
        const del = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
        const ins = this.db.prepare('INSERT INTO messages (session_id, idx, role, content) VALUES (?, ?, ?, ?)');

        const tx = this.db.transaction(() => {
            del.run(sessionId);
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                const content = typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content);
                ins.run(sessionId, i, msg.role, content);
            }
        });
        tx();
    }

    loadMessages(sessionId: string): Message[] {
        const rows = this.db.prepare(
            'SELECT role, content FROM messages WHERE session_id = ? ORDER BY idx'
        ).all(sessionId) as any[];

        return rows.map(row => {
            let content: any = row.content;
            // Try parsing JSON (content blocks), fall back to string
            try {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) content = parsed;
            } catch {
                // keep as string
            }
            return { role: row.role, content };
        });
    }

    // ── Window State ────────────────────────────────

    saveWindow(sessionId: string, windowClass: string, data: any): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO window_state (session_id, window_class, state)
            VALUES (?, ?, ?)
        `);
        stmt.run(sessionId, windowClass, JSON.stringify(data));
    }

    loadWindow(sessionId: string, windowClass: string): any | null {
        const row = this.db.prepare(
            'SELECT state FROM window_state WHERE session_id = ? AND window_class = ?'
        ).get(sessionId, windowClass) as any;
        if (!row) return null;
        return JSON.parse(row.state);
    }

    // ── Lifecycle ───────────────────────────────────

    close(): void {
        this.db.close();
    }
}
