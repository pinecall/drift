/**
 * TaskAgent — Task management agent with tools that modify the board window
 * 
 * Demonstrates:
 *   - @tool decorators that modify window items → UI reacts in real-time
 *   - Agent reads window state (including user activity) via render()
 *   - Bidirectional: agent changes board, user changes board, agent sees both
 */

import { Agent, tool } from '../../../packages/drift/src/index.ts';
import { TaskBoardWindow, type TaskItem } from '../windows/task-window.tsx';

export class TaskAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 15;

    prompt = `You are a task management assistant. You help users manage their task board.

IMPORTANT: The full board state is ALREADY in your context inside <task-board>. You can see all tasks, their statuses, priorities, and recent user activity. You do NOT need to call any tool to see the board — just read your context.

Pay attention to:
- Current tasks by status (todo, doing, done)
- Recent user activity — the user may have moved or deleted tasks from the UI

Available capabilities:
- Create new tasks with priorities (high/medium/low)
- Move tasks between statuses (todo → doing → done)
- Update task details (title, description, priority)
- Delete tasks
- Create multiple tasks at once for project planning

Be proactive: if you see the user moved tasks, acknowledge it.
If asked to plan a project, create multiple tasks with appropriate priorities.
Keep responses concise and action-oriented.`;

    constructor() {
        super();
        this.window = new TaskBoardWindow();
    }

    @tool('Create a new task on the board', {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Priority: low, medium, or high' },
        status: { type: 'string', description: 'Initial status: todo, doing, or done (default: todo)' },
    }, ['title'])
    async create_task({ title, description, priority, status }: {
        title: string; description?: string; priority?: string; status?: string;
    }) {
        const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const task: TaskItem = {
            id,
            title,
            description: description || '',
            status: (status as TaskItem['status']) || 'todo',
            priority: (priority as TaskItem['priority']) || 'medium',
            createdAt: Date.now(),
        };
        this.window!.add(id, task);
        return { success: true, result: `Created task "${title}" [${id}] with priority ${task.priority}` };
    }

    @tool('Move a task to a different status column', {
        task_id: { type: 'string', description: 'The task ID (e.g. task-1)' },
        status: { type: 'string', description: 'New status: todo, doing, or done' },
    })
    async move_task({ task_id, status }: { task_id: string; status: string }) {
        const task = this.window!.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };
        
        const oldStatus = task.status;
        this.window!.update(task_id, { status: status as TaskItem['status'] });
        return { success: true, result: `Moved "${task.title}" from ${oldStatus} → ${status}` };
    }

    @tool('Update task details', {
        task_id: { type: 'string', description: 'The task ID' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        priority: { type: 'string', description: 'New priority: low, medium, or high (optional)' },
    }, ['task_id'])
    async update_task({ task_id, title, description, priority }: {
        task_id: string; title?: string; description?: string; priority?: string;
    }) {
        const task = this.window!.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };

        const patch: Partial<TaskItem> = {};
        if (title) patch.title = title;
        if (description) patch.description = description;
        if (priority) patch.priority = priority as TaskItem['priority'];

        this.window!.update(task_id, patch);
        return { success: true, result: `Updated "${task.title}": ${Object.keys(patch).join(', ')} changed` };
    }

    @tool('Delete a task from the board', {
        task_id: { type: 'string', description: 'The task ID to delete' },
    })
    async delete_task({ task_id }: { task_id: string }) {
        const task = this.window!.get(task_id);
        if (!task) return { success: false, result: `Task ${task_id} not found` };

        const title = task.title;
        this.window!.remove(task_id);
        return { success: true, result: `Deleted task "${title}" [${task_id}]` };
    }


}

export default TaskAgent;
