/**
 * create_file — Create a new file with content
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const createFile: ToolDefinition = {
    name: 'create_file',
    description: 'Create a new file with content. Creates parent directories if needed. Overwrites if exists.',

    schema: {
        filePath: { type: 'string', description: 'File path to create (relative to project root)' },
        content: { type: 'string', description: 'The full file content to write' },
    },

    required: ['filePath', 'content'],

    async execute(params, ctx) {
        const filePath = params.filePath || params.file_path || params.path || params.file;
        const { content } = params;
        const cwd = ctx.cwd || process.cwd();

        if (!filePath) {
            return { success: false, result: 'Failed: missing filePath parameter' };
        }

        try {
            const fullPath = path.resolve(cwd, filePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            let existed = true;
            try { await fs.access(fullPath); } catch { existed = false; }

            await fs.writeFile(fullPath, content, 'utf8');

            const lines = content.split('\n').length;
            const action = existed ? 'Overwrote' : 'Created';

            if (ctx.window) ctx.window.open(filePath);

            return { success: true, result: `✓ ${action} ${filePath} (${lines} lines)` };
        } catch (err: any) {
            return { success: false, result: `Failed: ${err.message}` };
        }
    }
};

export default createFile;
