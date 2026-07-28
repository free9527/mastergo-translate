import type { BenchmarkArm, BenchmarkItemResult, RunMode } from './types';

export interface BenchmarkEvent {
  event: 'run_start' | 'item_result' | 'run_end';
  at: string;
  runId: string;
  arm?: BenchmarkArm;
  mode?: RunMode;
  item?: Omit<BenchmarkItemResult, 'error'> & { error?: string };
  summary?: { attempted: number; succeeded: number; failed: number };
}

/** Never emit source/translated text or environment values to telemetry. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return '[REDACTED]';
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).map((key) => [key, '[REDACTED]']));
  }
  return value;
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Error text may include provider responses, request bodies, or credentials.
  return message ? '[REDACTED_ERROR]' : 'Unknown benchmark error.';
}

export function writeJsonl(event: BenchmarkEvent, write: (line: string) => void = console.log): void {
  write(JSON.stringify(event));
}
