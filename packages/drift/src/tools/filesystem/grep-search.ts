/**
 * grep_search — Search text pattern in files
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const grepSearch: ToolDefinition = {
    name: 'grep_search',
    description: 'Search for a text pattern across files. Returns matching lines. ALWAYS specify a scoped path — never search "." root.',

    schema: {
        pattern: { type: 'string', description: 'Text pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in. Use a specific path like "src/".' },
        include: { type: 'string', description: 'File extension filter (e.g., "js", "py")' },
    },

    required: ['pattern'],

    async execute(params, ctx) {
        const { pattern, path: searchPath = '.', include } = params;
        const { cwd } = ctx;

        if (!pattern || pattern.trim().length < 2) {
            return { success: false, result: 'Pattern too short (min 2 chars)' };
        }

        const fullPath = path.resolve(cwd, searchPath);
        if (!fs.existsSync(fullPath)) {
            return { success: false, result: `Path not found: "${searchPath}". Use an existing file or folder path.` };
        }

        let useGitGrep = false;
        try {
            execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            useGitGrep = true;
        } catch { /* not in git repo */ }

        try {
            let output = '';
            const execOpts = { encoding: 'utf8' as const, maxBuffer: 1024 * 1024, cwd, timeout: 15000 };

            if (useGitGrep) {
                const args = ['grep', '-nI', '-F', pattern, '--', searchPath];
                if (include) args.push(`*.${include}`);
                try {
                    output = execFileSync('git', args, execOpts);
                } catch (e: any) {
                    if (e.status === 1) output = '';
                    else throw e;
                }
            } else {
                const args = ['-rn', '-F', pattern, fullPath];
                if (include) args.unshift(`--include=*.${include}`);
                try {
                    output = execFileSync('grep', args, execOpts);
                } catch (e: any) {
                    if (e.status === 1) output = '';
                    else throw e;
                }
            }

            if (!output.trim()) {
                return { success: true, result: `No matches found for: "${pattern}"` };
            }

            const lines = output.trim().split('\n').slice(0, 20);
            const matches: Array<{ file: string; line: number; content: string }> = [];

            for (const line of lines) {
                const match = line.match(/^(.+?):(\d+):(.*)$/);
                if (match) {
                    const [, file, lineNum, content] = match;
                    const relFile = useGitGrep ? file : path.relative(cwd, file);
                    matches.push({
                        file: relFile,
                        line: parseInt(lineNum),
                        content: content.trim().slice(0, 120),
                    });
                }
            }

            let result = `Found ${matches.length} match(es):\n\n`;
            for (const m of matches) {
                result += `${m.file}:${m.line}\n  ${m.content}\n\n`;
            }

            return { success: true, result: result.trim() };
        } catch (err: any) {
            if (err.killed) {
                return { success: false, result: 'Search timed out. Use a more specific path.' };
            }
            return { success: false, result: `Search failed: ${err.message}` };
        }
    }
};

export default grepSearch;
