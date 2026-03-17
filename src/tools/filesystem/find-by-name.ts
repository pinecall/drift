/**
 * find_by_name — Find files by name pattern
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const findByName: ToolDefinition = {
    name: 'find_by_name',
    description: 'Find files by name pattern. Uses git ls-files for speed. Returns matching paths.',

    schema: {
        pattern: { type: 'string', description: 'Filename pattern to search for (supports glob)' },
        path: { type: 'string', description: 'Directory to search in (optional, defaults to project root)' },
    },

    required: ['pattern'],

    async execute(params, ctx) {
        const { pattern, path: searchPath } = params;
        const { cwd } = ctx;

        if (!pattern || pattern.trim().length < 1) {
            return { success: false, result: 'Pattern is required' };
        }

        try {
            // Try git ls-files first
            let output = '';
            try {
                const args = ['ls-files', '--cached', '--others', '--exclude-standard'];
                output = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
            } catch {
                // Fallback to find
                const findPath = searchPath ? path.resolve(cwd, searchPath) : cwd;
                output = execFileSync('find', [findPath, '-name', pattern, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'], {
                    encoding: 'utf8', timeout: 10000,
                });
                const matches = output.trim().split('\n').filter(Boolean);
                if (matches.length === 0) {
                    return { success: true, result: `No files found matching: ${pattern}` };
                }
                return { success: true, result: `Found ${matches.length} file(s):\n${matches.slice(0, 30).join('\n')}` };
            }

            // Filter git ls-files output by pattern
            const allFiles = output.trim().split('\n').filter(Boolean);
            const globPattern = pattern.toLowerCase();
            const matches = allFiles.filter(f => {
                const basename = path.basename(f).toLowerCase();
                const relativePath = f.toLowerCase();
                // Simple glob matching
                if (globPattern.includes('*')) {
                    const regex = new RegExp('^' + globPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
                    return regex.test(basename) || regex.test(relativePath);
                }
                return basename.includes(globPattern) || relativePath.includes(globPattern);
            });

            // Filter by path if specified
            const filtered = searchPath
                ? matches.filter(f => f.startsWith(searchPath))
                : matches;

            if (filtered.length === 0) {
                return { success: true, result: `No files found matching: ${pattern}` };
            }

            return {
                success: true,
                result: `Found ${filtered.length} file(s):\n${filtered.slice(0, 30).join('\n')}${filtered.length > 30 ? `\n... and ${filtered.length - 30} more` : ''}`
            };
        } catch (err: any) {
            return { success: false, result: `Search failed: ${err.message}` };
        }
    }
};

export default findByName;
