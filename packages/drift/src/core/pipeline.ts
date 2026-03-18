/**
 * Drift — Pipeline
 * 
 * Sequential agent chains — output of step N becomes input of step N+1.
 * Auto-discovered from `pipelinesDir` (like agents from `agentsDir`).
 * 
 * Built on top of Dispatch — each step calls dispatch() internally.
 * 
 * Two step styles:
 * 
 * 1. Simple (string array):
 * 
 *   class ReviewPipeline extends Pipeline {
 *       steps = ['planner', 'task-agent', 'reviewer'];
 *   }
 * 
 * 2. Full control (PipelineStep objects):
 * 
 *   class TradingPipeline extends Pipeline {
 *       steps = [
 *           { agent: 'scanner',  message: (ctx) => `Scan: ${ctx.input}` },
 *           { agent: 'analyzer', message: (ctx) => `Analyze:\n${ctx.prev.text}` },
 *           { agent: 'executor', message: (ctx) => `Execute:\n${ctx.prev.text}`,
 *                                condition: (ctx) => !ctx.prev.text.includes('REJECT') },
 *       ];
 *   }
 */

import { EventEmitter } from 'node:events';
import type { Window } from './window.ts';
import type { Workspace } from './workspace.ts';
import type { DispatchFn, DispatchResult, DispatchOptions } from './trigger.ts';

// ── Pipeline Types ──────────────────────────────────

export interface PipelineStep {
    /** Agent to dispatch. */
    agent: string;
    /** Custom message builder. Default: uses `ctx.prev.text` (or `ctx.input` for first step). */
    message?: (ctx: PipelineContext) => string;
    /** Condition to run this step. Return false to skip. Default: always run. */
    condition?: (ctx: PipelineContext) => boolean;
    /** Timeout for this specific step in ms. */
    timeout?: number;
}

export interface PipelineContext {
    /** Original input to the pipeline. */
    input: string;
    /** Previous step's result. Empty DispatchResult for the first step. */
    prev: DispatchResult;
    /** All results from completed steps (in order). */
    results: DispatchResult[];
    /** Current step index (0-based). */
    step: number;
    /** Current agent name. */
    stepName: string;
    /** Whether the pipeline has been aborted. */
    aborted: boolean;
}

export interface PipelineStepResult {
    /** Agent name for this step. */
    agent: string;
    /** Dispatch result (null if skipped). */
    result: DispatchResult | null;
    /** Whether this step was skipped. */
    skipped: boolean;
    /** Step duration in ms. */
    ms: number;
    /** Error message if step failed. */
    error?: string;
}

export interface PipelineResult {
    /** Whether the pipeline completed successfully. */
    ok: boolean;
    /** Results for each step. */
    steps: PipelineStepResult[];
    /** Total cost across all steps. */
    totalCost: number;
    /** Total duration in ms. */
    duration: number;
    /** Whether the pipeline was aborted. */
    aborted: boolean;
    /** Last successful step's text output. */
    finalText: string;
    /** Error message if pipeline failed. */
    error?: string;
}

// Empty result for the "previous step" when step 0 runs
const EMPTY_RESULT: DispatchResult = {
    text: '',
    cost: 0,
    toolCalls: [],
    sessionId: '',
    aborted: false,
};

// ── Pipeline Class ──────────────────────────────────

export class Pipeline {
    /** Unique name. Defaults to kebab-case of class name (set by loadPipelines). */
    name?: string;

    /**
     * Steps to execute sequentially.
     * - `string` — agent name (message = prev step's text)
     * - `PipelineStep` — full control over message, condition, timeout
     */
    steps: (string | PipelineStep)[] = [];

    // ── Injected by server ──

    /** Shared workspace reference (injected by DriftServer). */
    workspace?: Workspace<any>;

    /** Shared window reference (injected by DriftServer). */
    window?: Window<any>;

    /** @internal — Dispatch function injected by server. */
    _dispatchFn?: DispatchFn;

    /** @internal — Event emitter for step progress (injected by PipelineManager). */
    _emitter?: EventEmitter;

    // ── Hooks (override in subclass) ──

