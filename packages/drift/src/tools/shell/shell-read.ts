/**
 * shell_read — Read output from a background process
 */

import type { ToolDefinition } from '../../types.ts';
import { getBgProcesses } from './shell-start.ts';

const shellRead: ToolDefinition = {
    name: 'shell_read',
    description: 'Read recent output from a background process started with shell_start.',

    schema: {
        processId: { type: 'string', description: 'Process ID from shell_start' },
    },

    required: ['processId'],

    async execute(params) {
        const { processId } = params;
        const processes = getBgProcesses();
        const entry = processes.get(processId);

        if (!entry) {
            return { success: false, result: `Process not found: ${processId}. Active: ${[...processes.keys()].join(', ') || 'none'}` };
        }

        const output = entry.stdout.join('') + (entry.stderr.length ? '\nSTDERR:\n' + entry.stderr.join('') : '');

        // Clear buffers after read
        entry.stdout.length = 0;
        entry.stderr.length = 0;

        const status = (entry as any).exited ? ' (process exited)' : ' (running)';

        return {
            success: true,
            result: output.trim() ? `${processId}${status}\n\n${output.trim()}` : `${processId}${status}\n\n(no new output)`
        };
    }
};

export default shellRead;
