/**
 * Integration Tests — Multi-Agent TaskBoard Project
 * 
 * Full Trello flow with 4 agents:
 *   1. ManagerAgent: receives project brief, creates cards with deps and assignments
 *   2. DesignDev (DeveloperLite): creates HTML/CSS
 *   3. BackendDev (DeveloperLite): creates JavaScript
 *   4. TesterAgent (Playwright): tests the result in browser
 * 
 * The Manager uses board_create_card to plan the project.
 * Cards auto-dispatch as dependencies resolve.
 * Per-card windows isolate and inherit files.
 * 
 * Requires: ANTHROPIC_API_KEY
 * Playwright test is optional — skips gracefully if MCP unavailable.
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

export const name = 'Integration — Multi-Agent Project';

// ── Specialized Agents (inherit DeveloperLite) ──

/** Design developer — HTML/CSS */
class DesignDev extends DeveloperLiteAgent {
    model = 'sonnet';
    prompt = `<role>
You are a UI designer. You create HTML and CSS files.
Do NOT write JavaScript logic — that is for the backend developer.
When JS is needed, add <script src="app.js"></script> to reference an external file.
</role>
<editing_rules>
Target complete logical blocks. Line verification — CRITICAL:
startLineContent/endLineContent = trimmed text of the SINGLE line at that number.
Indentation: newContent is written directly to disk.
</editing_rules>`;
    effort: 'low' | 'medium' | 'high' | 'max' = 'low';
    maxIterations = 8;
    builtinTools = ['edit', 'filesystem'];
}

/** Backend developer — JavaScript */
class BackendDev extends DeveloperLiteAgent {
    model = 'sonnet';
    prompt = `<role>
You are a JavaScript developer. You write .js files with vanilla JS logic.
Read the HTML files from the design developer first, then create JS that makes the page interactive.
</role>
<editing_rules>
Target complete logical blocks. Line verification — CRITICAL:
startLineContent/endLineContent = trimmed text of the SINGLE line at that number.
Indentation: newContent is written directly to disk.
</editing_rules>`;
    effort: 'low' | 'medium' | 'high' | 'max' = 'low';
    maxIterations = 8;
    builtinTools = ['edit', 'filesystem'];
}

// ── Dispatch + wiring ──

function createDispatch(agentMap: Map<string, any>): DispatchFn {
    return async (agentName, message, options) => {
        const agent = agentMap.get(agentName);
        if (!agent) throw new Error(`Unknown agent: "${agentName}"`);
        const sid = options?.sessionId || `__dispatch__:${agentName}:${Date.now()}`;
        const session = new Session(agent, { id: sid });
        const result = await session.run(message, { timeout: options?.timeout || 60_000 });
        return {
            text: result.text,
            cost: result.cost,
            toolCalls: result.toolCalls.map(tc => ({ name: tc.name, params: tc.input })),
            sessionId: sid,
            aborted: result.aborted,
        };
    };
}

function wireBoard(board: TaskBoard, dispatch: DispatchFn, agentMap: Map<string, any>) {
    board.on('card:assigned', async ({ card, agent: agentName }: { card: Card; agent: string }) => {
        const agentObj = agentMap.get(agentName);
        if (!agentObj) return;

        const message = board.buildDispatchMessage(card);

        // Per-card window
        if (!card.window && agentObj.window instanceof CodebaseWindow) {
            card.window = new CodebaseWindow({ cwd: (agentObj.window as CodebaseWindow).cwd });
        }

        // Inherit files from done deps
        if (card.dependsOn?.length && card.window) {
            for (const depId of card.dependsOn) {
                const dep = board.get(depId);
                if (dep?.window) {
                    for (const file of dep.window.list()) {
                        if (!card.window.has(file.id)) {
                            card.window.open((file as any).fullPath);
                        }
                    }
                }
            }
        }

        // Swap window
        const originalWindow = agentObj.window;
        if (card.window) {
            agentObj.window = card.window;
            agentObj.taskboard = board;
        }

        try {
            board.moveCard(card.id, 'in_progress');
            const result = await dispatch(agentName, message, { source: `board:${card.id}` });
            const current = board.get(card.id);
            if (current?.column === 'in_progress' && result?.text) {
                board.setResult(card.id, result.text);
            }
        } catch (err: any) {
            board.appendContext(card.id, `❌ Error: ${err.message}`);
            board.moveCard(card.id, 'todo');
        } finally {
            agentObj.window = originalWindow;
        }
    });
}

async function waitForCard(board: TaskBoard, cardId: string, column: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const card = board.get(cardId);
        if (card?.column === column) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

async function waitForAllDone(board: TaskBoard, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const cards = board.list();
        if (cards.length > 0 && cards.every(c => c.column === 'done')) return true;
        await new Promise(r => setTimeout(r, 3000));
    }
    return false;
}

// ── Tests ──

