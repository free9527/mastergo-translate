import { readFileSync } from 'node:fs';

interface ItemEvent {
  event: 'item_result';
  item: { arm: string; durationMs: number; success: boolean; quality?: { passed: boolean } };
}

function percentile(sorted: readonly number[], percentileValue: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

export function analyzeJsonl(text: string): Record<string, Record<string, number>> {
  const samples = new Map<string, ItemEvent['item'][]>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as Partial<ItemEvent>;
    if (event.event !== 'item_result' || !event.item) continue;
    const values = samples.get(event.item.arm) ?? [];
    values.push(event.item);
    samples.set(event.item.arm, values);
  }
  return Object.fromEntries(Array.from(samples, ([arm, values]) => {
    const durations = values.map((value) => value.durationMs).sort((a, b) => a - b);
    const succeeded = values.filter((value) => value.success).length;
    const qualityPassed = values.filter((value) => value.quality?.passed).length;
    return [arm, {
      count: values.length,
      succeeded,
      qualityPassed,
      p50Ms: percentile(durations, 0.5) ?? 0,
      p95Ms: percentile(durations, 0.95) ?? 0,
      p99Ms: percentile(durations, 0.99) ?? 0,
    }];
  }));
}

function main(): void {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: tsx benchmarks/analyze-results.ts <results.jsonl>');
  console.log(JSON.stringify(analyzeJsonl(readFileSync(filename, 'utf8')), null, 2));
}

if (process.argv[1]?.endsWith('analyze-results.ts')) main();
