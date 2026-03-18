/**
 * board_view — See the full board state (columns, cards, status)
 */

import type { ToolDefinition } from '../../types.ts';

const boardView: ToolDefinition = {
    name: 'board_view',
    description: 'View the current state of the TaskBoard. Shows all columns, cards, their status, assignments, dependencies, and whether they are blocked.',

    schema: {},
    required: [],

    async execute(_params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const board = ctx.taskboard;
        const cards = board.list();

        if (cards.length === 0) {
            return { success: true, result: 'Board is empty — no cards.' };
        }

        const rendered = board.render();
        const summary = `${cards.length} card(s) on the board.`;

        return { success: true, result: `${summary}\n${rendered}` };
    },
};

export default boardView;
