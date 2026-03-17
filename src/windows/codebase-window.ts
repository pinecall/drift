/**
 * Drift — CodebaseWindow
 * 
 * Window<FileEntry> subclass for code editing agents.
 * Opens files from disk, renders numbered code in <window> XML,
 * auto-refreshes after edits, and manages grep results with TTL.
 * 
 *   const window = new CodebaseWindow({ cwd: '/my/project' });
 *   window.open('src/index.ts');   // reads from disk
 *   window.render();               // → <window>📂 Open files (1): ...numbered code...</window>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Window, type WindowItem } from '../core/window.ts';

// ── Types ───────────────────────────────────────────

export interface FileEntry extends WindowItem {
    id: string;          // relative path (key)
    fullPath: string;
    content: string;
    lines: number;
    disabled: boolean;
    openedAt: number;
}

export interface GrepResult {
    pattern: string;
    matches: { file: string; line: number; content: string }[];
    fullUntilTurn: number;
}

export interface CodebaseWindowOptions {
    cwd?: string;
    maxFileLines?: number;
}

// ── CodebaseWindow ──────────────────────────────────

export class CodebaseWindow extends Window<FileEntry> {
    readonly cwd: string;
    readonly maxFileLines: number;
    private _grepResults: GrepResult[] = [];

    constructor(options: CodebaseWindowOptions = {}) {
        super();
        this.cwd = options.cwd || process.cwd();
        this.maxFileLines = options.maxFileLines || 5000;
    }

    // ── File Operations ─────────────────────────────

    /**
     * Open a file from disk. Reads content and adds to window.
     * If already open, refreshes from disk.
     */
    open(filePath: string): { success: boolean; path?: string; lines?: number; warning?: string; error?: string } {
        const fullPath = path.resolve(this.cwd, filePath);
        const relativePath = path.relative(this.cwd, fullPath);

        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lineCount = content.split('\n').length;
            const tooBig = lineCount > this.maxFileLines;

            const entry: FileEntry = {
                id: relativePath,
                fullPath,
                content,
                lines: lineCount,
                disabled: this.get(relativePath)?.disabled || false,
                openedAt: this.get(relativePath)?.openedAt || Date.now(),
            };

            this.add(relativePath, entry);

            return {
                success: true,
                path: relativePath,
                lines: lineCount,
                warning: tooBig ? `File has ${lineCount} lines (exceeds ${this.maxFileLines} limit)` : undefined,
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    /** Close a file from the window. */
    close(filePath: string): boolean {
        const relativePath = this._resolve(filePath);
        return this.remove(relativePath);
    }

    /** Re-read a file from disk. */
    refresh(filePath: string): boolean {
        const relativePath = this._resolve(filePath);
        const existing = this.get(relativePath);
        if (!existing) return false;

        try {
            const content = fs.readFileSync(existing.fullPath, 'utf8');
            const lineCount = content.split('\n').length;

            this.update(relativePath, {
                content,
                lines: lineCount,
            } as Partial<FileEntry>);
            return true;
        } catch {
            return false;
        }
    }

    /** Refresh all open files. Returns paths that changed. */
    refreshAll(): string[] {
        const changed: string[] = [];
        for (const [id, entry] of this._items) {
            const oldContent = entry.content;
            this.refresh(id);
            const newContent = this.get(id)?.content;
            if (oldContent !== newContent) changed.push(id);
        }
        return changed;
    }

    /** Disable a file — keeps it open but excludes from render(). */
    disable(filePath: string): void {
        const relativePath = this._resolve(filePath);
        if (this.has(relativePath)) {
            this.update(relativePath, { disabled: true } as Partial<FileEntry>);
        }
    }

    /** Re-enable a disabled file. */
    enable(filePath: string): void {
        const relativePath = this._resolve(filePath);
        if (this.has(relativePath)) {
            this.update(relativePath, { disabled: false } as Partial<FileEntry>);
        }
    }

    // ── Grep Results ────────────────────────────────

    /** Store grep results with TTL (turns). */
    addGrepResults(pattern: string, matches: GrepResult['matches'], turns: number = 4): void {
        this._grepResults = this._grepResults.filter(g => g.pattern !== pattern);
        this._grepResults.push({
            pattern,
            matches,
            fullUntilTurn: this.turn + turns,
        });
        if (this._grepResults.length > 3) {
            this._grepResults = this._grepResults.slice(-3);
        }
    }

    /** Clean expired grep results. */
    private _cleanGrepResults(): void {
        this._grepResults = this._grepResults.filter(g => g.fullUntilTurn > this.turn);
    }

    // ── Rendering ───────────────────────────────────

    /**
     * Render <window> XML for system prompt injection.
     * Shows numbered code for all enabled files.
     */
    render(): string {
        if (this._items.size === 0) {
            return '\n\n<window>\n📂 No files open. Use open_files() to load files.\n</window>';
        }

        this._cleanGrepResults();
        const openPaths = this.keys();
        const sections: string[] = [];
        let totalLines = 0;

        for (const [relativePath, entry] of this._items) {
            if (entry.disabled) continue;

            const lines = entry.content.split('\n');
            totalLines += lines.length;

            const numbered = lines
                .map((line, i) => `${String(i + 1).padStart(4)}| ${line}`)
                .join('\n');

            sections.push(
                `┌─ ${relativePath} (${lines.length} lines) ─┐\n` +
                `${numbered}\n` +
                `└${'─'.repeat(40)}┘`
            );
        }

        // Active grep results
        for (const grep of this._grepResults) {
            const turnsLeft = Math.max(0, grep.fullUntilTurn - this.turn);
            const grepLines = [`┌─ grep: "${grep.pattern}" (${grep.matches.length} matches, ${turnsLeft} turn${turnsLeft !== 1 ? 's' : ''} left) ─┐`];
            for (const m of grep.matches) {
                grepLines.push(`  ${m.file}:${m.line}`);
                grepLines.push(`    ${m.content}`);
            }
            grepLines.push(`└${'─'.repeat(40)}┘`);
            sections.push(grepLines.join('\n'));
        }

        let header = `📂 Open files (${this._items.size}): ${openPaths.join(', ')}\n`;
        header += `⚠️  These files AUTO-REFRESH after every edit. Do NOT re-open them.\n`;
        header += `Use the line numbers below for all edit operations.\n`;

        return (
            `\n\n<window>\n` +
            header + '\n' +
            sections.join('\n\n') +
            `\n\n📊 Window: ${this._items.size} file(s), ${totalLines} lines total` +
            `\n</window>`
        );
    }

    /**
     * Short metadata summary for user messages.
     */
    renderMetadata(): string {
        if (this._items.size === 0) {
            return '📂 No files open. Use open_files() to load files.';
        }

        const lines: string[] = [];
        let totalLines = 0;

        lines.push(`📂 Loaded in window (${this._items.size} file${this._items.size !== 1 ? 's' : ''}):`);

        for (const [relativePath, entry] of this._items) {
            if (entry.disabled) continue;
            totalLines += entry.lines;
            lines.push(`  • ${relativePath} (${entry.lines} lines)`);
        }

        lines.push(`📊 ${totalLines} total lines`);
        lines.push(`⚠️ File content is in the window section of the system prompt.`);

        return lines.join('\n');
    }

    // ── Stats ───────────────────────────────────────

    /** Window statistics. */
    stats(): { files: number; totalLines: number; openFiles: string[] } {
        let totalLines = 0;
        for (const entry of this._items.values()) {
            totalLines += entry.lines;
        }
        return {
            files: this._items.size,
            totalLines,
            openFiles: this.keys(),
        };
    }

    // ── Internals ───────────────────────────────────

    private _resolve(filePath: string): string {
        const fullPath = path.resolve(this.cwd, filePath);
        return path.relative(this.cwd, fullPath);
    }
}
