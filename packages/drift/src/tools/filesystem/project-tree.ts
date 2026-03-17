/**
 * project_tree — Git-based project tree
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { ToolDefinition } from '../../types.ts';

const projectTree: ToolDefinition = {
    name: 'project_tree',
    description: 'Show the project file tree. Uses git ls-files for an accurate, fast listing.',

    schema: {
        path: { type: 'string', description: 'Subdirectory to show (optional, defaults to project root)' },
        depth: { type: 'number', description: 'Max depth to display (optional, defaults to 4)' },
    },

    required: [],

    async execute(params, ctx) {
        const { path: subDir, depth = 4 } = params;
        const { cwd } = ctx;

        try {
            // Get files from git
            let output: string;
            try {
                const args = ['ls-files', '--cached', '--others', '--exclude-standard'];
                if (subDir) args.push(subDir);
                output = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
            } catch {
                // Fallback: simple find
                const findPath = subDir ? path.resolve(cwd, subDir) : cwd;
                output = execFileSync('find', [findPath, '-type', 'f', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'], {
                    encoding: 'utf8', timeout: 10000,
                });
                // Convert absolute paths to relative
                output = output.split('\n').map(p => path.relative(cwd, p)).join('\n');
            }

            const files = output.trim().split('\n').filter(Boolean);

            if (files.length === 0) {
                return { success: true, result: 'No files found in project' };
            }

            // Build tree structure
            const tree = new Map<string, any>();

            for (const file of files) {
                const parts = file.split('/');
                if (parts.length > depth + 1) continue; // prune deep files

                let current = tree;
                for (let i = 0; i < parts.length - 1; i++) {
                    const dir = parts[i];
                    if (!current.has(dir)) current.set(dir, new Map());
                    current = current.get(dir);
                }
                // Leaf = filename (string, not map)
                current.set(parts[parts.length - 1], null);
            }

            // Render tree
            const lines: string[] = [];
            const renderTree = (node: Map<string, any>, prefix: string = '') => {
                const entries = [...node.entries()].sort((a, b) => {
                    const aIsDir = a[1] instanceof Map;
                    const bIsDir = b[1] instanceof Map;
                    if (aIsDir && !bIsDir) return -1;
                    if (!aIsDir && bIsDir) return 1;
                    return a[0].localeCompare(b[0]);
                });

                entries.forEach(([name, value], idx) => {
                    const isLast = idx === entries.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const isDir = value instanceof Map;

                    lines.push(`${prefix}${connector}${isDir ? name + '/' : name}`);

                    if (isDir) {
                        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
                        renderTree(value, nextPrefix);
                    }
                });
            };

            const rootLabel = subDir || path.basename(cwd);
            lines.push(`${rootLabel}/`);
            renderTree(tree);

            return {
                success: true,
                result: `[PROJECT_TREE_START]\n${lines.join('\n')}\n[PROJECT_TREE_END]\n\n${files.length} files total`
            };
        } catch (err: any) {
            return { success: false, result: `Failed to generate project tree: ${err.message}` };
        }
    }
};

export default projectTree;
