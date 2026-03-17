/**
 * close_files — Close files from window context
 */

import type { ToolDefinition } from '../../types.ts';

const closeFiles: ToolDefinition = {
    name: 'close_files',
    description: 'Close one or more files from the window.',

    schema: {
        paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to close',
        },
    },

    required: ['paths'],

    async execute(params, ctx) {
        const { paths } = params;
        const { window } = ctx;

        if (!Array.isArray(paths) || paths.length === 0) {
            return { success: false, result: 'paths must be a non-empty array' };
        }

        const results: string[] = [];
        for (const filePath of paths) {
            if (window && window.has(filePath)) {
                window.close(filePath);
                results.push(`✓ Closed ${filePath}`);
            } else {
                results.push(`⊘ ${filePath} was not open`);
            }
        }

        return { success: true, result: results.join('\n') };
    }
};

export default closeFiles;
