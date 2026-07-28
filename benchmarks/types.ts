/** Local, production-independent contracts for translation benchmark runs. */

export const BENCHMARK_ARMS = [
  'translation_only',
  'translation_plus_proofread',
  'proofread_only_reference',
  'production_pipeline',
] as const;

export type BenchmarkArm = (typeof BENCHMARK_ARMS)[number];
export type RunMode = 'dry-run' | 'live';

export interface BenchmarkItem {
  /** Stable public identifier. Do not put source content in this field. */
  id: string;
  source: string;
  targetLanguage: string;
  /** Optional known-good translation, used by reference-only arms. */
  reference?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RunnerRequest {
  arm: BenchmarkArm;
  item: BenchmarkItem;
  runId: string;
}

export interface RunnerResponse {
  output: string;
  /** Optional model/provider metrics supplied by an injected adapter. */
  metrics?: Readonly<Record<string, number>>;
}

export interface BenchmarkRunner {
  readonly arm: BenchmarkArm;
  run(request: RunnerRequest): Promise<RunnerResponse>;
}

export interface UntranslatedCheck {
  (source: string, output: string, targetLanguage: string): boolean | string | undefined;
}

export interface QualityCheckInput {
  source: string;
  output: string;
  targetLanguage: string;
  isUntranslated?: UntranslatedCheck;
}

export type QualityIssueCode =
  | 'numbers'
  | 'placeholders'
  | 'trademarks'
  | 'newlines'
  | 'untranslated';

export interface QualityIssue {
  code: QualityIssueCode;
  message: string;
}

export interface QualityResult {
  passed: boolean;
  issues: readonly QualityIssue[];
}

export interface BenchmarkItemResult {
  arm: BenchmarkArm;
  itemId: string;
  durationMs: number;
  success: boolean;
  quality?: QualityResult;
  metrics?: Readonly<Record<string, number>>;
  error?: string;
}

export interface BenchmarkRunOptions {
  runId: string;
  mode?: RunMode;
  onItem?: (result: BenchmarkItemResult) => void | Promise<void>;
  isUntranslated?: UntranslatedCheck;
}

export interface LiveGuardOptions {
  args: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  requiredEnv?: readonly string[];
}
