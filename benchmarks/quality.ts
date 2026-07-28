import type { QualityCheckInput, QualityIssue, QualityResult } from './types';

const PLACEHOLDER = /__(?:GLOSSARY|[A-Z][A-Z0-9_]*)_\d+__|\{\{[^{}]+\}\}|\$\{[^{}]+\}|%\d*\$?[sd]|\$\d+/g;
const NUMBER = /(?<![\p{L}\p{N}])[+-]?(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[.,]\d+)?(?:%|\s?(?:ms|s|kg|g|cm|mm|m|GB|TB|MHz|GHz|W|V))?/gu;
const TRADEMARK = /[®™℠]/g;

function occurrences(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of right) {
    const next = (counts.get(value) ?? 0) - 1;
    if (next < 0) return false;
    counts.set(value, next);
  }
  return true;
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

/**
 * Checks invariants that must survive a translation. It intentionally does not
 * decide whether natural-language text is translated; inject that policy via
 * `isUntranslated` so language-specific logic remains outside this foundation.
 */
export function checkQuality(input: QualityCheckInput): QualityResult {
  const issues: QualityIssue[] = [];
  const sourceNumbers = occurrences(input.source, NUMBER);
  const outputNumbers = occurrences(input.output, NUMBER);
  if (!sameMultiset(sourceNumbers, outputNumbers)) {
    issues.push({ code: 'numbers', message: 'Numeric tokens differ from source.' });
  }

  const sourcePlaceholders = occurrences(input.source, PLACEHOLDER);
  const outputPlaceholders = occurrences(input.output, PLACEHOLDER);
  if (!sameMultiset(sourcePlaceholders, outputPlaceholders)) {
    issues.push({ code: 'placeholders', message: 'Placeholders differ from source.' });
  }

  const sourceMarks = occurrences(input.source, TRADEMARK);
  const outputMarks = occurrences(input.output, TRADEMARK);
  if (!sameMultiset(sourceMarks, outputMarks)) {
    issues.push({ code: 'trademarks', message: 'Trademark marks differ from source.' });
  }

  if (countNewlines(input.source) !== countNewlines(input.output)) {
    issues.push({ code: 'newlines', message: 'Newline count differs from source.' });
  }

  const untranslated = input.isUntranslated?.(input.source, input.output, input.targetLanguage);
  if (untranslated) {
    issues.push({
      code: 'untranslated',
      message: typeof untranslated === 'string' ? untranslated : 'Output was reported as untranslated.',
    });
  }

  return { passed: issues.length === 0, issues };
}
