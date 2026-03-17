/**
 * shell_stop — Stop a background process
 */

import type { ToolDefinition } from '../../types.ts';
import { getBgProcesses } from './shell-start.ts';

const shellStop: ToolDefinition = {
    name: 'shell_stop',
    description: 'Stop a background process started with shell_start.',

    schema: {
        processId: { type: 'string', description: 'Process ID from shell_start' },
    },

    required: ['processId'],

    async execute(params) {
        const { processId } = params;
        const processes = getBgProcesses();
        const entry = processes.get(processId);

        if (!entry) {
            return { success: false, result: `Process not found: ${processId}` };
        }

        try {
            entry.proc.kill('SIGTERM');
            setTimeout(() => { try { entry.proc.kill('SIGKILL'); } catch { /* done */ } }, 500);
            processes.delete(processId);
            return { success: true, result: `✓ Stopped process ${processId}` };
        } catch (err: any) {
            processes.delete(processId);
            return { success: false, result: `Failed to stop: ${err.message}` };
        }
    }
};

export default shellStop;
