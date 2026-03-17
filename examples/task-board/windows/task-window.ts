/**
 * TaskBoardWindow — Reactive task board for the demo
 * 
 * Items: tasks with title, description, status, priority
 * State: filter + user activity log
 * 
 * The agent sees the full board + recent user actions via render().
 */

import { Window, type WindowItem } from '../../../src/core/window.ts';

// ── Types ──

export interface TaskItem extends WindowItem {
    id: string;
    title: string;
    description: string;
    status: 'todo' | 'doing' | 'done';
    priority: 'low' | 'medium' | 'high';
    createdAt: number;
}

export interface UserActivity {
    action: string;
    taskId?: string;
    taskTitle?: string;
    detail?: string;
    at: number;
}

export interface BoardState {
    filter: 'all' | 'todo' | 'doing' | 'done';
    userActivity: UserActivity[];
}

// ── Window ──

export class TaskBoardWindow extends Window<TaskItem, BoardState> {
    constructor() {
        super({ filter: 'all', userActivity: [] });
        this._seedTasks();
    }

    private _seedTasks() {
        const now = Date.now();
        const tasks: TaskItem[] = [
            { id: 'task-1', title: 'Design API schema', description: 'Define REST endpoints for the user service', status: 'todo', priority: 'high', createdAt: now - 3600000 },
            { id: 'task-2', title: 'Set up CI/CD pipeline', description: 'Configure GitHub Actions for automated testing and deployment', status: 'todo', priority: 'medium', createdAt: now - 7200000 },
            { id: 'task-3', title: 'Write unit tests', description: 'Add test coverage for auth module', status: 'doing', priority: 'high', createdAt: now - 1800000 },
            { id: 'task-4', title: 'Update README', description: 'Document the new API endpoints and setup instructions', status: 'doing', priority: 'low', createdAt: now - 900000 },
            { id: 'task-5', title: 'Fix login bug', description: 'Users unable to login with SSO on mobile', status: 'done', priority: 'high', createdAt: now - 86400000 },
        ];
        for (const t of tasks) this.add(t.id, t);
    }

    override render(): string {
        const tasks = this.list();
        if (tasks.length === 0) return '\n\n<task-board>\nThe board is empty. Create some tasks!\n</task-board>';

        const groups = { todo: [] as TaskItem[], doing: [] as TaskItem[], done: [] as TaskItem[] };
        for (const t of tasks) groups[t.status].push(t);

        const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' };

        let board = '\n\n<task-board>\n';
        board += `Total: ${tasks.length} tasks — ${groups.todo.length} todo, ${groups.doing.length} in progress, ${groups.done.length} done\n\n`;

        for (const [status, label] of [['todo', '📋 Todo'], ['doing', '🔄 In Progress'], ['done', '✅ Done']] as const) {
            const items = groups[status];
            board += `### ${label} (${items.length})\n`;
            if (items.length === 0) {
                board += '  (empty)\n';
            } else {
                for (const t of items) {
                    board += `  - [${t.id}] ${priorityEmoji[t.priority]} ${t.title}: ${t.description}\n`;
                }
            }
            board += '\n';
        }

        // Include recent user activity so agent knows what the user did
        const activity = this._state.userActivity || [];
        if (activity.length > 0) {
            board += '### 👤 Recent User Activity\n';
            const recent = activity.slice(-10); // Last 10 actions
            for (const a of recent) {
                const ago = Math.round((Date.now() - a.at) / 1000);
                board += `  - ${ago}s ago: ${a.action}`;
                if (a.taskTitle) board += ` "${a.taskTitle}"`;
                if (a.detail) board += ` (${a.detail})`;
                board += '\n';
            }
            board += '\n';
        }

        board += '</task-board>';
        return board;
    }
}

export default TaskBoardWindow;
