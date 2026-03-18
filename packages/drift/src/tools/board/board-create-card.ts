/**
 * board_create_card — Create a new card on the TaskBoard
 */

import type { ToolDefinition } from '../../types.ts';

const boardCreateCard: ToolDefinition = {
    name: 'board_create_card',
    description: 'Create a new card on the TaskBoard. Set title, description, assignee, dependencies, and priority. Cards with an assignee and no blockers are auto-dispatched.',

    schema: {
        title: { type: 'string', description: 'Card title (required)' },
        description: { type: 'string', description: 'Detailed description of what needs to be done' },
        assignee: { type: 'string', description: 'Agent name to assign (e.g. "backend", "ui"). Omit for unassigned.' },
        dependsOn: { type: 'string', description: 'Comma-separated card IDs this card depends on (e.g. "card-1,card-2")' },
        priority: { type: 'number', description: 'Priority 1-5 (1=Critical, 3=Medium, 5=Lowest). Default: 3' },
        labels: { type: 'string', description: 'Comma-separated labels (e.g. "backend,api")' },
        requiresHumanReview: { type: 'boolean', description: 'If true, card pauses at in_review for human approval' },
    },
    required: ['title'],

    async execute(params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const input: Record<string, any> = {
            title: params.title,
        };

        if (params.description) input.description = params.description;
        if (params.assignee) input.assignee = params.assignee;
        if (params.priority) input.priority = Number(params.priority);
        if (params.requiresHumanReview) input.requiresHumanReview = true;
        if (params.labels) input.labels = params.labels.split(',').map((l: string) => l.trim());

        if (params.dependsOn) {
            input.dependsOn = params.dependsOn.split(',').map((id: string) => id.trim());
        }

        const card = ctx.taskboard.addCard(input);

        const blocked = ctx.taskboard.isBlocked(card.id);
        const status = blocked ? '(blocked — waiting for dependencies)' : card.assignee ? '(auto-dispatching)' : '(unassigned)';

        return {
            success: true,
            result: `✅ Created card "${card.title}" [${card.id}] ${status}`,
        };
    },
};

export default boardCreateCard;
