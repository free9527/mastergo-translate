# Implementation note

The subsystem is confined to `benchmarks/` and imports only Node built-ins plus local benchmark modules. `BenchmarkRunner` is an injection boundary: dry runs use a local runner, while a live adapter is dynamically loaded only after `--allow-live` and required environment checks pass. No provider SDK, production pipeline, or live call is included.

Telemetry is JSONL and records IDs, timing, statuses, metrics, and deterministic quality summaries only. Source text, translated text, environment values, and caught error details are redacted. The analyzer reads JSONL and calculates nearest-rank p50/p95/p99 per arm.