    /**
     * Called before each step executes.
     * Return a string to override the message sent to the agent.
     * Return void to use the default message.
     */
    beforeStep(step: number, ctx: PipelineContext): string | void {}

    /**
     * Called after each step completes successfully.
     * Use for logging, workspace updates, etc.
     */
    afterStep(step: number, ctx: PipelineContext): void {}

    /**
     * Called when a step fails.
     * Return 'abort' to stop the pipeline (default).
     * Return 'skip' to skip this step and continue.
     * Return 'retry' to retry this step once.
     */
    onError(step: number, error: Error, ctx: PipelineContext): 'abort' | 'skip' | 'retry' {
        return 'abort';
    }

    // ── API available to subclasses ──

    /** Dispatch an agent manually from a hook. */
    protected dispatch(agent: string, message: string, options?: Partial<DispatchOptions>): Promise<DispatchResult> {
        if (!this._dispatchFn) throw new Error(`Pipeline "${this.name}": dispatch not wired`);
        const name = this.name || this.constructor.name;
        return this._dispatchFn(agent, message, { source: `pipeline:${name}`, ...options });
    }

    /** Read a workspace slice. */
    protected select<T = any>(key: string): T | undefined {
        return this.workspace?.select(key) as T | undefined;
    }

    // ── Internal execution ──

    /**
     * @internal — Run the pipeline. Called by PipelineManager.
     */
    async _run(input: string, options?: { silent?: boolean; source?: string }): Promise<PipelineResult> {
        if (!this._dispatchFn) throw new Error(`Pipeline "${this.name}": dispatch not wired`);

        const start = Date.now();
        const stepResults: PipelineStepResult[] = [];
        const results: DispatchResult[] = [];
        let prev: DispatchResult = EMPTY_RESULT;
        let aborted = false;
        let error: string | undefined;
        const pipelineName = this.name || this.constructor.name;
        const source = options?.source || `pipeline:${pipelineName}`;
        const silent = options?.silent ?? false;

        // Normalize steps
        const normalizedSteps: PipelineStep[] = this.steps.map(s =>
            typeof s === 'string' ? { agent: s } : s
        );

        // Emit start
        this._emitter?.emit('started', {
            pipeline: pipelineName,
            input,
            steps: normalizedSteps.map(s => s.agent),
        });

        for (let i = 0; i < normalizedSteps.length; i++) {
            if (aborted) break;

            const step = normalizedSteps[i];
            const stepStart = Date.now();

            const ctx: PipelineContext = {
                input,
                prev,
                results: [...results],
                step: i,
                stepName: step.agent,
                aborted: false,
            };

            // Check condition
            if (step.condition && !step.condition(ctx)) {
                stepResults.push({ agent: step.agent, result: null, skipped: true, ms: 0 });
                this._emitter?.emit('step', {
                    pipeline: pipelineName,
                    step: i,
                    agent: step.agent,
                    status: 'skipped',
                });
                continue;
            }

            // Build message
            let message: string;
            if (step.message) {
                message = step.message(ctx);
            } else {
                // Default: first step gets input, subsequent steps get prev.text
                message = i === 0 ? input : prev.text;
            }

            // beforeStep hook — can override message
            const override = this.beforeStep(i, ctx);
            if (typeof override === 'string') message = override;

            // Emit step running
            this._emitter?.emit('step', {
                pipeline: pipelineName,
                step: i,
                agent: step.agent,
                status: 'running',
            });

            // Execute step via dispatch
            let result: DispatchResult | null = null;
            let retried = false;

            const executeStep = async (): Promise<DispatchResult> => {
                return this._dispatchFn!(step.agent, message, {
                    source,
                    silent,
                    timeout: step.timeout,
                });
            };

            try {
                result = await executeStep();
            } catch (err: any) {
                const action = this.onError(i, err, ctx);

                if (action === 'retry' && !retried) {
                    retried = true;
                    try {
                        result = await executeStep();
                    } catch (retryErr: any) {
                        // Retry also failed
                        if (this.onError(i, retryErr, ctx) === 'skip') {
                            stepResults.push({ agent: step.agent, result: null, skipped: true, ms: Date.now() - stepStart, error: retryErr.message });
                            this._emitter?.emit('step', { pipeline: pipelineName, step: i, agent: step.agent, status: 'error', error: retryErr.message });
                            continue;
                        }
                        aborted = true;
                        error = retryErr.message;
                        stepResults.push({ agent: step.agent, result: null, skipped: false, ms: Date.now() - stepStart, error: retryErr.message });
                        this._emitter?.emit('step', { pipeline: pipelineName, step: i, agent: step.agent, status: 'error', error: retryErr.message });
                        break;
                    }
                } else if (action === 'skip') {
                    stepResults.push({ agent: step.agent, result: null, skipped: true, ms: Date.now() - stepStart, error: err.message });
                    this._emitter?.emit('step', { pipeline: pipelineName, step: i, agent: step.agent, status: 'skipped', error: err.message });
                    continue;
                } else {
                    aborted = true;
                    error = err.message;
                    stepResults.push({ agent: step.agent, result: null, skipped: false, ms: Date.now() - stepStart, error: err.message });
                    this._emitter?.emit('step', { pipeline: pipelineName, step: i, agent: step.agent, status: 'error', error: err.message });
                    break;
                }
            }

            if (result) {
                // Check if dispatched agent was aborted
                if (result.aborted) {
                    aborted = true;
                    error = `Agent "${step.agent}" was aborted`;
                    stepResults.push({ agent: step.agent, result, skipped: false, ms: Date.now() - stepStart });
                    this._emitter?.emit('step', { pipeline: pipelineName, step: i, agent: step.agent, status: 'error', error });
                    break;
                }

                prev = result;
                results.push(result);
                stepResults.push({ agent: step.agent, result, skipped: false, ms: Date.now() - stepStart });

                // afterStep hook
                ctx.prev = result;
                ctx.results = [...results];
                this.afterStep(i, ctx);

                // Emit step done
                this._emitter?.emit('step', {
                    pipeline: pipelineName,
                    step: i,
                    agent: step.agent,
                    status: 'done',
                    result: { text: result.text?.slice(0, 200), cost: result.cost },
                });
            }
        }

        const pipelineResult: PipelineResult = {
            ok: !aborted && !error,
            steps: stepResults,
            totalCost: results.reduce((sum, r) => sum + r.cost, 0),
            duration: Date.now() - start,
            aborted,
            finalText: prev.text || '',
            error,
        };

        // Emit done
        this._emitter?.emit(aborted ? 'error' : 'done', {
            pipeline: pipelineName,
            result: pipelineResult,
        });

        return pipelineResult;
    }
}

