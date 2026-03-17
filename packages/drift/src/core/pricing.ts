/**
 * Drift — Pricing (per-session cost tracking)
 * 
 * Port of PineCode's pricing.js
 */

import type { ModelConfig, ApiUsage, PricingTurn } from '../types.ts';

export class Pricing {
    private modelConfig: ModelConfig;
    turns: PricingTurn[] = [];
    totals = {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
    };

    constructor(modelConfig: ModelConfig) {
        this.modelConfig = modelConfig;
    }

    /**
     * Record an API turn's usage.
     */
    record(usage: ApiUsage): PricingTurn {
        const pricing = this._selectPricing();

        const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
        const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
        const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cacheWrite;
        const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1_000_000) * pricing.cacheRead;

        const cost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

        // Calculate cache savings
        const cacheSavings =
            ((usage.cache_read_input_tokens || 0) / 1_000_000) * (pricing.input - pricing.cacheRead);

        const turn: PricingTurn = {
            cost,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheWriteTokens: usage.cache_creation_input_tokens || 0,
            cacheReadTokens: usage.cache_read_input_tokens || 0,
            cacheSavings,
        };

        this.turns.push(turn);
        this.totals.inputTokens += turn.inputTokens;
        this.totals.outputTokens += turn.outputTokens;
        this.totals.cacheWriteTokens += turn.cacheWriteTokens;
        this.totals.cacheReadTokens += turn.cacheReadTokens;
        this.totals.cost += cost;

        return turn;
    }

    /**
     * Standard pricing (1M context is GA — no surcharge).
     */
    private _selectPricing() {
        return this.modelConfig.pricing;
    }

    /**
     * Total cost in USD.
     */
    totalCost(): number {
        return this.totals.cost;
    }

    /**
     * Formatted cost string.
     */
    formatCost(): string {
        const cost = this.totalCost();
        if (cost < 0.01) return `$${cost.toFixed(4)}`;
        return `$${cost.toFixed(2)}`;
    }

    /**
     * Update model (for pricing recalculation on model switch).
     */
    setModel(modelConfig: ModelConfig): void {
        this.modelConfig = modelConfig;
    }

    /**
     * Reset all tracking.
     */
    reset(): void {
        this.turns = [];
        this.totals = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cost: 0 };
    }
}
