/**
 * Example 1: Quick Agent — Minimal setup
 * 
 * The simplest possible Drift agent. No decorators, no custom tools.
 * Just send a prompt and get a response.
 * 
 * Run: node --import tsx examples/01-quick.ts
 */

import { Agent } from '../src/index.ts';

const agent = new Agent({
    model: 'haiku',
    prompt: 'You are a helpful assistant. Be concise.',
    thinking: false,
    maxIterations: 1,
});

const result = await agent.run('What are the three laws of robotics? List them briefly.');

console.log('\n📝 Response:');
console.log(result.text);
console.log(`\n💰 Cost: ${result.cost.toFixed(6)}`);
console.log(`⏱  Duration: ${result.duration}ms`);
