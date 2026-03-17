/**
 * open_files — Open files in the window context
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const openFiles: ToolDefinition = {
    name: 'open_files',
    description: 'Open one or more files in the window. Content stays visible with line numbers until closed.',

    schema: {
        paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to open',
        },
    },

    required: ['paths'],

    async execute(params, ctx) {
        const { paths } = params;
        const { cwd, window } = ctx;

        if (!Array.isArray(paths) || paths.length === 0) {
            return { success: false, result: 'paths must be a non-empty array' };
        }

        const results: string[] = [];
        let opened = 0;
        let failed = 0;

        for (const filePath of paths) {
            const fullPath = path.resolve(cwd, filePath);
            const relativePath = path.relative(cwd, fullPath);

            try {
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n').length;

                if (window) {
                    const wasOpen = window.has(filePath);
                    window.open(filePath);

                    if (wasOpen) {
                        results.push(`↻ ${relativePath} (${lines} lines) — refreshed`);
                    } else {
                        results.push(`✓ ${relativePath} (${lines} lines) — opened`);
                    }
                    opened++;
                } else {
                    // No window — return file content directly
                    const numbered = content.split('\n')
                        .map((l: string, i: number) => `${String(i + 1).padStart(4)}| ${l}`)
                        .join('\n');
                    results.push(`✓ ${relativePath} (${lines} lines)\n${numbered}`);
                    opened++;
                }
            } catch {
                results.push(`✗ ${filePath}: not found`);
                failed++;
            }
        }

        return { success: failed === 0, result: results.join('\n') };
    }
};

export default openFiles;
