/**
 * shell_write — Write to stdin of a background process
 */

import type { ToolDefinition } from '../../types.ts';
import { getBgProcesses } from './shell-start.ts';

const shellWrite: ToolDefinition = {
    name: 'shell_write',
    description: 'Write input to the stdin of a background process.',

    schema: {
        processId: { type: 'string', description: 'Process ID from shell_start' },
        input: { type: 'string', description: 'Text to write to stdin (newline appended automatically)' },
    },

    required: ['processId', 'input'],

    async execute(params) {
        const { processId, input } = params;
        const processes = getBgProcesses();
        const entry = processes.get(processId);

        if (!entry) {
            return { success: false, result: `Process not found: ${processId}` };
        }

        if ((entry as any).exited) {
            return { success: false, result: `Process ${processId} has already exited` };
        }

        try {
            entry.proc.stdin.write(input + '\n');
            return { success: true, result: `✓ Wrote to ${processId}: "${input}"` };
        } catch (err: any) {
            return { success: false, result: `Failed to write: ${err.message}` };
        }
    }
};

export default shellWrite;
