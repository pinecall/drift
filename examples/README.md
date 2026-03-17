# Drift Examples

Run any example with Node 24:

```bash
node --import tsx examples/01-quick.ts
```

> **Requires**: `ANTHROPIC_API_KEY` environment variable

## Examples

| # | File | What it shows |
|---|------|---------------|
| 01 | `01-quick.ts` | Minimal agent — send prompt, get response |
| 02 | `02-custom-tools.ts` | `@tool` decorator with multiple custom tools |
| 03 | `03-streaming.ts` | Real-time `stream()` API for chat/CLI |
| 04 | `04-builtin-tools.ts` | Auto-loaded prompt + built-in filesystem tools |
| 05 | `05-thinking.ts` | Extended thinking mode + effort levels |
| 06 | `06-define-tool.ts` | `defineTool()` JS-compatible API (no decorators) |

## Key Patterns

```typescript
// 1. Quick inline agent
const agent = new Agent({ model: 'haiku', prompt: '...' });
const result = await agent.run('Hello');

// 2. Class with decorators
class MyAgent extends Agent {
    model = 'sonnet';
    
    @tool('description', { param: { type: 'string', description: '...' } })
    async myTool({ param }) { return { success: true, result: '...' }; }
}

// 3. Auto-loaded prompt
// prompts/my-custom.txt ← loaded for MyCustomAgent

// 4. Stream
agent.stream('Hello').on('text', chunk => process.stdout.write(chunk));
```
