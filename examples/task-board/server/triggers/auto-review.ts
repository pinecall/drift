/**
 * Auto-Review Trigger
 * 
 * When a task is moved to "done", automatically dispatch the reviewer agent
 * to review the completed task for quality.
 * 
 * StateMachine style — uses `field` + `on` for clean declarative syntax.
 */

import { Trigger } from '@drift/core';

export class AutoReviewTrigger extends Trigger {
    watch = 'window' as const;
    cooldown = 15_000;  // 15s cooldown between reviews
    field = 'status';   // Track transitions on the 'status' field

    on = {
        'done': async (event: any) => {
            await this.dispatch('reviewer',
                `Task "${event.item?.title || event.id}" [${event.id}] was just moved to Done. Please review it for quality and add review notes.`
            );
        },
    };
}

export default AutoReviewTrigger;
