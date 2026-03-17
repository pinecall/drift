/**
 * shell_start — Start a background process
 */

import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../../types.ts';

// Shared process registry
const _bgProcesses = new Map<string, { proc: any; stdout: string[]; stderr: string[] }>();

export function getBgProcesses() { return _bgProcesses; }

const shellStart: ToolDefinition = {
    name: 'shell_start',
    description: 'Start a long-running background process (e.g., dev server). Returns a process ID for shell_read/shell_write/shell_stop.',

    schema: {
        command: { type: 'string', description: 'Command to start (e.g., "npm run dev")' },
    },

    required: ['command'],

    async execute(params, ctx) {
        const { command } = params;
        const { cwd } = ctx;

        const processId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const proc = spawn(command, [], { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });

        const entry = { proc, stdout: [] as string[], stderr: [] as string[] };
        _bgProcesses.set(processId, entry);

        proc.stdout.on('data', (d: Buffer) => entry.stdout.push(d.toString()));
        proc.stderr.on('data', (d: Buffer) => entry.stderr.push(d.toString()));

        proc.on('exit', () => {
            // Keep in registry for final read, mark as dead
            if (_bgProcesses.has(processId)) {
                (entry as any).exited = true;
            }
        });

        return {
            success: true,
            result: `✓ Started process: ${command}\nProcess ID: ${processId}\nUse shell_read("${processId}") to see output, shell_stop("${processId}") to terminate.`
        };
    }
};

export default shellStart;
