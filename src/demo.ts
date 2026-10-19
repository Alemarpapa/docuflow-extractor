import { initDatabase, saveExtractedDocument, db } from './db.js';
import { DocumentExtractorEngine } from './extractor.js';

// Realistic sample enterprise invoices
const SAMPLE_INVOICE_VALID = `
INVOICE #INV-2026-8841
Date: 2026-10-18
Vendor: Apex Cloud Technologies LLC
Customer: Nexus Digital Media Corp
Payment Terms: Net 30

Line Items:
- Kubernetes Cluster Hosting (Standard Node): 3 x $450.00 = $1350.00
- Dedicated Load Balancer Enterprise: 1 x $200.00 = $200.00
- Database Backup Storage (TB): 5 x $30.00 = $150.00

Subtotal: $1700.00
Tax: $170.00
Total: $1870.00
`;

const SAMPLE_INVOICE_DISCREPANCY = `
INVOICE #INV-2026-9912
Date: 2026-10-19
Vendor: DataStream Analytics Inc.
Customer: FinEdge International Ltd.

Line Items:
- Real-time Pipeline Ingestion: 2 x $800.00 = $1600.00
- Security Compliance Audit: 1 x $500.00 = $500.00

Subtotal: $2100.00
Tax: $210.00
Total: $2450.00
`; // Notice: 2100 + 210 is 2310, but total says 2450! (Audit discrepancy)

async function runDemo() {
  console.log('===============================================================');
  console.log('🚀 DocuFlow: Autonomous Document Ingestion & Structured Output');
  console.log('===============================================================\n');

  initDatabase();
  const engine = new DocumentExtractorEngine();

  // Test 1: Valid Invoice Processing
  console.log('📄 [BATCH 1/2] Processing Invoice: apex_cloud_october.pdf');
  const res1 = engine.extractFromText(SAMPLE_INVOICE_VALID);
  if (res1.success && res1.invoice) {
    saveExtractedDocument('DOC-001', 'apex_cloud_october.pdf', res1.invoice, res1.status, res1.reconciliationNotes);
    console.log(`✅ Extracted Invoice #${res1.invoice.invoice_number}`);
    console.log(`   Vendor:       ${res1.invoice.vendor_name}`);
    console.log(`   Subtotal:     $${res1.invoice.subtotal.toFixed(2)} | Tax: $${res1.invoice.tax_amount.toFixed(2)}`);
    console.log(`   Grand Total:  $${res1.invoice.grand_total.toFixed(2)} ${res1.invoice.currency}`);
    console.log(`   Status:       [${res1.status.toUpperCase()}]`);
    console.log(`   Notes:        ${res1.reconciliationNotes}\n`);
  }

  // Test 2: Invoice with Math/Audit Discrepancy
  console.log('📄 [BATCH 2/2] Processing Invoice: datastream_q3_mismatch.pdf');
  const res2 = engine.extractFromText(SAMPLE_INVOICE_DISCREPANCY);
  if (res2.success && res2.invoice) {
    saveExtractedDocument('DOC-002', 'datastream_q3_mismatch.pdf', res2.invoice, res2.status, res2.reconciliationNotes);
    console.log(`⚠️ Extracted Invoice #${res2.invoice.invoice_number}`);
    console.log(`   Vendor:       ${res2.invoice.vendor_name}`);
    console.log(`   Subtotal:     $${res2.invoice.subtotal.toFixed(2)} | Tax: $${res2.invoice.tax_amount.toFixed(2)}`);
    console.log(`   Grand Total:  $${res2.invoice.grand_total.toFixed(2)} ${res2.invoice.currency}`);
    console.log(`   Status:       [${res2.status.toUpperCase()}]`);
    console.log(`   Discrepancy:  ${res2.reconciliationNotes}\n`);
  }

  // Database verification
  console.log('📊 DATABASE VERIFICATION (docuflow.sqlite):');
  const records = db.prepare('SELECT id, invoice_number, vendor_name, grand_total, status FROM processed_documents').all();
  console.table(records);

  const items = db.prepare('SELECT document_id, description, quantity, unit_price, total FROM document_line_items').all();
  console.log('\n📦 EXTRACTED LINE ITEMS TABLE:');
  console.table(items);

  console.log('\n✨ Pipeline completed successfully.');
}

runDemo().catch(console.error);
