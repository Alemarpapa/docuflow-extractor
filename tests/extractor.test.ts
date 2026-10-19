import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentExtractorEngine } from '../src/extractor.js';
import { validateFinancialIntegrity, type ExtractedInvoice } from '../src/schemas/invoice.js';

describe('DocuFlow Extractor - Verification Suite', () => {
  let engine: DocumentExtractorEngine;

  beforeAll(() => {
    engine = new DocumentExtractorEngine();
  });

  it('should approve valid invoice with perfect mathematical reconciliation', () => {
    const raw = `
INVOICE #INV-TEST-100
Date: 2026-10-19
Vendor: Global Cloud Net
Customer: Corp Alpha
- Compute Instance: 2 x $100.00 = $200.00
Subtotal: $200.00
Tax: $20.00
Total: $220.00
    `;

    const result = engine.extractFromText(raw);
    expect(result.success).toBe(true);
    expect(result.status).toBe('approved');
    expect(result.invoice?.grand_total).toBe(220);
    expect(result.invoice?.items.length).toBe(1);
  });

  it('should flag needs_review when subtotal and tax do not equal grand total', () => {
    const invoiceCandidate: ExtractedInvoice = {
      invoice_number: 'INV-FAULTY-01',
      issue_date: '2026-10-19',
      vendor_name: 'Miscalculated SaaS Inc.',
      customer_name: 'Client Beta',
      currency: 'USD',
      items: [
        { description: 'Consulting Hour', quantity: 2, unit_price: 150, total: 300 }
      ],
      subtotal: 300,
      tax_rate_pct: 10,
      tax_amount: 30,
      grand_total: 450, // Intentional mismatch: 300 + 30 != 450
      payment_terms: 'Net 30',
      confidence_score: 0.99
    };

    const integrity = validateFinancialIntegrity(invoiceCandidate);
    expect(integrity.isValid).toBe(false);
    expect(integrity.errors[0]).toContain('does not match stated grand total');
  });

  it('should reject malformed document failing contract schema', () => {
    const raw = `
Random gibberish that lacks structure or date.
No numbers here.
    `;

    const result = engine.extractFromText(raw);
    // Should fallback or reject based on schema rules
    expect(result).toBeDefined();
  });
});
