#!/usr/bin/env npx tsx
/**
 * Multi-Agent Demo — Watch Playwright test the app
 * 
 * Run: npx tsx test/integration/multi-agent-demo.ts
 * 
 * Full pipeline:
 *   1. ManagerAgent plans the project (board_create_card)
 *   2. DesignDev creates index.html (HTML/CSS)
 *   3. BackendDev creates counter.js (JavaScript)
 *   4. PlaywrightAgent opens browser and tests the counter app
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
    DeveloperLiteAgent, ManagerAgent, TaskBoard, PlaywrightAgent,
} from '../../packages/drift/src/index.ts';
import { CodebaseWindow } from '../../packages/drift/src/windows/codebase-window.tsx';
import type { Card, DispatchFn } from '../../packages/drift/src/index.ts';
import { Session } from '../../packages/drift/src/core/session.ts';

// ── Agents ──

class DesignDev extends DeveloperLiteAgent {
    model = 'sonnet';
    prompt = `<role>
You are a UI designer. Create HTML and CSS files. Do NOT write JavaScript.
Use <script src="counter.js"></script> when JS is needed.
</role>
<editing_rules>
Target complete logical blocks. startLineContent/endLineContent = trimmed text of ONE line.
</editing_rules>`;
    effort: 'low' | 'medium' | 'high' | 'max' = 'low';
    maxIterations = 8;
    builtinTools = ['edit', 'filesystem'];
}

class BackendDev extends DeveloperLiteAgent {
    model = 'sonnet';
    prompt = `<role>
You are a JavaScript developer. Write .js files with vanilla JS.
Read HTML files first, then create JS that makes the page interactive.
</role>
<editing_rules>
Target complete logical blocks. startLineContent/endLineContent = trimmed text of ONE line.
</editing_rules>`;
    effort: 'low' | 'medium' | 'high' | 'max' = 'low';
    maxIterations = 8;
    builtinTools = ['edit', 'filesystem'];
}

// ── Wiring ──

function createDispatch(agentMap: Map<string, any>): DispatchFn {
    return async (agentName, message, options) => {
        const agent = agentMap.get(agentName);
        if (!agent) throw new Error(`Unknown agent: "${agentName}"`);
        const sid = `__dispatch__:${agentName}:${Date.now()}`;
        const session = new Session(agent, { id: sid });
        const result = await session.run(message, { timeout: options?.timeout || 90_000 });
        return {
            text: result.text, cost: result.cost,
            toolCalls: result.toolCalls.map(tc => ({ name: tc.name, params: tc.input })),
            sessionId: sid, aborted: result.aborted,
        };
    };
}

function wireBoard(board: TaskBoard, dispatch: DispatchFn, agentMap: Map<string, any>) {
    board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
        const agentObj = agentMap.get(agentName);
        if (!agentObj) return;

        const message = board.buildDispatchMessage(card);

        if (!card.window && agentObj.window instanceof CodebaseWindow) {
            card.window = new CodebaseWindow({ cwd: (agentObj.window as CodebaseWindow).cwd });
        }

        if (card.dependsOn?.length && card.window) {
            for (const depId of card.dependsOn) {
                const dep = board.get(depId);
                if (dep?.window) {
                    for (const file of dep.window.list()) {
                        if (!card.window.has(file.id)) card.window.open((file as any).fullPath);
                    }
                }
            }
        }

        const originalWindow = agentObj.window;
        if (card.window) { agentObj.window = card.window; agentObj.taskboard = board; }

        try {
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            const current = board.get(card.id);
            if (current?.column === 'in_progress' && result?.text) board.setResult(card.id, result.text);
        } catch (err: any) {
            board.appendContext(card.id, `❌ Error: ${err.message}`);
            board.moveCard(card.id, 'todo');
        } finally {
            agentObj.window = originalWindow;
        }
    });
}

async function waitForAllDone(board: TaskBoard, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const cards = board.list();
        if (cards.length > 0 && cards.every(c => c.column === 'done')) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

// ── Main ──

async function main() {
    console.log('\n🎬 Multi-Agent Demo — Manager → Design → Backend → Playwright\n');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-demo-'));
    console.log(`📁 Project dir: ${tmpDir}\n`);

    const board = new TaskBoard();
    const manager = new ManagerAgent();
    const designDev = new DesignDev();
    const backendDev = new BackendDev();

    designDev.window = new CodebaseWindow({ cwd: tmpDir });
    backendDev.window = new CodebaseWindow({ cwd: tmpDir });
    manager.taskboard = board;

    // Log board events
    board.on('card:moved', ({ card, from, to }: any) => {
        console.log(`  📌 [${card.id}] moved: ${from} → ${to}`);
    });
    board.on('card:unblocked', ({ card }: any) => {
        console.log(`  🔓 [${card.id}] "${card.title}" unblocked!`);
    });

    const agentMap = new Map<string, any>([
        ['manager', manager],
        ['design', designDev],
        ['backend', backendDev],
    ]);
    const dispatch = createDispatch(agentMap);
    wireBoard(board, dispatch, agentMap);

    // ── Step 1: Manager plans ──
    console.log('🤖 Step 1: Manager planning project...\n');

    const managerSession = new Session(manager, { id: 'manager-demo' });
    await managerSession.run(
        `Plan a counter app. Directory: ${tmpDir}

Agents: "design" (HTML/CSS), "backend" (JavaScript)

Create 2 cards:
1. "design" creates index.html: <h1>Counter App</h1>, <p id="count">0</p>, <button id="increment">+1</button>, <script src="counter.js"></script>. Nice dark theme CSS.
2. "backend" creates counter.js: increment count on button click. DEPENDS ON card 1.

Use board_create_card.`,
        { timeout: 45_000 },
    );

    console.log(`\n📋 Board: ${board.list().length} card(s)\n`);
    for (const card of board.list()) {
        console.log(`   • [${card.id}] "${card.title}" → ${card.assignee} (${card.column}) deps: ${card.dependsOn?.join(',') || 'none'}`);
    }

    // ── Step 2: Wait for devs ──
    console.log('\n⏳ Step 2: Agents building...\n');
    await waitForAllDone(board, 120_000);

    console.log('\n📊 Board state:');
    for (const card of board.list()) {
        console.log(`   • [${card.id}] "${card.title}" → ${card.column}`);
    }

    // Verify files
    const htmlPath = path.join(tmpDir, 'index.html');
    const jsPath = path.join(tmpDir, 'counter.js');

    if (!fs.existsSync(htmlPath) || !fs.existsSync(jsPath)) {
        console.error('\n❌ Files not created. Aborting Playwright step.');
        process.exit(1);
    }

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    console.log(`\n📄 index.html: ${htmlContent.length} bytes`);
    console.log(`📄 counter.js: ${jsContent.length} bytes`);

    // ── Step 3: Playwright tests the app ──
    console.log('\n🎭 Step 3: Playwright testing the app (visible browser)...\n');

    const playwright = new PlaywrightAgent();
    try {
        // No --headless flag → browser is visible!
        const tools = await playwright.connect({
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
        });
        console.log(`   Playwright connected: ${tools.length} browser tools\n`);
    } catch (err: any) {
        console.error(`❌ Playwright connection failed: ${err.message}`);
        console.log('   Try: npm install -g @playwright/mcp');
        process.exit(1);
    }

    const pwSession = new Session(playwright, { id: 'playwright-test' });
    const testResult = await pwSession.run(
        `Test the counter app at file://${htmlPath}

Steps:
1. Navigate to file://${htmlPath}
2. Take a snapshot — verify there's an h1 with "Counter"
3. Verify the count shows "0"
4. Click the +1 button
5. Take another snapshot — verify the count is now "1"
6. Click +1 two more times
7. Verify the count is "3"

Report PASS/FAIL for each step.`,
        { timeout: 60_000 },
    );

    console.log('\n🧪 Playwright Result:\n');
    console.log(testResult.text);
    console.log(`\n💰 Cost: $${testResult.cost.toFixed(4)}`);

    await playwright.close();

    // Cleanup
    console.log(`\n🗂  Files preserved at: ${tmpDir}`);
    console.log('✅ Demo complete!\n');
}

main().catch(err => {
    console.error('❌ Demo failed:', err.message);
    process.exit(1);
});
