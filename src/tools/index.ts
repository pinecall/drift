/**
 * Drift — Built-in tool loader
 * 
 * Registers built-in tools with a ToolRegistry.
 * Supports selective registration by name or category.
 */

import type { ToolRegistry } from '../decorators/tool.ts';

// Edit tools
import replace from './edit/replace.ts';
import insertAfter from './edit/insert-after.ts';
import insertBefore from './edit/insert-before.ts';

// Filesystem tools
import createFile from './filesystem/create-file.ts';
import deleteFile from './filesystem/delete-file.ts';
import openFiles from './filesystem/open-files.ts';
import closeFiles from './filesystem/close-files.ts';
import findByName from './filesystem/find-by-name.ts';
import grepSearch from './filesystem/grep-search.ts';
import listDir from './filesystem/list-dir.ts';
import projectTree from './filesystem/project-tree.ts';

// Shell tools
import shellExecute from './shell/shell-execute.ts';
import shellStart from './shell/shell-start.ts';
import shellRead from './shell/shell-read.ts';
import shellWrite from './shell/shell-write.ts';
import shellStop from './shell/shell-stop.ts';

// ── Categories ──────────────────────────────────────

const EDIT_TOOLS = [replace, insertAfter, insertBefore];

const FILESYSTEM_TOOLS = [
    createFile, deleteFile, openFiles, closeFiles,
    findByName, grepSearch, listDir, projectTree,
];

const SHELL_TOOLS = [shellExecute, shellStart, shellRead, shellWrite, shellStop];

const ALL_TOOLS = [...EDIT_TOOLS, ...FILESYSTEM_TOOLS, ...SHELL_TOOLS];

/** Category → tools mapping */
const CATEGORIES: Record<string, any[]> = {
    edit: EDIT_TOOLS,
    filesystem: FILESYSTEM_TOOLS,
    shell: SHELL_TOOLS,
    all: ALL_TOOLS,
};

/** All valid built-in tool names */
const TOOL_NAMES = new Set(ALL_TOOLS.map(t => t.name));

/** All valid category names */
const CATEGORY_NAMES = new Set(Object.keys(CATEGORIES));

// ── Registration ────────────────────────────────────

/**
 * Register all 16 built-in tools with a registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): number {
    let count = 0;
    for (const tool of ALL_TOOLS) {
        if (registry.register(tool)) count++;
    }
    return count;
}

/**
 * Register a subset of built-in tools by name or category.
 * 
 * Accepts:
 *   - Category names: 'edit', 'filesystem', 'shell', 'all'
 *   - Individual tool names: 'replace', 'grep_search', 'shell_execute', etc.
 * 
 * Example:
 *   registerSelectedTools(registry, ['edit', 'filesystem'])     // 11 tools
 *   registerSelectedTools(registry, ['shell'])                  // 5 tools
 *   registerSelectedTools(registry, ['grep_search', 'list_dir'])// 2 tools
 *   registerSelectedTools(registry, ['edit', 'shell_execute'])  // 4 tools (mix)
 */
export function registerSelectedTools(registry: ToolRegistry, selection: string[]): number {
    const toolsToRegister = new Set<any>();

    for (const item of selection) {
        if (CATEGORIES[item]) {
            // It's a category — add all tools in that category
            for (const tool of CATEGORIES[item]) {
                toolsToRegister.add(tool);
            }
        } else {
            // It's an individual tool name
            const tool = ALL_TOOLS.find(t => t.name === item);
            if (tool) {
                toolsToRegister.add(tool);
            }
        }
    }

    let count = 0;
    for (const tool of toolsToRegister) {
        if (registry.register(tool)) count++;
    }
    return count;
}

export { ALL_TOOLS, EDIT_TOOLS, FILESYSTEM_TOOLS, SHELL_TOOLS, CATEGORIES, TOOL_NAMES, CATEGORY_NAMES };
