/**
 * list_dir — List directory contents
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const listDir: ToolDefinition = {
    name: 'list_dir',
    description: 'List files and subdirectories in a directory. Shows types, sizes, and basic info.',

    schema: {
        path: { type: 'string', description: 'Directory path to list (relative to project root)' },
    },

    required: ['path'],

    async execute(params, ctx) {
        const dirPath = params.path || '.';
        const { cwd } = ctx;

        const fullPath = path.resolve(cwd, dirPath);

        try {
            const entries = await fs.readdir(fullPath, { withFileTypes: true });

            // Sort: directories first, then files, alphabetical
            entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

            const lines: string[] = [];

            for (const entry of entries) {
                if (entry.name.startsWith('.') && entry.name !== '.env') continue; // skip hidden

                if (entry.isDirectory()) {
                    lines.push(`📁 ${entry.name}/`);
                } else {
                    try {
                        const stat = await fs.stat(path.join(fullPath, entry.name));
                        const size = stat.size < 1024
                            ? `${stat.size}B`
                            : stat.size < 1024 * 1024
                            ? `${(stat.size / 1024).toFixed(1)}KB`
                            : `${(stat.size / (1024 * 1024)).toFixed(1)}MB`;
                        lines.push(`   ${entry.name} (${size})`);
                    } catch {
                        lines.push(`   ${entry.name}`);
                    }
                }
            }

            if (lines.length === 0) {
                return { success: true, result: `Directory ${dirPath} is empty` };
            }

            return { success: true, result: `${dirPath}/\n${lines.join('\n')}` };
        } catch (err: any) {
            return { success: false, result: `Failed to list ${dirPath}: ${err.message}` };
        }
    }
};

export default listDir;
