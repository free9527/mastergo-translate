# Benchmarks

Standalone, provider-neutral translation benchmark foundation. It has no production-pipeline or provider-SDK imports and makes no network call unless explicitly invoked through an external adapter.

## Arms

- `translation_only`
- `translation_plus_proofread`
- `proofread_only_reference`
- `production_pipeline`

The arm is metadata owned by an injected `BenchmarkRunner`; this foundation intentionally does not wire production code yet.

## Dry run

```sh
npx tsx benchmarks/benchmark-production.ts --arm=production_pipeline
```

Dry-run is the default and uses the local reference/source fixture only. Stdout is JSONL containing `run_start`, one `item_result` per item, and `run_end`. It never writes input or output text to telemetry.

## Live adapter guard

Live operation requires all of:

1. `--allow-live`
2. `BENCHMARK_LIVE_RUNNER_MODULE`, an importable module exporting `createBenchmarkRunner(arm)`
3. `BENCHMARK_LIVE_AUTH`, a non-empty explicit authorization marker

```sh
BENCHMARK_LIVE_RUNNER_MODULE=./path/to/adapter.ts \
BENCHMARK_LIVE_AUTH=1 \
npx tsx benchmarks/benchmark-production.ts --allow-live --arm=translation_only
```

The adapter owns provider configuration and all network behavior. Errors and telemetry are redacted; do not print source content, translations, or credentials from an adapter.

## Analyze JSONL

```sh
npx tsx benchmarks/analyze-results.ts results.jsonl
```

The analyzer reports per-arm count, successful item count, quality-pass count, and p50/p95/p99 duration in milliseconds.

## Quality checks

`checkQuality` deterministically compares source and output for numeric tokens, placeholders, trademark marks, and newline counts. It also accepts an optional `isUntranslated(source, output, targetLanguage)` callback for language-specific untranslated detection. The callback can return `true` or a redaction-safe issue message.
