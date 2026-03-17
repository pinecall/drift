/**
 * insert_before — Insert content before a specific line with verification
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const insertBefore: ToolDefinition = {
    name: 'insert_before',
    description: 'Insert new content BEFORE a specific line. beforeLine is the anchor — beforeLineContent must match.',

    schema: {
        filePath: { type: 'string', description: 'Path to the file' },
        beforeLine: { type: 'number', description: 'Anchor line number (1-indexed). Content inserted above.' },
        beforeLineContent: { type: 'string', description: 'Expected trimmed content of beforeLine for verification.' },
        content: { type: 'string', description: 'Content to insert. Do not start or end with newlines.' },
    },

    required: ['filePath', 'beforeLine', 'beforeLineContent', 'content'],

    async execute(params, ctx) {
        const { filePath, beforeLine, beforeLineContent, content: newContent } = params;
        const { cwd } = ctx;

        const fullPath = path.resolve(cwd, filePath);

        try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const newLines = newContent.split('\n');

            if (beforeLine < 1 || beforeLine > lines.length + 1) {
                return { success: false, result: `Invalid line: ${beforeLine} (file has ${lines.length} lines)` };
            }

            const actual = lines[beforeLine - 1].trim();
            const expected = (beforeLineContent || '').trim();
            if (actual !== expected) {
                return {
                    success: false,
                    result: `❌ beforeLine ${beforeLine} content mismatch!\n  Expected: "${expected}"\n  Actual:   "${actual}"`
                };
            }

            lines.splice(beforeLine - 1, 0, ...newLines);
            await fs.writeFile(fullPath, lines.join('\n'), 'utf8');

            if (ctx.window) ctx.window.refresh(filePath);

            const description = `Inserted ${newLines.length} lines before L${beforeLine}`;
            const ctxStart = Math.max(0, beforeLine - 3);
            const ctxEnd = Math.min(lines.length, beforeLine - 1 + newLines.length + 2);
            const snippet = lines.slice(ctxStart, ctxEnd)
                .map((l: string, i: number) => `  ${String(ctxStart + i + 1).padStart(4)}| ${l}`)
                .join('\n');

            return { success: true, result: `✓ ${description} in ${filePath}\n${snippet}` };
        } catch (err: any) {
            return { success: false, result: `Failed: ${err.message}` };
        }
    }
};

export default insertBefore;
