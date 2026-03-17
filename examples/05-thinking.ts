/**
 * Example 5: Thinking Mode + Extended Config
 * 
 * Shows advanced configuration: thinking mode,
 * effort levels, model switching, and cost tracking.
 * 
 * Run: node --import tsx examples/05-thinking.ts
 */

import { Agent, tool } from '../src/index.ts';

class MathAgent extends Agent {
    model = 'haiku';
    thinking = true;       // Enable extended thinking
    effort = 'medium' as const;
    maxIterations = 1;

    @tool('Calculate a mathematical expression', {
        expression: { type: 'string', description: 'Math expression to evaluate' },
    })
    async calculate({ expression }: { expression: string }) {
        try {
            // Safe eval for basic math
            const result = Function(`"use strict"; return (${expression})`)();
            return { success: true, result: `${expression} = ${result}` };
        } catch (e: any) {
            return { success: false, result: `Error: ${e.message}` };
        }
    }
}

const agent = new MathAgent();

// Watch thinking events
agent.on('thinking:delta', ({ text }: any) => {
    process.stdout.write(`💭 ${text}\n`);
});

agent.on('text:delta', ({ chunk }: any) => {
    process.stdout.write(chunk);
});

console.log('🧮 Asking a math question with thinking enabled...\n');

const result = await agent.run(
    'If I have 3 boxes with 7 apples each, and I eat 4 apples, how many are left? Use the calculate tool.'
);

console.log(`\n\n💰 $${result.cost.toFixed(6)} | Model: ${result.model}`);
