/**
 * replace — Line-based replace with content verification
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const replace: ToolDefinition = {
    name: 'replace',
    description: 'Replace a block of lines in a file. Specify the file, start/end lines with expected content for verification, and the new content.',

    schema: {
        filePath: { type: 'string', description: 'Path to the file' },
        startLine: { type: 'number', description: 'First line to replace (1-indexed, inclusive)' },
        startLineContent: { type: 'string', description: 'Trimmed text of the single line at startLine for verification' },
        endLine: { type: 'number', description: 'Last line to replace (1-indexed, inclusive)' },
        endLineContent: { type: 'string', description: 'Trimmed text of the single line at endLine for verification' },
        newContent: { type: 'string', description: 'New content to put in place of the replaced lines' },
    },

    required: ['filePath', 'startLine', 'startLineContent', 'endLine', 'endLineContent', 'newContent'],

    async execute(params, ctx) {
        const { filePath, startLine, startLineContent, endLine, endLineContent, newContent } = params;
        const { cwd } = ctx;

        if (!filePath || typeof filePath !== 'string') {
            return { success: false, result: 'filePath is required and must be a string.' };
        }
        if (!startLine || !endLine || startLine < 1 || endLine < startLine) {
            return { success: false, result: `Invalid line range: startLine=${startLine}, endLine=${endLine}.` };
        }

        const fullPath = path.resolve(cwd, filePath);

        try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const totalLines = lines.length;

            if (startLine > totalLines) {
                return { success: false, result: `❌ Invalid line range ${startLine}-${endLine} (file has ${totalLines} lines)` };
            }

            const clampedEnd = Math.min(endLine, totalLines);
            const actualStart = lines[startLine - 1].trim();
            const actualEnd = lines[clampedEnd - 1].trim();
            const expectedStart = startLineContent.trim();
            const expectedEnd = endLineContent.trim();

            if (actualStart !== expectedStart) {
                return {
                    success: false,
                    result: `❌ startLine ${startLine} content mismatch!\n  Expected: "${expectedStart}"\n  Actual:   "${actualStart}"`
                };
            }

            if (actualEnd !== expectedEnd) {
                return {
                    success: false,
                    result: `❌ endLine ${clampedEnd} content mismatch!\n  Expected: "${expectedEnd}"\n  Actual:   "${actualEnd}"`
                };
            }

            const oldCount = clampedEnd - startLine + 1;
            const newLines = newContent.split('\n');

            // Auto-fix first line indent
            const origIndent = (lines[startLine - 1].match(/^(\s*)/) || ['', ''])[1];
            const firstNonEmptyIdx = newLines.findIndex((l: string) => l.trim().length > 0);
            if (firstNonEmptyIdx >= 0) {
                const firstLine = newLines[firstNonEmptyIdx];
                const firstIndent = (firstLine.match(/^(\s*)/) || ['', ''])[1];
                if (firstIndent !== origIndent) {
                    newLines[firstNonEmptyIdx] = origIndent + firstLine.trimStart();
                }
            }

            lines.splice(startLine - 1, oldCount, ...newLines);

            const delta = newLines.length - oldCount;
            const sign = delta >= 0 ? '+' : '';

            await fs.writeFile(fullPath, lines.join('\n'), 'utf8');

            if (ctx.window) ctx.window.refresh(filePath);

            return { success: true, result: `✓ ${filePath} L${startLine}-${clampedEnd} replaced (${sign}${delta} lines)` };
        } catch (err: any) {
            return { success: false, result: `Failed on ${filePath}: ${err.message}` };
        }
    }
};

export default replace;
