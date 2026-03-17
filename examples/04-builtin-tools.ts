/**
 * Example 4: File-Based Prompt + Built-in Tools
 * 
 * Demonstrates auto-loading prompts from prompts/ directory
 * and using built-in filesystem tools.
 * 
 * The prompt for CodeReviewAgent is auto-loaded from:
 *   prompts/code-review.txt  (CodeReviewAgent → code-review)
 * 
 * Run: node --import tsx examples/04-builtin-tools.ts
 */

import { Agent } from '../src/index.ts';

class CodeReviewAgent extends Agent {
    model = 'haiku';
    thinking = false;
    maxIterations = 3;

    // Prompt auto-loads from examples/prompts/code-review.txt
    // Only allow safe read-only tools
    allowedTools = ['list_dir', 'grep_search', 'open_files'];
}

const agent = new CodeReviewAgent({ cwd: process.cwd() });

// Track tool usage
agent.on('tool:execute', ({ name, params }: any) => {
    console.log(`🔧 ${name}(${JSON.stringify(params).slice(0, 80)}...)`);
});

const result = await agent.run('List the files in the current directory and tell me what this project is about.');

console.log('\n📝 Analysis:');
console.log(result.text);
console.log(`\n🔧 ${result.toolCalls.length} tool calls | 💰 $${result.cost.toFixed(6)}`);
