/**
 * board_update_card — Update card fields (title, description, assignee, priority)
 */

import type { ToolDefinition } from '../../types.ts';

const boardUpdateCard: ToolDefinition = {
    name: 'board_update_card',
    description: 'Update a card\'s fields: title, description, assignee, or priority. Only provided fields are changed.',

    schema: {
        cardId: { type: 'string', description: 'The card ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        assignee: { type: 'string', description: 'New assignee agent name (optional)' },
        priority: { type: 'number', description: 'New priority 1-5 (optional)' },
    },
    required: ['cardId'],

    async execute(params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const card = ctx.taskboard.get(params.cardId);
        if (!card) {
            return { success: false, result: `Card "${params.cardId}" not found.` };
        }

        const updates: Record<string, any> = { updatedAt: Date.now() };
        const changed: string[] = [];

        if (params.title) { updates.title = params.title; changed.push('title'); }
        if (params.description) { updates.description = params.description; changed.push('description'); }
        if (params.assignee) { updates.assignee = params.assignee; changed.push('assignee'); }
        if (params.priority) { updates.priority = Number(params.priority); changed.push('priority'); }

        if (changed.length === 0) {
            return { success: true, result: 'No fields to update.' };
        }

        ctx.taskboard.update(params.cardId, updates);

        return {
            success: true,
            result: `✅ Updated "${card.title}" [${card.id}]: ${changed.join(', ')}`,
        };
    },
};

export default boardUpdateCard;
