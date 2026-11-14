import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DocumentExtractorEngine } from '../src/extractor.js';
import { FIELDS, GoldenSchema, formatComparison, loadGolden, loadRecordings, scoreRun, type GoldenCase } from '../src/evals.js';

const expected = {
  invoice_number: 'X-1', issue_date: '2026-01-02', vendor_name: 'Vendor A', customer_name: 'Customer B',
  currency: 'USD', subtotal: 100, tax_amount: 10, grand_total: 110, item_count: 2
};
const { item_count: _count, ...fields } = expected;
const perfect = { ...fields, items: [{}, {}] };
const golden: GoldenCase[] = [
  { id: 'a', note: '', text: 'text a', expected },
  { id: 'none', note: '', text: 'text b', expected: null }
];

describe('scoreRun', () => {
  it('gives 100% when every field matches and nothing is returned for a non-invoice', () => {
    const s = scoreRun('ok', golden, { a: perfect, none: null });
    expect(s).toMatchObject({ correct: 10, total: 10, accuracy: 1, misses: [] });
  });

  it('counts each wrong field once and reports what was expected', () => {
    const s = scoreRun('bad', golden, { a: { ...perfect, currency: 'EUR', grand_total: 111 }, none: null });
    expect(s.correct).toBe(8);
    expect(s.perField.currency).toEqual({ correct: 0, total: 1 });
    expect(s.misses).toContainEqual({ caseId: 'a', field: 'grand_total', expected: 110, actual: 111 });
  });

  it('counts a missing or null output as wrong on every field (cases are never skipped)', () => {
    expect(scoreRun('missing', golden, { none: null })).toMatchObject({ correct: 1, total: FIELDS.length + 1 });
    expect(scoreRun('null', golden, { a: null, none: null }).total).toBe(FIELDS.length + 1);
  });

  it('marks a made-up invoice for non-invoice text as wrong', () => {
    const s = scoreRun('made-up', golden, { a: perfect, none: perfect });
    expect(s.perField.no_invoice_returned).toEqual({ correct: 0, total: 1 });
  });

  it('accepts rounding noise in amounts but not real differences or wrong types', () => {
    expect(scoreRun('r', golden, { a: { ...perfect, subtotal: 100.001 }, none: null }).accuracy).toBe(1);
    expect(scoreRun('r', golden, { a: { ...perfect, subtotal: 100.01 }, none: null }).perField.subtotal.correct).toBe(0);
    expect(scoreRun('r', golden, { a: { ...perfect, subtotal: '100' }, none: null }).perField.subtotal.correct).toBe(0);
  });

  it('compares the number of line items', () => {
    expect(scoreRun('i', golden, { a: { ...perfect, items: [{}] }, none: null }).perField.item_count.correct).toBe(0);
  });
});

describe('comparison between runs', () => {
  it('shows a regression: a run that loses a field scores lower in the table', () => {
    const before = scoreRun('model-a', golden, { a: perfect, none: null });
    const after = scoreRun('model-b', golden, { a: { ...perfect, vendor_name: 'Wrong' }, none: null });
    expect(after.accuracy).toBeLessThan(before.accuracy);
    const table = formatComparison([before, after]);
    expect(table).toContain('| vendor_name | 1/1 | 0/1 |');
    expect(table).toContain('**100.0%** (10/10) | **90.0%** (9/10)');
  });
});

describe('golden set and recordings in the repo', () => {
  it('golden set is valid and rejects duplicate ids', () => {
    const cases = loadGolden();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(GoldenSchema.safeParse([cases[0], cases[0]]).success).toBe(false);
  });

  it('every recording covers exactly the golden case ids', () => {
    const ids = loadGolden().map((c) => c.id).sort();
    const recordings = loadRecordings();
    expect(recordings.map((r) => r.label)).toContain('heuristic-v1');
    for (const r of recordings) expect(Object.keys(r.outputs).sort()).toEqual(ids);
  });

  it('the extractor is deterministic on the golden set (same input, same score)', () => {
    const cases = loadGolden();
    const run = () => {
      const engine = new DocumentExtractorEngine();
      return scoreRun('x', cases, Object.fromEntries(cases.map((c) => [c.id, engine.extractFromText(c.text).invoice ?? null])));
    };
    expect(run()).toEqual(run());
  });
});

describe('npm run eval (exit code is the CI gate)', () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('npx', ['tsx', 'src/eval.ts', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

  it('passes with the default threshold', () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('PASS: "current"');
  });

  it('fails when the threshold is above the measured accuracy', () => {
    const r = run([], { EVAL_THRESHOLD: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('FAIL: "current"');
  });

  it('can gate a recorded run, and rejects unknown run names and bad thresholds', () => {
    expect(run(['--gate', 'heuristic-v1']).status).toBe(0);
    expect(run(['--gate', 'nope']).status).toBe(2);
    expect(run([], { EVAL_THRESHOLD: 'abc' }).status).toBe(2);
  });
});
