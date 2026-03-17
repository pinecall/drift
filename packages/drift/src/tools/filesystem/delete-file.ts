/**
 * delete_file — Delete a file
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const deleteFile: ToolDefinition = {
    name: 'delete_file',
    description: 'Delete a file from the filesystem.',

    schema: {
        filePath: { type: 'string', description: 'Path to the file to delete' },
    },

    required: ['filePath'],

    async execute(params, ctx) {
        const { filePath } = params;
        const { cwd } = ctx;

        const fullPath = path.resolve(cwd, filePath);

        try {
            await fs.access(fullPath);
            await fs.unlink(fullPath);
            if (ctx.window) ctx.window.close(filePath);
            return { success: true, result: `✓ Deleted ${filePath}` };
        } catch (err: any) {
            return { success: false, result: `Failed to delete ${filePath}: ${err.message}` };
        }
    }
};

export default deleteFile;
