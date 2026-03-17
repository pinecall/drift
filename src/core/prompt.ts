/**
 * Drift — Prompt auto-loader
 * 
 * Resolution order:
 *   1. prompts/{kebab-name}.txt  (from cwd)
 *   2. prompt class property     (inline)
 *   3. Default fallback
 * 
 * Class name → file: BookingAgent → booking-agent.txt
 *   - PascalCase → kebab-case
 *   - Strips "Agent" suffix
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Convert PascalCase class name to kebab-case prompt file name.
 * 
 * BookingAgent → booking-agent
 * MyCustomAgent → my-custom-agent
 * Scanner → scanner
 * DataPipelineAgent → data-pipeline-agent
 */
export function classNameToKebab(className: string): string {
    // Strip "Agent" suffix if present
    let name = className;
    if (name.endsWith('Agent') && name !== 'Agent') {
        name = name.slice(0, -5);
    }

    // PascalCase → kebab-case
    return name
        .replace(/([A-Z])/g, (match, letter, offset) => {
            return offset > 0 ? `-${letter.toLowerCase()}` : letter.toLowerCase();
        })
        .replace(/--+/g, '-'); // collapse double dashes
}

export interface PromptResolution {
    prompt: string;
    source: 'file' | 'inline' | 'default';
}

/**
 * Resolve an agent's prompt text.
 * 
 * @param className - The agent class name (e.g. 'BookingAgent')
 * @param inlinePrompt - Optional inline prompt from class property
 * @param cwd - Working directory to search for prompt files
 */
export function resolvePrompt(
    className: string,
    inlinePrompt?: string,
    cwd?: string
): PromptResolution {
    const kebabName = classNameToKebab(className);
    const searchDir = cwd || process.cwd();

    // 1. Search prompts/ directory
    const promptsDir = path.join(searchDir, 'prompts');
    if (fs.existsSync(promptsDir)) {
        // Try: prompts/booking-agent.txt
        const txtFile = path.join(promptsDir, `${kebabName}.txt`);
        if (fs.existsSync(txtFile)) {
            return { prompt: fs.readFileSync(txtFile, 'utf8'), source: 'file' };
        }

        // Try: prompts/@booking-agent.txt (PineCode convention)
        const atFile = path.join(promptsDir, `@${kebabName}.txt`);
        if (fs.existsSync(atFile)) {
            return { prompt: fs.readFileSync(atFile, 'utf8'), source: 'file' };
        }

        // Try: prompts/BookingAgent.txt (exact class name)
        const classFile = path.join(promptsDir, `${className}.txt`);
        if (fs.existsSync(classFile)) {
            return { prompt: fs.readFileSync(classFile, 'utf8'), source: 'file' };
        }
    }

    // 2. Inline prompt
    if (inlinePrompt) {
        return { prompt: inlinePrompt, source: 'inline' };
    }

    // 3. Default
    return {
        prompt: 'You are a helpful AI assistant. Use the available tools to help the user.',
        source: 'default',
    };
}