export const tests = {

    async 'Manager plans project, DesignDev + BackendDev build todo app'(assert: any) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-project-'));
        console.log(`  📁 Project dir: ${tmpDir}`);

        const board = new TaskBoard();
        const manager = new ManagerAgent();
        const designDev = new DesignDev();
        const backendDev = new BackendDev();

        // All dev agents get the same cwd
        designDev.window = new CodebaseWindow({ cwd: tmpDir });
        backendDev.window = new CodebaseWindow({ cwd: tmpDir });

        // Manager gets board injected (for board tools)
        manager.taskboard = board;

        const agentMap = new Map<string, any>([
            ['manager', manager],
            ['design', designDev],
            ['backend', backendDev],
        ]);
        const dispatch = createDispatch(agentMap);
        wireBoard(board, dispatch, agentMap);

        // ── Step 1: Dispatch Manager to plan the project ──
        console.log('  🤖 Manager planning project...');

        const managerSession = new Session(manager, { id: 'manager-planning' });
        const planResult = await managerSession.run(
            `Plan a simple todo app project. The project directory is: ${tmpDir}

Available agents to assign:
- "design" — creates HTML and CSS files (NOT JavaScript)
- "backend" — creates JavaScript logic files

Create the following cards on the board:
1. A card for "design" to create index.html with: <h1>Todo App</h1>, an input#todo-input, a button#add-btn, a ul#todo-list, and a <script src="app.js"></script>. Include simple inline CSS styling.
2. A card for "backend" to create app.js that makes the todo app work (add items on click, remove on double-click). This card MUST depend on card 1 since the backend needs to see the HTML first.

Use board_create_card to create each card. Set proper dependencies and priorities.`,
            { timeout: 45_000 },
        );

        console.log(`  📋 Manager created ${board.list().length} card(s)`);
        assert.ok(board.list().length >= 2, `Manager created cards: ${board.list().length}`);

        // Log what the manager created
        for (const card of board.list()) {
            console.log(`     • [${card.id}] "${card.title}" → ${card.assignee || 'unassigned'} (${card.column}) deps: ${card.dependsOn?.join(',') || 'none'}`);
        }

        // ── Step 2: Wait for all cards to complete ──
        console.log('  ⏳ Agents working...');

        const allDone = await waitForAllDone(board, 120_000);

        // Log final state
        console.log('  📊 Final board state:');
        for (const card of board.list()) {
            console.log(`     • [${card.id}] "${card.title}" → ${card.column}`);
        }

        assert.ok(allDone, 'all cards completed');

        // ── Step 3: Verify files ──
        const htmlPath = path.join(tmpDir, 'index.html');
        const jsPath = path.join(tmpDir, 'app.js');

        assert.ok(fs.existsSync(htmlPath), 'index.html was created');
        assert.ok(fs.existsSync(jsPath), 'app.js was created');

        const html = fs.readFileSync(htmlPath, 'utf8');
        const js = fs.readFileSync(jsPath, 'utf8');

        assert.includes(html, 'todo', 'HTML has todo content');
        assert.includes(html, 'app.js', 'HTML references app.js');
        assert.ok(js.length > 20, 'app.js has real content');

        console.log(`  ✅ Project built: ${html.length} bytes HTML, ${js.length} bytes JS`);

        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });
    },

    async 'Full pipeline with Playwright tester (Manager → Design → Backend → QA)'(assert: any) {
        // Check Playwright availability
        let tester: PlaywrightAgent;
        try {
            tester = new PlaywrightAgent();
            await tester.connect({ args: ['-y', '@playwright/mcp@latest', '--headless'] });
        } catch (err: any) {
            console.log(`  ⚠  Skipping Playwright test: ${err.message}`);
            assert.ok(true, 'skipped — Playwright MCP not available');
            return;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-e2e-'));
        console.log(`  📁 E2E project dir: ${tmpDir}`);

        const board = new TaskBoard();
        const manager = new ManagerAgent();
        const designDev = new DesignDev();
        const backendDev = new BackendDev();

        designDev.window = new CodebaseWindow({ cwd: tmpDir });
        backendDev.window = new CodebaseWindow({ cwd: tmpDir });
        manager.taskboard = board;

        const agentMap = new Map<string, any>([
            ['manager', manager],
            ['design', designDev],
            ['backend', backendDev],
            ['tester', tester],
        ]);
        const dispatch = createDispatch(agentMap);
        wireBoard(board, dispatch, agentMap);

        // ── Manager plans with 3 cards (design → backend → tester) ──
        console.log('  🤖 Manager planning E2E project...');

        const managerSession = new Session(manager, { id: 'manager-e2e' });
        await managerSession.run(
            `Plan a counter app project. Directory: ${tmpDir}

Available agents:
- "design" — HTML/CSS files
- "backend" — JavaScript files
- "tester" — browser testing (Playwright, can navigate to file:// URLs)

Create 3 cards:
1. "design" creates index.html: <h1>Counter</h1>, <p id="count">0</p>, <button id="increment">+1</button>, <script src="counter.js"></script>, nice CSS
2. "backend" creates counter.js: increment count on click. DEPENDS ON card 1.
3. "tester" opens file://${tmpDir}/index.html, verifies h1 says "Counter", count shows "0", clicks +1, verifies count is "1". DEPENDS ON card 2.

Use board_create_card for each.`,
            { timeout: 45_000 },
        );

        console.log(`  📋 Manager created ${board.list().length} card(s)`);
        assert.ok(board.list().length >= 3, 'Manager created 3+ cards');

        // Wait for full pipeline
        console.log('  ⏳ Design → Backend → Tester pipeline...');
        const allDone = await waitForAllDone(board, 180_000);

        console.log('  📊 Final board:');
        for (const card of board.list()) {
            console.log(`     • [${card.id}] "${card.title}" → ${card.column}`);
        }

        assert.ok(allDone, 'all cards completed');
        assert.ok(fs.existsSync(path.join(tmpDir, 'index.html')), 'HTML exists');
        assert.ok(fs.existsSync(path.join(tmpDir, 'counter.js')), 'JS exists');

        // Tester should have produced a result
        const testerCards = board.list().filter(c => c.assignee === 'tester');
        if (testerCards.length > 0) {
            assert.ok(testerCards[0].result, 'tester produced result');
            console.log(`  🧪 Tester: ${testerCards[0].result?.substring(0, 200)}`);
        }

        console.log('  ✅ Full E2E pipeline completed');
        try { await tester.close(); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
    },
};
