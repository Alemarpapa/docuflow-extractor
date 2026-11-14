// Offline eval: scores the extractor in this repo and every recorded run against the golden set.
// No network, no API key. Exit code 1 when the gated run is below the threshold.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DocumentExtractorEngine } from './extractor.js';
import { EVALS_DIR, formatComparison, loadGolden, loadRecordings, scoreRun, type Recording } from './evals.js';

/** Minimum total accuracy. The extractor in this repo scored 66/74 fields (89.2%) when this was set; see README. */
const DEFAULT_THRESHOLD = 0.85;

const { values } = parseArgs({
  options: {
    record: { type: 'string' }, // save the current extractor's outputs as evals/recordings/<label>.json
    gate: { type: 'string', default: 'current' }, // which run must pass the threshold
    verbose: { type: 'boolean', default: false }
  }
});

const threshold = process.env.EVAL_THRESHOLD === undefined ? DEFAULT_THRESHOLD : Number(process.env.EVAL_THRESHOLD);
if (!(threshold >= 0 && threshold <= 1)) {
  console.error('EVAL_THRESHOLD must be a number between 0 and 1.');
  process.exit(2);
}

const golden = loadGolden();
const engine = new DocumentExtractorEngine();
const current: Recording['outputs'] = {};
for (const c of golden) current[c.id] = engine.extractFromText(c.text).invoice ?? null;

if (values.record) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(values.record)) {
    console.error('Recording label may only contain letters, digits, dot, dash and underscore.');
    process.exit(2);
  }
  const file = path.join(EVALS_DIR, 'recordings', `${values.record}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ label: values.record, outputs: current }, null, 2) + '\n');
  console.log(`Saved ${path.relative(process.cwd(), file)}`);
}

const scores = [
  ...loadRecordings().map((r) => scoreRun(r.label, golden, r.outputs)),
  scoreRun('current', golden, current)
];
console.log(`Golden set: ${golden.length} synthetic cases\n`);
console.log(formatComparison(scores));

const gated = scores.find((s) => s.label === values.gate);
if (!gated) {
  console.error(`\nNo run named "${values.gate}". Available: ${scores.map((s) => s.label).join(', ')}`);
  process.exit(2);
}
if (values.verbose) {
  console.log(`\nMisses for "${gated.label}":`);
  for (const m of gated.misses) console.log(`- ${m.caseId}.${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`);
}
const passed = gated.accuracy >= threshold;
console.log(`\n${passed ? 'PASS' : 'FAIL'}: "${gated.label}" total accuracy ${(gated.accuracy * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(1)}%)`);
process.exit(passed ? 0 : 1);
