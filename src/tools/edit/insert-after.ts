/**
 * insert_after — Insert content after a specific line with verification
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const insertAfter: ToolDefinition = {
    name: 'insert_after',
    description: 'Insert new content AFTER a specific line. afterLine is the anchor — afterLineContent must match. Use afterLine=0 to insert at the beginning.',

    schema: {
        filePath: { type: 'string', description: 'Path to the file' },
        afterLine: { type: 'number', description: 'Anchor line number (1-indexed). Content inserted below. Use 0 for beginning.' },
        afterLineContent: { type: 'string', description: 'Expected trimmed content of afterLine for verification. Ignored when afterLine=0.' },
        content: { type: 'string', description: 'Content to insert. Do not start or end with newlines.' },
    },

    required: ['filePath', 'afterLine', 'afterLineContent', 'content'],

    async execute(params, ctx) {
        const { filePath, afterLine, afterLineContent, content: newContent } = params;
        const { cwd } = ctx;

        const fullPath = path.resolve(cwd, filePath);

        try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const newLines = newContent.split('\n');

            if (afterLine < 0 || afterLine > lines.length) {
                return { success: false, result: `Invalid line: ${afterLine} (file has ${lines.length} lines)` };
            }

            if (afterLine > 0) {
                const actual = lines[afterLine - 1].trim();
                const expected = (afterLineContent || '').trim();
                if (actual !== expected) {
                    return {
                        success: false,
                        result: `❌ afterLine ${afterLine} content mismatch!\n  Expected: "${expected}"\n  Actual:   "${actual}"`
                    };
                }
            }

            lines.splice(afterLine, 0, ...newLines);
            await fs.writeFile(fullPath, lines.join('\n'), 'utf8');

            if (ctx.window) ctx.window.refresh(filePath);

            const description = `Inserted ${newLines.length} lines after L${afterLine}`;
            const ctxStart = Math.max(0, afterLine - 2);
            const ctxEnd = Math.min(lines.length, afterLine + newLines.length + 2);
            const snippet = lines.slice(ctxStart, ctxEnd)
                .map((l: string, i: number) => `  ${String(ctxStart + i + 1).padStart(4)}| ${l}`)
                .join('\n');

            return { success: true, result: `✓ ${description} in ${filePath}\n${snippet}` };
        } catch (err: any) {
            return { success: false, result: `Failed: ${err.message}` };
        }
    }
};

export default insertAfter;
