/**
 * ReviewerAgent — Task quality review and sprint reporting
 * 
 * Specializes in:
 *   - Reviewing completed tasks for quality and completeness
 *   - Adding review notes and feedback to task descriptions
 *   - Generating sprint summaries
 * 
 * Shares the same TaskBoardWindow and Workspace as other agents.
 */

import { Agent, tool } from 'drift';
import { TaskBoardWindow, type TaskItem } from '../windows/task-window.tsx';

export class ReviewerAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 15;
    windows = ['stats', 'lastActivity'];

    prompt = `You are a task review specialist. You focus on quality, completeness, and team metrics.

IMPORTANT: The full board state is in your context inside <task-board>. Check <workspace> for shared stats.

Your specialties:
- Reviewing completed ("done") tasks for quality and completeness
- Adding review notes to task descriptions (append "✅ Review: ..." or "⚠️ Review: ...")
- Generating sprint summaries with key metrics
- Identifying blocked or stale tasks

When reviewing tasks:
1. Check if the description is clear and actionable
2. Verify acceptance criteria were defined
3. Add a review note via update_task
4. Track quality metrics

Keep feedback constructive and specific. Be concise.`;

    constructor() {
        super();
        this.window = new TaskBoardWindow();
    }

    private get board(): TaskBoardWindow {
        return this.window as TaskBoardWindow;
    }

    private _trackStats(detail: string) {
        if (!this.workspace) return;
        const stats = { ...(this.workspace.state.stats || {
            totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0,
        }) };
        stats.agentInteractions++;
        this.workspace.setState({ stats });

        const activity = [...(this.workspace.state.lastActivity || [])];
        activity.push(`[${new Date().toLocaleTimeString()}] 🔍 reviewer: ${detail}`);
        this.workspace.setState({ lastActivity: activity.slice(-20) });
    }

    @tool('Review a completed task and add quality feedback', {
        task_id: { type: 'string', description: 'The task ID to review' },
        verdict: { type: 'string', description: 'Review verdict: approved, needs-work, or blocked' },
        feedback: { type: 'string', description: 'Specific feedback or suggestions' },
    }, ['task_id', 'verdict'])
    async review_task({ task_id, verdict, feedback }: {
        task_id: string; verdict: string; feedback?: string;
    }) {
        const task = this.board.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };

        const icons: Record<string, string> = {
            'approved': '✅', 'needs-work': '⚠️', 'blocked': '🚫',
        };
        const icon = icons[verdict] || '📝';
        const reviewNote = `\n\n${icon} Review (${verdict}): ${feedback || 'No additional notes'}`;
        
        this.board.update(task_id, {
            description: task.description + reviewNote,
        });
        this.board.logActivity({
            source: 'agent',
            agentName: 'reviewer',
            action: `reviewed task (${verdict})`,
            taskId: task_id,
            taskTitle: task.title,
            detail: feedback?.slice(0, 50),
        });
        this._trackStats(`Reviewed "${task.title}" → ${verdict}`);

        return { success: true, result: `Reviewed "${task.title}" — ${verdict}. ${feedback || ''}` };
    }

    @tool('Move a task to a different status column', {
        task_id: { type: 'string', description: 'The task ID' },
        status: { type: 'string', description: 'New status: todo, doing, or done' },
    })
    async move_task({ task_id, status }: { task_id: string; status: string }) {
        const task = this.board.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };

        const oldStatus = task.status;
        this.board.update(task_id, { status: status as TaskItem['status'] });
        this.board.logActivity({
            source: 'agent',
            agentName: 'reviewer',
            action: `moved task ${oldStatus} → ${status}`,
            taskId: task_id,
            taskTitle: task.title,
        });

        if (status === 'done') {
            if (this.workspace) {
                const stats = { ...(this.workspace.state.stats || {
                    totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0,
                }) };
                stats.totalCompleted++;
                this.workspace.setState({ stats });
            }
        }
        this._trackStats(`Moved "${task.title}" ${oldStatus} → ${status}`);
        return { success: true, result: `Moved "${task.title}" from ${oldStatus} → ${status}` };
    }

    @tool('Update task details (description, priority, etc.)', {
        task_id: { type: 'string', description: 'The task ID' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        priority: { type: 'string', description: 'New priority: low, medium, or high (optional)' },
    }, ['task_id'])
    async update_task({ task_id, title, description, priority }: {
        task_id: string; title?: string; description?: string; priority?: string;
    }) {
        const task = this.board.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };

        const patch: Partial<TaskItem> = {};
        if (title) patch.title = title;
        if (description) patch.description = description;
        if (priority) patch.priority = priority as TaskItem['priority'];

        this.board.update(task_id, patch);
        this.board.logActivity({
            source: 'agent',
            agentName: 'reviewer',
            action: `updated task`,
            taskId: task_id,
            taskTitle: task.title,
            detail: Object.keys(patch).join(', '),
        });
        this._trackStats(`Updated "${task.title}": ${Object.keys(patch).join(', ')}`);
        return { success: true, result: `Updated "${task.title}": ${Object.keys(patch).join(', ')} changed` };
    }

    @tool('Generate a sprint summary with key metrics', {
        period: { type: 'string', description: 'Period to summarize (e.g. "today", "this sprint")' },
    })
    async summarize_sprint({ period }: { period?: string }) {
        const tasks = this.board.list();
        const done = tasks.filter(t => t.status === 'done');
        const doing = tasks.filter(t => t.status === 'doing');
        const todo = tasks.filter(t => t.status === 'todo');
        const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');

        let wsStats = { totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0 };
        if (this.workspace) {
            wsStats = this.workspace.state.stats || wsStats;
        }

        this._trackStats(`Generated sprint summary for "${period || 'current sprint'}"`);

        return {
            success: true,
            result: [
                `Sprint Summary (${period || 'current'})`,
                `━━━━━━━━━━━━━━━━━━━━━━━`,
                `📊 Board: ${tasks.length} total — ${todo.length} todo, ${doing.length} in progress, ${done.length} done`,
                `🔴 High priority pending: ${highPriority.length}`,
                `📈 Lifetime: ${wsStats.totalCreated} created, ${wsStats.totalCompleted} completed, ${wsStats.totalDeleted} deleted`,
                `🤖 Agent interactions: ${wsStats.agentInteractions}`,
                done.length > 0 ? `\n✅ Completed:\n${done.map(t => `  - ${t.title}`).join('\n')}` : '',
                highPriority.length > 0 ? `\n🔴 High priority:\n${highPriority.map(t => `  - [${t.status}] ${t.title}`).join('\n')}` : '',
            ].filter(Boolean).join('\n'),
        };
    }
}

export default ReviewerAgent;
