import { writeJsonl } from './telemetry';
import { assertLiveAllowed, dryRunRunner, runBenchmark } from './runner';
import type { BenchmarkArm, BenchmarkItem, BenchmarkRunner, RunMode } from './types';

const ARM_SET = new Set<BenchmarkArm>([
  'translation_only',
  'translation_plus_proofread',
  'proofread_only_reference',
  'production_pipeline',
]);

function armFromArgs(args: readonly string[]): BenchmarkArm {
  const supplied = args.find((arg) => arg.startsWith('--arm='))?.slice('--arm='.length) ?? 'production_pipeline';
  if (!ARM_SET.has(supplied as BenchmarkArm)) throw new Error(`Unknown arm: ${supplied}`);
  return supplied as BenchmarkArm;
}

async function loadLiveRunner(arm: BenchmarkArm): Promise<BenchmarkRunner> {
  const modulePath = process.env.BENCHMARK_LIVE_RUNNER_MODULE;
  assertLiveAllowed({
    args: process.argv.slice(2),
    requiredEnv: ['BENCHMARK_LIVE_RUNNER_MODULE', 'BENCHMARK_LIVE_AUTH'],
  });
  // Adapter selection is deliberately external to keep this subsystem provider-neutral.
  const loaded = await import(modulePath!);
  const createRunner = loaded.createBenchmarkRunner as undefined | ((requestedArm: BenchmarkArm) => BenchmarkRunner | Promise<BenchmarkRunner>);
  if (!createRunner) throw new Error('Live adapter must export createBenchmarkRunner(arm).');
  const runner = await createRunner(arm);
  if (runner.arm !== arm) throw new Error('Live adapter returned a runner for a different arm.');
  return runner;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arm = armFromArgs(args);
  const mode: RunMode = args.includes('--allow-live') ? 'live' : 'dry-run';
  const runId = `benchmark-${Date.now()}`;
  const items: BenchmarkItem[] = [{
    id: 'sample-001',
    source: 'Lexar® __GLOSSARY_1__ stores 128 GB.\nReady.',
    reference: 'Lexar® __GLOSSARY_1__ stores 128 GB.\nReady.',
    targetLanguage: 'en',
  }];
  const runner = mode === 'live' ? await loadLiveRunner(arm) : dryRunRunner(arm);
  writeJsonl({ event: 'run_start', at: new Date().toISOString(), runId, arm, mode });
  const results = await runBenchmark(runner, items, {
    runId,
    mode,
    onItem: (item) => writeJsonl({ event: 'item_result', at: new Date().toISOString(), runId, arm, mode, item }),
  });
  writeJsonl({
    event: 'run_end', at: new Date().toISOString(), runId, arm, mode,
    summary: { attempted: results.length, succeeded: results.filter((result) => result.success).length, failed: results.filter((result) => !result.success).length },
  });
}

void main().catch((error) => {
  // Do not expose adapter/provided content or potentially secret-bearing errors.
  console.error(JSON.stringify({ event: 'fatal', error: '[REDACTED_ERROR]' }));
  process.exitCode = 1;
});
