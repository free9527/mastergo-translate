import { checkQuality } from './quality';
import { redactError } from './telemetry';
import type {
  BenchmarkItem,
  BenchmarkItemResult,
  BenchmarkRunOptions,
  BenchmarkRunner,
  LiveGuardOptions,
} from './types';

export function assertLiveAllowed(options: LiveGuardOptions): void {
  if (!options.args.includes('--allow-live')) {
    throw new Error('Live execution requires the explicit --allow-live flag.');
  }
  const environment = options.env ?? process.env;
  const missing = (options.requiredEnv ?? []).filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Live execution requires environment variables: ${missing.join(', ')}.`);
  }
}

export function dryRunRunner(arm: BenchmarkRunner['arm']): BenchmarkRunner {
  return {
    arm,
    async run({ item }) {
      // Deliberately avoids any provider, network, or production-pipeline import.
      return { output: item.reference ?? item.source };
    },
  };
}

/** Executes an injected adapter only; this foundation imports no production pipeline. */
export async function runBenchmark(
  runner: BenchmarkRunner,
  items: readonly BenchmarkItem[],
  options: BenchmarkRunOptions,
): Promise<BenchmarkItemResult[]> {
  const results: BenchmarkItemResult[] = [];

  for (const item of items) {
    const startedAt = performance.now();
    try {
      const response = await runner.run({ arm: runner.arm, item, runId: options.runId });
      const result: BenchmarkItemResult = {
        arm: runner.arm,
        itemId: item.id,
        durationMs: performance.now() - startedAt,
        success: true,
        metrics: response.metrics,
        quality: checkQuality({
          source: item.source,
          output: response.output,
          targetLanguage: item.targetLanguage,
          isUntranslated: options.isUntranslated,
        }),
      };
      results.push(result);
      await options.onItem?.(result);
    } catch (error) {
      const result: BenchmarkItemResult = {
        arm: runner.arm,
        itemId: item.id,
        durationMs: performance.now() - startedAt,
        success: false,
        error: redactError(error),
      };
      results.push(result);
      await options.onItem?.(result);
    }
  }
  return results;
}
