/**
 * Example 3: Streaming with Fluent API
 * 
 * Drift's stream() returns a chainable StreamBuilder.
 * Chain .onText(), .onTool(), .onDone() etc — ActiveRecord style.
 * 
 * Run: node --import tsx examples/03-streaming.ts
 */

import { Agent, tool } from '../packages/drift/src/index.ts';

class StoryAgent extends Agent {
    model = 'haiku';
    prompt = 'You are a creative writer. You can look up word definitions to enrich your writing. Be vivid and engaging.';
    thinking = false;
    maxIterations = 3;

    @tool('Look up a word definition', {
        word: { type: 'string', description: 'Word to define' },
    })
    async define({ word }: { word: string }) {
        const defs: Record<string, string> = {
            serendipity: 'the occurrence of events by chance in a happy way',
            ephemeral: 'lasting for a very short time',
            luminescent: 'emitting light not caused by heat',
        };
        return {
            success: true,
            result: defs[word.toLowerCase()] || `${word}: a beautiful and evocative word`,
        };
    }
}

const agent = new StoryAgent();

console.log('📖 Streaming with fluent API:\n');

// ── Fluent chainable API ──
agent.stream('Write a 3-sentence story using the word "serendipity". Look up its definition first.')
    .onText(chunk => process.stdout.write(chunk))
    .onThinking(text => process.stderr.write(`💭 ${text}`))
    .onTool(({ name, params }) => console.log(`\n  🔧 ${name}(${JSON.stringify(params)})`))
    .onToolResult(({ name, ms }) => console.log(`     ✓ ${name} [${ms}ms]`))
    .onCost(({ total }) => process.stderr.write(''))  // silent
    .onDone(result => {
        console.log(`\n\n📊 ${result.toolCalls.length} tools | $${result.cost.toFixed(6)} | ${result.duration}ms`);
    })
    .onError(err => console.error(`\n❌ ${err.message}`));
