/**
 * Drift — Storage Interface
 * 
 * Pluggable persistence backend for sessions, conversations, and window state.
 * Default implementation: SQLiteStorage (see sqlite-storage.ts).
 * 
 *   import { SQLiteStorage } from 'drift';
 *   const server = new DriftServer({ storage: new SQLiteStorage() });
 */

import type { Message } from '../types.ts';

// ── Types ───────────────────────────────────────────

export interface SessionData {
    id: string;
    agentName: string;
    createdAt: number;
    updatedAt: number;
}

// ── Storage Interface ───────────────────────────────

export interface Storage {
    // Sessions
    saveSession(data: SessionData): Promise<void> | void;
    loadSession(id: string): Promise<SessionData | null> | SessionData | null;
    listSessions(): Promise<SessionData[]> | SessionData[];
    deleteSession(id: string): Promise<void> | void;

    // Conversation messages
    saveMessages(sessionId: string, messages: Message[]): Promise<void> | void;
    loadMessages(sessionId: string): Promise<Message[]> | Message[];

    // Window state
    saveWindow(sessionId: string, windowClass: string, data: any): Promise<void> | void;
    loadWindow(sessionId: string, windowClass: string): Promise<any | null> | any | null;

    // Workspace state (shared across agents)
    saveWorkspace(name: string, data: any): Promise<void> | void;
    loadWorkspace(name: string): Promise<any | null> | any | null;

    // Lifecycle
    close(): Promise<void> | void;
}
