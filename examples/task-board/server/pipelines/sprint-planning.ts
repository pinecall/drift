/**
 * Sprint Planning Pipeline
 * 
 * Sequential chain: planner → task-agent → reviewer.
 * Each step receives the previous step's output as context.
 */

import { Pipeline } from 'drift';

export class SprintPlanningPipeline extends Pipeline {
    steps = [
        {
            agent: 'planner',
            message: (ctx: any) => `Break down this goal into actionable tasks:\n${ctx.input}`,
        },
        {
            agent: 'task-agent',
            message: (ctx: any) => `Create these tasks on the board:\n${ctx.prev.text}`,
        },
        {
            agent: 'reviewer',
            message: (ctx: any) => `Review these tasks for quality and completeness:\n${ctx.prev.text}`,
        },
    ];

    afterStep(step: number, ctx: any): void {
        this.workspace?.setSlice('lastActivity',
            `Pipeline step ${step + 1}/3: ${ctx.stepName} done`
        );
    }
}

export default SprintPlanningPipeline;