// ── Pipeline Manager ────────────────────────────────

/**
 * Manages pipelines and executes them.
 * Lives on the DriftServer, exposed via WS protocol.
 */
export class PipelineManager extends EventEmitter {
    private _pipelines: Pipeline[] = [];

    /** Add a pipeline to the manager. */
    add(pipeline: Pipeline): void {
        const name = pipeline.name || pipeline.constructor.name;
        this._pipelines = this._pipelines.filter(p =>
            (p.name || p.constructor.name) !== name
        );
        pipeline._emitter = this;
        this._pipelines.push(pipeline);
    }

    /** Remove a pipeline by name. */
    remove(name: string): void {
        this._pipelines = this._pipelines.filter(p =>
            (p.name || p.constructor.name) !== name
        );
    }

    /** Get a pipeline by name. */
    get(name: string): Pipeline | undefined {
        return this._pipelines.find(p =>
            (p.name || p.constructor.name) === name
        );
    }

    /** List all pipelines. */
    list(): Pipeline[] {
        return [...this._pipelines];
    }

    /**
     * Run a pipeline by name.
     * @returns PipelineResult with all step results.
     */
    async run(name: string, input: string, options?: { silent?: boolean; source?: string }): Promise<PipelineResult> {
        const pipeline = this.get(name);
        if (!pipeline) throw new Error(`Unknown pipeline: "${name}". Available: ${this._pipelines.map(p => p.name).join(', ')}`);
        return pipeline._run(input, options);
    }
}
