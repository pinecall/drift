/**
 * Example 6: defineTool — JavaScript-Compatible API
 * 
 * For projects not using TypeScript decorators,
 * you can use the static defineTool() method instead.
 * 
 * Run: node --import tsx examples/06-define-tool.ts
 */

import { Agent, defineTool } from '../src/index.ts';

class TodoAgent extends Agent {
    model = 'haiku';
    prompt = 'You manage a todo list. Use addTodo and listTodos to help users. Be concise.';
    thinking = false;

    private todos: string[] = [];

    async addTodo({ task }: { task: string }) {
        this.todos.push(task);
        return { success: true, result: `Added: "${task}" (${this.todos.length} total)` };
    }

    async listTodos() {
        if (this.todos.length === 0) {
            return { success: true, result: 'No todos yet!' };
        }
        const list = this.todos.map((t, i) => `${i + 1}. ${t}`).join('\n');
        return { success: true, result: `Todos:\n${list}` };
    }
}

// Register tools without decorators (JS-friendly)
defineTool(TodoAgent, 'addTodo', 'Add a new todo item', {
    task: { type: 'string', description: 'The todo task description' },
});

defineTool(TodoAgent, 'listTodos', 'List all current todos', {});

// Use the agent
const agent = new TodoAgent();

agent.on('tool:execute', ({ name }: any) => console.log(`🔧 ${name}`));

try {
    const result = await agent.run('Add "Buy groceries" and "Walk the dog" to my list, then show all todos.');
    
    console.log('\n📝 Response:');
    console.log(result.text);
    console.log(`\n🔧 ${result.toolCalls.length} tool calls | 💰 $${result.cost.toFixed(6)}`);
} catch (err: any) {
    console.error(`❌ ${err.message}`);
    if (err.message.includes('Connection') || err.message.includes('API')) {
        console.error('   Make sure ANTHROPIC_API_KEY is set');
    }
}
