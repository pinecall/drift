/**
 * Unit Tests — TaskBoard (Kanban Coordination)
 * 
 * Tests the TaskBoard class: card CRUD, columns, dependencies,
 * human review, context accumulation, auto-advance, and rendering.
 * 
 * No API calls — pure unit tests.
 */

import { TaskBoard, type Card } from '../../packages/drift/src/coordination/taskboard.ts';

export const name = 'TaskBoard (Kanban)';

// ── Tests ──

export const tests = {
    'addCard creates card in TODO with auto-id'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Fix bug' });

        assert.ok(card.id, 'has id');
        assert.equal(card.column, 'todo', 'default column');
        assert.equal(card.title, 'Fix bug', 'title');
        assert.equal(card.priority, 3, 'default priority');
        assert.ok(card.createdAt > 0, 'has timestamp');
    },

    'moveCard changes column and emits event'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Task 1' });
        const events: any[] = [];
        board.on('card:moved', (e: any) => events.push(e));

        board.moveCard(card.id, 'in_progress');

        const updated = board.get(card.id)!;
        assert.equal(updated.column, 'in_progress', 'column changed');
        assert.equal(events.length, 1, 'moved event emitted');
        assert.equal(events[0].from, 'todo', 'from');
        assert.equal(events[0].to, 'in_progress', 'to');
    },

    'assignCard sets assignee and emits card:assigned'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Task 1' });
        const events: any[] = [];
        board.on('card:assigned', (e: any) => events.push(e));

        board.assignCard(card.id, 'coder');

        assert.equal(board.get(card.id)!.assignee, 'coder', 'assignee set');
        assert.equal(events.length, 1, 'assigned event emitted');
        assert.equal(events[0].agent, 'coder', 'correct agent');
    },

    'addCard with assignee emits card:assigned immediately'(assert: any) {
        const board = new TaskBoard();
        const events: any[] = [];
        board.on('card:assigned', (e: any) => events.push(e));

        board.addCard({ title: 'Auto-assign', assignee: 'reviewer' });

        assert.equal(events.length, 1, 'assigned on add');
        assert.equal(events[0].agent, 'reviewer', 'correct agent');
    },

    'isBlocked returns true when dependency not done'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dependency' });
        const card = board.addCard({ title: 'Blocked', dependsOn: [dep.id] });

        assert.ok(board.isBlocked(card.id), 'blocked');
        assert.equal(board.getBlockers(card.id).length, 1, 'one blocker');
    },

    'isBlocked returns false when dependency is done'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dependency' });
        const card = board.addCard({ title: 'Waiting', dependsOn: [dep.id] });

        board.moveCard(dep.id, 'done');

        assert.ok(!board.isBlocked(card.id), 'unblocked');
        assert.equal(board.getBlockers(card.id).length, 0, 'no blockers');
    },

    'card auto-unblocks when dep moves to done'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dep' });
        const card = board.addCard({ title: 'Waiting', dependsOn: [dep.id] });
        const events: any[] = [];
        board.on('card:unblocked', (e: any) => events.push(e));

        board.moveCard(dep.id, 'done');

        assert.equal(events.length, 1, 'unblocked event');
        assert.equal(events[0].card.id, card.id, 'correct card unblocked');
    },

    'blocked card with assignee dispatches on unblock'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dep' });
        const card = board.addCard({ title: 'Waiting', assignee: 'tester', dependsOn: [dep.id] });
        const events: any[] = [];
        // card:assigned should NOT fire on add (blocked)
        board.on('card:assigned', (e: any) => events.push(e));

        // This should only fire card:assigned for the dep card if it has assignee
        // But dep has no assignee, so no card:assigned events yet
        assert.equal(events.length, 0, 'no assigned event while blocked');

        board.moveCard(dep.id, 'done');

        assert.equal(events.length, 1, 'assigned on unblock');
        assert.equal(events[0].agent, 'tester', 'correct agent');
    },

    'getReady returns unblocked TODO cards'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dep' });
        board.addCard({ title: 'Blocked', dependsOn: [dep.id] });
        board.addCard({ title: 'Ready card' });

        const ready = board.getReady();
        assert.equal(ready.length, 2, '2 ready cards (dep + ready)');
    },

    'appendContext accumulates text with separator'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Task' });

        board.appendContext(card.id, 'First chunk');
        board.appendContext(card.id, 'Second chunk');

        const updated = board.get(card.id)!;
        assert.includes(updated.context!, 'First chunk', 'has first');
        assert.includes(updated.context!, 'Second chunk', 'has second');
        assert.includes(updated.context!, '---', 'has separator');
    },

    'setResult sets output and auto-advances to done'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Task' });
        board.moveCard(card.id, 'in_progress');

        board.setResult(card.id, 'Implementation complete');

        const updated = board.get(card.id)!;
        assert.equal(updated.result, 'Implementation complete', 'result set');
        assert.equal(updated.column, 'done', 'auto-advanced to done');
    },

    'setResult with requiresHumanReview stops at in_review'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Review', requiresHumanReview: true });
        board.moveCard(card.id, 'in_progress');

        board.setResult(card.id, 'Done, needs review');

        assert.equal(board.get(card.id)!.column, 'in_review', 'stopped at review');
    },

    'approveCard moves from in_review to next column'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Review me', requiresHumanReview: true });
        board.moveCard(card.id, 'in_review');
        const events: any[] = [];
        board.on('card:approved', (e: any) => events.push(e));

        board.approveCard(card.id);

        assert.equal(board.get(card.id)!.column, 'qa', 'moved to qa');
        assert.equal(events.length, 1, 'approved event');
    },

    'rejectCard moves back to todo with reason'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Bad task' });
        board.moveCard(card.id, 'in_review');
        const events: any[] = [];
        board.on('card:rejected', (e: any) => events.push(e));

        board.rejectCard(card.id, 'Not good enough');

        assert.equal(board.get(card.id)!.column, 'todo', 'moved to todo');
        assert.includes(board.get(card.id)!.context!, 'Rejected', 'reason in context');
        assert.equal(events.length, 1, 'rejected event');
        assert.equal(events[0].reason, 'Not good enough', 'reason');
    },

    'byColumn returns cards in specific column'(assert: any) {
        const board = new TaskBoard();
        board.addCard({ title: 'A' });
        board.addCard({ title: 'B' });
        const c = board.addCard({ title: 'C' });
        board.moveCard(c.id, 'in_progress');

        assert.equal(board.byColumn('todo').length, 2, '2 in todo');
        assert.equal(board.byColumn('in_progress').length, 1, '1 in progress');
    },

    'byAssignee returns cards for agent'(assert: any) {
        const board = new TaskBoard();
        board.addCard({ title: 'For coder', assignee: 'coder' });
        board.addCard({ title: 'For coder 2', assignee: 'coder' });
        board.addCard({ title: 'For reviewer', assignee: 'reviewer' });

        assert.equal(board.byAssignee('coder').length, 2, 'coder has 2');
        assert.equal(board.byAssignee('reviewer').length, 1, 'reviewer has 1');
    },

    'render produces Kanban XML'(assert: any) {
        const board = new TaskBoard();
        board.addCard({ title: 'Task 1', assignee: 'coder', priority: 1 });
        board.addCard({ title: 'Task 2', labels: ['bug'] });

        const xml = board.render();
        assert.includes(xml, '<taskboard', 'has taskboard tag');
        assert.includes(xml, '<column name="todo"', 'has todo column');
        assert.includes(xml, 'assignee="coder"', 'has assignee');
        assert.includes(xml, 'priority="1"', 'has priority');
        assert.includes(xml, 'labels="bug"', 'has labels');
    },

    'render shows blocked attribute'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Dep' });
        board.addCard({ title: 'Blocked', dependsOn: [dep.id] });

        const xml = board.render();
        assert.includes(xml, 'blocked="true"', 'shows blocked');
        assert.includes(xml, 'depends-on=', 'shows depends-on');
    },

    'buildDispatchMessage includes dependency results'(assert: any) {
        const board = new TaskBoard();
        const dep = board.addCard({ title: 'Write code' });
        board.update(dep.id, { result: 'auth.ts implemented' } as Partial<Card>);
        board.moveCard(dep.id, 'done');

        const card = board.addCard({ title: 'Write tests', dependsOn: [dep.id] });
        const msg = board.buildDispatchMessage(card);

        assert.includes(msg, 'Write tests', 'has title');
        assert.includes(msg, 'auth.ts implemented', 'has dep result');
        assert.includes(msg, 'dependency_results', 'has dep context');
    },

    'toJSON/loadJSON persistence roundtrip'(assert: any) {
        const board = new TaskBoard();
        board.addCard({ title: 'Task 1', assignee: 'coder' });
        board.addCard({ title: 'Task 2', priority: 1 });

        const json = board.toJSON();
        const board2 = new TaskBoard();
        board2.loadJSON(json);

        assert.equal(board2.list().length, 2, 'restored 2 cards');
        assert.equal(board2.list().find((c: Card) => c.title === 'Task 1')?.assignee, 'coder', 'assignee preserved');
    },

    'custom columns work'(assert: any) {
        const board = new TaskBoard(['backlog', 'sprint', 'done']);
        const card = board.addCard({ title: 'Feature' });

        assert.deepEqual(board.state.columns, ['backlog', 'sprint', 'done'], 'custom columns');
        board.moveCard(card.id, 'sprint');
        assert.equal(board.get(card.id)!.column, 'sprint', 'moved to sprint');
    },

    'unassignCard removes assignee'(assert: any) {
        const board = new TaskBoard();
        const card = board.addCard({ title: 'Task', assignee: 'coder' });
        board.unassignCard(card.id);
        assert.equal(board.get(card.id)!.assignee, undefined, 'assignee removed');
    },

    'multiple dependencies: all must be done'(assert: any) {
        const board = new TaskBoard();
        const dep1 = board.addCard({ title: 'Dep 1' });
        const dep2 = board.addCard({ title: 'Dep 2' });
        const card = board.addCard({ title: 'Blocked', dependsOn: [dep1.id, dep2.id] });

        board.moveCard(dep1.id, 'done');
        assert.ok(board.isBlocked(card.id), 'still blocked (dep2 not done)');

        board.moveCard(dep2.id, 'done');
        assert.ok(!board.isBlocked(card.id), 'unblocked (all deps done)');
    },

    'autoAssign false prevents card:assigned emission'(assert: any) {
        const board = new TaskBoard();
        board.setState({ autoAssign: false } as any);
        const events: any[] = [];
        board.on('card:assigned', (e: any) => events.push(e));

        board.addCard({ title: 'Task', assignee: 'coder' });
        assert.equal(events.length, 0, 'no auto-assign');
    },
};
