/** @jsx jsx */
/** @jsxFrag Fragment */
/**
 * TaskBoardWindow — Reactive task board with JSX rendering
 * 
 * Items: tasks with title, description, status, priority
 * State: filter + activity log (tracks both user and agent actions)
 * 
 * The agent sees the full board + all recent activity via render().
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

export interface Activity {
    source: 'user' | 'agent';
    agentName?: string;
    action: string;
    taskId?: string;
    taskTitle?: string;
    detail?: string;
    at: number;
}

export interface BoardState {
    filter: 'all' | 'todo' | 'doing' | 'done';
    activity: Activity[];
}

// ── Window ──

const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' } as const;
const sourceEmoji = { user: '👤', agent: '🤖' } as const;

export class TaskBoardWindow extends Window<TaskItem, BoardState> {
    constructor() {
        super({ filter: 'all', activity: [] });
        this._seedTasks();
    }

    /** Log an activity (from user or agent). */
    logActivity(entry: Omit<Activity, 'at'>): void {
        const activity = [...(this._state.activity || []), { ...entry, at: Date.now() }];
        // Keep last 50 entries
        this.setState({ activity: activity.slice(-50) });
    }

    private _seedTasks() {
        const now = Date.now();
        const tasks: TaskItem[] = [
            {
                id: 'task-1',
                title: 'Design API schema',
                description: 'Define REST endpoints for the user service including authentication, profile management, and permission roles. Must support pagination, filtering by role/status, and bulk operations. Consider GraphQL as an alternative for the dashboard queries. Acceptance criteria: OpenAPI spec reviewed by backend team, at least 12 endpoints documented.',
                status: 'todo',
                priority: 'high',
                createdAt: now - 3600000,
            },
            {
                id: 'task-2',
                title: 'Set up CI/CD pipeline',
                description: 'Configure GitHub Actions for automated testing (unit + integration), linting, and deployment to staging on PR merge. Production deploy should require manual approval. Include Slack notifications for failed builds and a badge in the README. Blocked by: DevOps team needs to provision the staging environment first.',
                status: 'todo',
                priority: 'medium',
                createdAt: now - 7200000,
            },
            {
                id: 'task-3',
                title: 'Write unit tests for auth module',
                description: 'Add comprehensive test coverage for the authentication module: login flow, token refresh, password reset, SSO callback, and rate limiting. Target: 90%+ coverage. Use vitest with mocked Anthropic provider. Edge cases to cover: expired tokens, concurrent refresh requests, malformed JWTs, and revoked sessions.',
                status: 'doing',
                priority: 'high',
                createdAt: now - 1800000,
            },
            {
                id: 'task-4',
                title: 'Update documentation',
                description: 'Document the new API endpoints, setup instructions, and migration guide from v2. Include code examples for each endpoint, error response formats, and rate limit headers. Add a "Getting Started" section for new developers with prerequisites, env setup, and a working curl example. Review with the DX team before merging.',
                status: 'doing',
                priority: 'low',
                createdAt: now - 900000,
            },
            {
                id: 'task-5',
                title: 'Fix SSO login on mobile',
                description: 'Users on iOS Safari and Chrome Android are unable to complete the SSO login flow — the OAuth callback redirect fails silently. Root cause: the callback URL uses a non-standard port that gets stripped by mobile browsers. Fix: use a proxy endpoint on port 443 and update the OAuth provider allowlist. Verified fix works on BrowserStack for top 5 mobile browsers.',
                status: 'done',
                priority: 'high',
                createdAt: now - 86400000,
            },
            {
                id: 'task-6',
                title: 'Implement role-based access control',
                description: 'Add RBAC middleware that checks user permissions before allowing access to protected routes. Roles: admin, editor, viewer. Permissions should be configurable per-resource (read, write, delete). Store role assignments in the database with an admin UI for managing them. Must integrate with the existing auth module and support hierarchical role inheritance.',
                status: 'todo',
                priority: 'high',
                createdAt: now - 5400000,
            },
            {
                id: 'task-7',
                title: 'Performance audit & optimization',
                description: 'Run Lighthouse audit on all main pages, identify bottlenecks in the API response times (target: p95 < 200ms), and optimize database queries that are causing N+1 problems. Consider adding Redis caching for frequently accessed user profiles. Create a performance dashboard with key metrics. Document findings and share with the team in Friday standup.',
                status: 'doing',
                priority: 'medium',
                createdAt: now - 2700000,
            },
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

        const activity = this._state.activity || [];
        const recentActivity = activity.slice(-15);

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
                        <line>### Recent Activity</line>
                        {recentActivity.map(a => {
                            const time = new Date(a.at).toLocaleTimeString();
                            const icon = sourceEmoji[a.source];
                            const who = a.source === 'agent' && a.agentName ? ` (${a.agentName})` : '';
                            return (
                                <line>  - [{time}] {icon}{who} {a.action}{a.taskTitle ? ` "${a.taskTitle}"` : ''}{a.detail ? ` (${a.detail})` : ''}</line>
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
