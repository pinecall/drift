/**
 * shell_execute — Run command and wait for completion
 */

import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../../types.ts';

const _processes = new Map<string, any>();
let _lastProcessId: string | null = null;

export function abortCurrentProcess(): boolean {
    if (_lastProcessId && _processes.has(_lastProcessId)) {
        return abortProcess(_lastProcessId);
    }
    return false;
}

export function abortProcess(id: string): boolean {
    const proc = _processes.get(id);
    if (!proc) return false;
    try {
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already dead */ } }, 500);
    } catch { /* already dead */ }
    _processes.delete(id);
    return true;
}

const shellExecute: ToolDefinition = {
    name: 'shell_execute',
    description: 'Execute a shell command and wait for completion. For long-running processes, use shell_start.',

    schema: {
        command: { type: 'string', description: 'Command to execute (e.g., "ls -la", "npm test")' },
    },

    required: ['command'],

    async execute(params, ctx) {
        const { command } = params;
        const { cwd } = ctx;

        return new Promise(resolve => {
            const start = Date.now();
            const proc = spawn(command, [], { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
            const processId = `shell_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            _processes.set(processId, proc);
            _lastProcessId = processId;

            const stdout: string[] = [];
            const stderr: string[] = [];

            proc.stdout.on('data', (d: Buffer) => stdout.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));

            proc.on('exit', (code, signal) => {
                _processes.delete(processId);
                if (_lastProcessId === processId) _lastProcessId = null;
                const ms = Date.now() - start;
                const output = stdout.join('') + (stderr.length ? '\n' + stderr.join('') : '');

                if (signal === 'SIGTERM' || signal === 'SIGKILL') {
                    resolve({ success: false, result: `⏸️ Aborted: ${command}\n\n${output.trim()}` });
                    return;
                }

                resolve({
                    success: code === 0,
                    result: `${code === 0 ? '✓' : '✗'} ${command}\n\n${output.trim()}\n\nExit: ${code} (${ms}ms)`
                });
            });

            proc.on('error', (err: Error) => {
                _processes.delete(processId);
                resolve({ success: false, result: `Error: ${err.message}` });
            });
        });
    }
};

export default shellExecute;
