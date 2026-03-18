/**
 * PlannerAgent — Project planning and task decomposition
 * 
 * Specializes in:
 *   - Breaking down goals into structured tasks with priorities
 *   - Suggesting priority changes based on board analysis
 *   - Creating multiple tasks at once for project kickoffs
 * 
 * Shares the same TaskBoardWindow and Workspace as other agents.
 */

import { Agent, tool } from '../../../../packages/drift/src/index.ts';
import { TaskBoardWindow, type TaskItem } from '../windows/task-window.tsx';

export class PlannerAgent extends Agent {
    model = 'haiku';
    canDispatch = true;
    thinking = false;
    effort = 'low' as const;
    maxIterations = 15;
    workspaceSlices = ['stats', 'lastActivity'];

    prompt = `You are a project planning specialist. You help break down goals into actionable tasks.

IMPORTANT: The full board state is in your context inside <task-board>. You can see all existing tasks.
Also check <workspace> for shared stats and recent activity from other agents.

Your specialties:
- Breaking down complex goals into 3-8 focused tasks with clear priorities
- Analyzing the todo column and suggesting priority adjustments
- Creating well-structured task descriptions with acceptance criteria
- Identifying dependencies between tasks

When planning a project:
1. Analyze the current board state first
2. Create tasks in a logical order (dependencies first)
3. Assign realistic priorities (only 1-2 high, rest medium/low)
4. Write actionable descriptions (what, why, acceptance criteria)

Keep responses structured and professional. Use bullet points.`;

    constructor() {
        super();
        this.window = new TaskBoardWindow();
    }

    private get board(): TaskBoardWindow {
        return this.window as TaskBoardWindow;
    }

    private _trackStats(detail: string) {
        if (!this.workspace) return;
        const stats = this.workspace.select('stats') || {
            totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0,
        };
        stats.agentInteractions++;
        this.workspace.setSlice('stats', stats);

        const activity = this.workspace.select('lastActivity') || [];
        activity.push(`[${new Date().toLocaleTimeString()}] 📋 planner: ${detail}`);
        this.workspace.setSlice('lastActivity', activity.slice(-20));
    }

    @tool('Break down a project goal into multiple tasks', {
        goal: { type: 'string', description: 'The project goal or feature to plan' },
        num_tasks: { type: 'number', description: 'Approximate number of tasks to create (3-8, default: 5)' },
    }, ['goal'])
    async plan_project({ goal, num_tasks }: { goal: string; num_tasks?: number }) {
        // The agent will use its LLM reasoning to decompose the goal,
        // then call create_task for each one. This tool just acknowledges the planning request.
        const count = num_tasks || 5;
        this._trackStats(`Planning project: "${goal}" (~${count} tasks)`);
        
        // Create the tasks directly
        const tasks: string[] = [];
        // We'll let the LLM handle the actual planning by returning instructions
        return {
            success: true,
            result: `Planning mode activated for: "${goal}". I'll create ~${count} tasks. Use create_task for each one with clear titles, descriptions, and priorities.`,
        };
    }

    @tool('Create a new task on the board', {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description with acceptance criteria' },
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
        this.board.add(id, task);
        this.board.logActivity({
            source: 'agent',
            agentName: 'planner',
            action: 'planned task',
            taskId: id,
            taskTitle: title,
            detail: `priority: ${task.priority}`,
        });

        // Update workspace stats
        if (this.workspace) {
            const stats = this.workspace.select('stats') || {
                totalCreated: 0, totalCompleted: 0, totalDeleted: 0, agentInteractions: 0,
            };
            stats.totalCreated++;
            stats.agentInteractions++;
            this.workspace.setSlice('stats', stats);
        }

        this._trackStats(`Created "${title}"`);
        return { success: true, result: `Created task "${title}" [${id}] — priority: ${task.priority}` };
    }

    @tool('Suggest priority changes for existing tasks based on analysis', {
        analysis: { type: 'string', description: 'Brief analysis of the current board' },
    })
    async suggest_priorities({ analysis }: { analysis: string }) {
        const tasks = this.board.list();
        const todoTasks = tasks.filter(t => t.status === 'todo');
        const highCount = todoTasks.filter(t => t.priority === 'high').length;

        this._trackStats(`Analyzed priorities: ${todoTasks.length} todo, ${highCount} high`);
        
        return {
            success: true,
            result: `Board analysis: ${tasks.length} total tasks, ${todoTasks.length} in todo, ${highCount} high priority. ${analysis}`,
        };
    }
}

export default PlannerAgent;
