import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Fields compared for every golden case. `item_count` is the number of line items. */
export const FIELDS = [
  'invoice_number', 'issue_date', 'vendor_name', 'customer_name', 'currency',
  'subtotal', 'tax_amount', 'grand_total', 'item_count'
] as const;
export type Field = (typeof FIELDS)[number];

const ExpectedSchema = z.object({
  invoice_number: z.string(),
  issue_date: z.string(),
  vendor_name: z.string(),
  customer_name: z.string(),
  currency: z.string(),
  subtotal: z.number(),
  tax_amount: z.number(),
  grand_total: z.number(),
  item_count: z.number().int()
}).strict();

export const GoldenSchema = z.array(z.object({
  id: z.string().min(1),
  note: z.string(),
  text: z.string().min(1),
  /** null means: the extractor must NOT return an invoice for this text. */
  expected: ExpectedSchema.nullable()
}).strict()).min(1).refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, 'case ids must be unique');
export type GoldenCase = z.infer<typeof GoldenSchema>[number];

/** Outputs of one extractor version or model, keyed by case id. null = no invoice returned. */
export const RecordingSchema = z.object({
  label: z.string().min(1),
  outputs: z.record(z.record(z.unknown()).nullable())
}).strict();
export type Recording = z.infer<typeof RecordingSchema>;

export interface Score {
  label: string;
  /** Correct fields / all fields, over every case. */
  accuracy: number;
  correct: number;
  total: number;
  perField: Record<string, { correct: number; total: number }>;
  misses: Array<{ caseId: string; field: string; expected: unknown; actual: unknown }>;
}

const same = (expected: unknown, actual: unknown) =>
  typeof expected === 'number'
    ? typeof actual === 'number' && Math.abs(expected - actual) < 0.005
    : typeof actual === 'string' && actual.trim() === expected;

/** A missing output counts as wrong on every field: a case can never be skipped silently. */
export function scoreRun(label: string, golden: GoldenCase[], outputs: Recording['outputs']): Score {
  const score: Score = { label, accuracy: 0, correct: 0, total: 0, perField: {}, misses: [] };
  const tally = (caseId: string, field: string, ok: boolean, expected: unknown, actual: unknown) => {
    const f = (score.perField[field] ??= { correct: 0, total: 0 });
    f.total++; score.total++;
    if (ok) { f.correct++; score.correct++; } else score.misses.push({ caseId, field, expected, actual });
  };
  for (const c of golden) {
    const out = outputs[c.id] ?? null;
    if (c.expected === null) {
      tally(c.id, 'no_invoice_returned', out === null, 'no invoice', out === null ? 'no invoice' : 'an invoice');
      continue;
    }
    for (const field of FIELDS) {
      const actual = field === 'item_count' ? (Array.isArray(out?.items) ? out.items.length : undefined) : out?.[field];
      tally(c.id, field, same(c.expected[field], actual), c.expected[field], actual);
    }
  }
  score.accuracy = score.correct / score.total;
  return score;
}

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;

/** Markdown table: one row per field, one column per run. */
export function formatComparison(scores: Score[]): string {
  const fields = Object.keys(scores[0].perField);
  const lines = [
    `| Field | ${scores.map((s) => s.label).join(' | ')} |`,
    `|---|${scores.map(() => '---:').join('|')}|`,
    ...fields.map((f) => `| ${f} | ${scores.map((s) => `${s.perField[f].correct}/${s.perField[f].total}`).join(' | ')} |`),
    `| **total** | ${scores.map((s) => `**${pct(s.correct, s.total)}** (${s.correct}/${s.total})`).join(' | ')} |`
  ];
  return lines.join('\n');
}

export const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'evals');

export function loadGolden(dir = EVALS_DIR): GoldenCase[] {
  return GoldenSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'golden.json'), 'utf8')));
}

export function loadRecordings(dir = EVALS_DIR): Recording[] {
  const recDir = path.join(dir, 'recordings');
  if (!fs.existsSync(recDir)) return [];
  return fs.readdirSync(recDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(recDir, f), 'utf8'))));
}
