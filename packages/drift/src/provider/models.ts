/**
 * Drift — Model definitions
 * 
 * Direct port from PineCode's models.js
 * Supports: Opus 4.6, Sonnet 4.6, Haiku 4.5
 */

import type { ModelConfig, ThinkingConfig, Effort } from '../types.ts';

// Beta headers
// NOTE: context-1m is GA for Opus 4.6 and Sonnet 4.6 — no beta header needed
export const BETA_INTERLEAVED_THINKING = 'interleaved-thinking-2025-05-14';

// ── Model Definitions ──

export const MODELS: Record<string, ModelConfig> = {
    opus: {
        id: 'claude-opus-4-6',
        name: 'Opus 4.6',
        shortName: 'opus',
        maxOutputTokens: 128000,
        contextWindow: 1000000,
        thinkingMode: 'adaptive',
        thinkingPreserved: true,
        interleavedThinkingAuto: true,
        pricing: {
            input: 5.0,
            output: 25.0,
            cacheWrite: 6.25,
            cacheRead: 0.50,
        },
    },

    sonnet: {
        id: 'claude-sonnet-4-6',
        name: 'Sonnet 4.6',
        shortName: 'sonnet',
        maxOutputTokens: 64000,
        contextWindow: 1000000,
        thinkingMode: 'adaptive',
        thinkingPreserved: false,
        interleavedThinkingAuto: true,
        pricing: {
            input: 3.0,
            output: 15.0,
            cacheWrite: 3.75,
            cacheRead: 0.30,
        },
    },

    haiku: {
        id: 'claude-haiku-4-5-20251001',
        name: 'Haiku 4.5',
        shortName: 'haiku',
        maxOutputTokens: 64000,
        contextWindow: 200000,
        thinkingMode: 'enabled',
        thinkingPreserved: false,
        interleavedThinkingAuto: false,
        pricing: {
            input: 1.0,
            output: 5.0,
            cacheWrite: 1.25,
            cacheRead: 0.10,
        },
    },
};

export const DEFAULT_MODEL = 'sonnet';

/**
 * Get model config by short name (opus|sonnet|haiku)
 */
export function getModel(name: string): ModelConfig | null {
    const key = (name || DEFAULT_MODEL).toLowerCase();
    return MODELS[key] || null;
}

/**
 * Get model config by full model ID
 */
export function getModelById(id: string): ModelConfig | null {
    for (const model of Object.values(MODELS)) {
        if (model.id === id) return model;
    }
    return null;
}

/**
 * List all available model short names
 */
export function listModels(): string[] {
    return Object.keys(MODELS);
}

/**
 * Build thinking config for the given model.
 */
export function buildThinkingConfig(
    modelConfig: ModelConfig,
    options: { thinking?: boolean; maxTokens?: number; thinkingBudget?: number | null; effort?: Effort }
): ThinkingConfig {
    if (!options.thinking) return null;

    if (modelConfig.thinkingMode === 'adaptive') {
        return { type: 'adaptive' };
    }

    // Haiku: manual thinking with budget_tokens
    const maxTokens = options.maxTokens || modelConfig.maxOutputTokens;

    let budgetTokens: number;
    if (options.thinkingBudget) {
        budgetTokens = options.thinkingBudget;
    } else {
        const effort = options.effort || 'low';
        const effortBudgets: Record<string, number> = {
            low: 10000,
            medium: 32000,
            high: 50000,
            max: Math.floor(maxTokens * 0.8),
        };
        budgetTokens = effortBudgets[effort] || 10000;
    }

    budgetTokens = Math.min(budgetTokens, maxTokens - 1);

    return {
        type: 'enabled',
        budget_tokens: budgetTokens,
    };
}

/**
 * Get the required beta headers for a model given current config
 */
export function getBetaHeaders(
    modelConfig: ModelConfig,
    options: { thinking?: boolean }
): string[] {
    const headers: string[] = [];

    // Haiku needs interleaved thinking beta header (Opus/Sonnet have it auto)
    if (options.thinking && !modelConfig.interleavedThinkingAuto) {
        headers.push(BETA_INTERLEAVED_THINKING);
    }

    return headers;
}
