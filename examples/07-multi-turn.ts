/**
 * Example 7: Multi-Turn Conversation
 * 
 * Shows multiple turns with the same agent where it remembers
 * context from previous messages. Also demos the conversation history API.
 * 
 * Run: node --import tsx examples/07-multi-turn.ts
 */

import { Agent, tool } from '../packages/drift/src/index.ts';

class NotesAgent extends Agent {
    model = 'haiku';
    prompt = 'You are a personal notes assistant. Help users manage notes. Be very concise (1-2 sentences). Remember what was said earlier in the conversation.';
    thinking = false;
    maxIterations = 3;

    private notes: Map<string, string> = new Map();

    @tool('Save a note with a title', {
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content' },
    })
    async saveNote({ title, content }: { title: string; content: string }) {
        this.notes.set(title, content);
        return { success: true, result: `Saved note "${title}"` };
    }

    @tool('Get a note by title', {
        title: { type: 'string', description: 'Note title to retrieve' },
    })
    async getNote({ title }: { title: string }) {
        const note = this.notes.get(title);
        if (!note) return { success: false, result: `Note "${title}" not found` };
        return { success: true, result: `"${title}": ${note}` };
    }

    @tool('List all saved notes', {})
    async listNotes() {
        if (this.notes.size === 0) return { success: true, result: 'No notes saved yet.' };
        const list = [...this.notes.entries()].map(([t, c]) => `• ${t}: ${c}`).join('\n');
        return { success: true, result: `Notes:\n${list}` };
    }
}

// ── Multi-turn conversation ──

const agent = new NotesAgent();

agent.on('tool:execute', ({ name, params }: any) => {
    console.log(`    🔧 ${name}(${JSON.stringify(params)})`);
});

async function chat(message: string) {
    console.log(`\n👤 ${message}`);
    const result = await agent.run(message);
    console.log(`🤖 ${result.text}`);
    return result;
}

// Turn 1
await chat('Save a note called "shopping" with "milk, bread, eggs"');

// Turn 2 — agent should remember we just saved a note
await chat('What did I just save?');

// Turn 3 — add another note
await chat('Also save a note "todo" with "finish the drift framework"');

// Turn 4 — ask for all notes
await chat('Show me all my notes');

// Turn 5 — test context memory
await chat('What was in the shopping note?');

// ── Show conversation history ──
console.log('\n━━━ Conversation History ━━━');
console.log(`Messages: ${agent.conversation.length}`);
console.log(`Total cost: $${agent.cost.toFixed(6)}`);
console.log(`\nFull history:`);
for (const msg of agent.conversation.messages) {
    const role = msg.role.toUpperCase().padEnd(10);
    if (typeof msg.content === 'string') {
        console.log(`  ${role} ${msg.content.slice(0, 80)}`);
    } else {
        for (const block of msg.content) {
            if (block.type === 'text') {
                console.log(`  ${role} [text] ${block.text.slice(0, 70)}...`);
            } else if (block.type === 'tool_use') {
                console.log(`  ${role} [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 50)})`);
            } else if (block.type === 'tool_result') {
                console.log(`  ${role} [result] ${block.content.slice(0, 60)}`);
            }
        }
    }
}
