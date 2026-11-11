import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DocumentExtractorEngine } from '../src/extractor.js';
import { validateFinancialIntegrity, type ExtractedInvoice } from '../src/schemas/invoice.js';

const engine = new DocumentExtractorEngine();

const invoiceText = (lines: string[]) => `INVOICE #INV-EDGE-1\nDate: 2026-10-19\nVendor: Edge Vendor\nCustomer: Edge Customer\n${lines.join('\n')}\n`;

describe('DocumentExtractorEngine - edge cases and error paths', () => {
  it('flags needs_review (not rejected) when stated total disagrees with subtotal + tax', () => {
    const r = engine.extractFromText(invoiceText(['- Compute: 2 x $100.00 = $200.00', 'Subtotal: $200.00', 'Tax: $20.00', 'Total: $999.00']));
    expect(r.success).toBe(true);
    expect(r.status).toBe('needs_review');
    expect(r.invoice?.grand_total).toBe(999);
    expect(r.reconciliationNotes).toContain('Subtotal + Tax ($220.00) does not match stated grand total ($999.00)');
  });

  it('flags needs_review when line items do not sum to the stated subtotal', () => {
    const r = engine.extractFromText(invoiceText(['- Compute: 2 x $100.00 = $200.00', 'Subtotal: $300.00', 'Tax: $30.00', 'Total: $330.00']));
    expect(r.status).toBe('needs_review');
    expect(r.reconciliationNotes).toContain('Line items sum ($200.00) does not match stated subtotal ($300.00)');
    expect(r.reconciliationNotes).not.toContain('grand total');
  });

  it('rejects at schema level when the grand total is zero, reporting the failing field path', () => {
    const r = engine.extractFromText(invoiceText(['- Freebie: 1 x $0 = $0', 'Subtotal: $0', 'Tax: $0', 'Total: $0.00']));
    expect(r.success).toBe(false);
    expect(r.status).toBe('rejected');
    expect(r.invoice).toBeUndefined();
    expect(r.errors?.some((e) => e.startsWith('grand_total'))).toBe(true);
  });

  it('rejects a line item with zero quantity (quantity must be positive)', () => {
    const r = engine.extractFromText(invoiceText(['- Ghost item: 0 x $50.00 = $0.00', 'Subtotal: $100.00', 'Tax: $10.00', 'Total: $110.00']));
    expect(r.status).toBe('rejected');
    expect(r.errors).toContain('items.0.quantity: Quantity must be greater than 0');
  });

  it('parses thousands separators and enforces the 0.05 reconciliation tolerance boundary', () => {
    const ok = engine.extractFromText(invoiceText(['- Servers: 10 x $1,250.00 = $12,500.00', 'Subtotal: $12,500.00', 'Tax: $1,250.00', 'Total: $13,750.04']));
    expect(ok.invoice?.subtotal).toBe(12500);
    expect(ok.invoice?.items[0].unit_price).toBe(1250);
    expect(ok.status).toBe('approved'); // 0.04 off is within tolerance

    const bad = engine.extractFromText(invoiceText(['- Servers: 10 x $1,250.00 = $12,500.00', 'Subtotal: $12,500.00', 'Tax: $1,250.00', 'Total: $13,750.10']));
    expect(bad.status).toBe('needs_review'); // 0.10 off is not
  });

  it('validateFinancialIntegrity reports both discrepancies at once and the largest gap', () => {
    const inv: ExtractedInvoice = {
      invoice_number: 'INV-X', issue_date: '2026-10-19', vendor_name: 'V1', customer_name: 'C1', currency: 'USD',
      items: [{ description: 'a', quantity: 1, unit_price: 100, total: 100 }],
      subtotal: 150, tax_rate_pct: 10, tax_amount: 15, grand_total: 200, payment_terms: 'Net 30', confidence_score: 0.9,
    };
    const v = validateFinancialIntegrity(inv);
    expect(v.isValid).toBe(false);
    expect(v.errors).toHaveLength(2);
    expect(v.discrepancyUsd).toBeCloseTo(50, 5);
  });
});

describe('saveExtractedDocument - persistence', () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-'));
  let closeDb: () => void = () => {};

  afterAll(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-saving the same document id replaces its line items instead of duplicating them', async () => {
    // db.ts opens ./data/docuflow.sqlite relative to cwd at import time: isolate it in a temp dir.
    process.chdir(tmpDir);
    const dbMod = await import('../src/db.js');
    process.chdir(originalCwd);
    closeDb = () => dbMod.db.close();
    dbMod.initDatabase();

    const first = engine.extractFromText(invoiceText(['- A: 1 x $10.00 = $10.00', '- B: 2 x $5.00 = $10.00', 'Subtotal: $20.00', 'Tax: $2.00', 'Total: $22.00'])).invoice!;
    dbMod.saveExtractedDocument('doc-1', 'a.txt', first, 'approved', 'ok');
    expect((dbMod.db.prepare('SELECT COUNT(*) c FROM document_line_items WHERE document_id = ?').get('doc-1') as any).c).toBe(2);

    const second = engine.extractFromText(invoiceText(['- C: 1 x $20.00 = $20.00', 'Subtotal: $20.00', 'Tax: $2.00', 'Total: $22.00'])).invoice!;
    dbMod.saveExtractedDocument('doc-1', 'a.txt', second, 'needs_review', 'redo');

    const items = dbMod.db.prepare('SELECT description FROM document_line_items WHERE document_id = ?').all('doc-1') as any[];
    expect(items.map((i) => i.description)).toEqual(['C']);
    const doc = dbMod.db.prepare('SELECT status FROM processed_documents WHERE id = ?').get('doc-1') as any;
    expect(doc.status).toBe('needs_review');
  });
});
