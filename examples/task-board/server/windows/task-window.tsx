/** @jsx jsx */
/** @jsxFrag Fragment */
/**
 * TaskBoardWindow — Reactive task board with JSX rendering
 * 
 * Items: tasks with title, description, status, priority
 * State: filter + user activity log
 * 
 * The agent sees the full board + recent user actions via render().
 */

import { Window, type WindowItem } from '../../../../packages/drift/src/core/window.ts';
import { jsx, Fragment, render } from '../../../../packages/drift/src/jsx-runtime.ts';

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

const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' } as const;

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
        if (tasks.length === 0) {
            return render(<window name="task-board"><text>The board is empty. Create some tasks!</text></window>);
        }

        const groups = { todo: [] as TaskItem[], doing: [] as TaskItem[], done: [] as TaskItem[] };
        for (const t of tasks) groups[t.status].push(t);

        const activity = this._state.userActivity || [];
        const recentActivity = activity.slice(-10);

        return render(
            <window name="task-board">
                <line>Total: {tasks.length} tasks — {groups.todo.length} todo, {groups.doing.length} in progress, {groups.done.length} done</line>
                <br />

                {(['todo', 'doing', 'done'] as const).map(status => {
                    const labels = { todo: '📋 Todo', doing: '🔄 In Progress', done: '✅ Done' };
                    const items = groups[status];
                    return (
                        <>
                            <line>### {labels[status]} ({items.length})</line>
                            {items.length === 0
                                ? <line>  (empty)</line>
                                : items.map(t => (
                                    <line>  - [{t.id}] {priorityEmoji[t.priority]} {t.title}: {t.description}</line>
                                ))
                            }
                            <br />
                        </>
                    );
                })}

                {recentActivity.length > 0 && (
                    <>
                        <line>### 👤 Recent User Activity</line>
                        {recentActivity.map(a => {
                            const ago = Math.round((Date.now() - a.at) / 1000);
                            return (
                                <line>  - {ago}s ago: {a.action}{a.taskTitle ? ` "${a.taskTitle}"` : ''}{a.detail ? ` (${a.detail})` : ''}</line>
                            );
                        })}
                        <br />
                    </>
                )}
            </window>
        );
    }
}

export default TaskBoardWindow;
