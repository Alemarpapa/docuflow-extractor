import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { ExtractedInvoice } from './schemas/invoice.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'docuflow.sqlite');
export const db: Database.Database = new Database(DB_PATH);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      invoice_number TEXT NOT NULL UNIQUE,
      vendor_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      grand_total REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('approved', 'needs_review', 'rejected')),
      confidence_score REAL NOT NULL,
      reconciliation_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY(document_id) REFERENCES processed_documents(id) ON DELETE CASCADE
    );
  `);
}

export function saveExtractedDocument(
  docId: string,
  filename: string,
  invoice: ExtractedInvoice,
  status: 'approved' | 'needs_review' | 'rejected',
  notes: string = ''
) {
  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO processed_documents (
      id, filename, invoice_number, vendor_name, customer_name,
      issue_date, currency, subtotal, tax_amount, grand_total,
      status, confidence_score, reconciliation_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO document_line_items (document_id, description, quantity, unit_price, total)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    insertDoc.run(
      docId,
      filename,
      invoice.invoice_number,
      invoice.vendor_name,
      invoice.customer_name,
      invoice.issue_date,
      invoice.currency,
      invoice.subtotal,
      invoice.tax_amount,
      invoice.grand_total,
      status,
      invoice.confidence_score,
      notes
    );

    // Clean previous line items if replacing
    db.prepare('DELETE FROM document_line_items WHERE document_id = ?').run(docId);

    for (const item of invoice.items) {
      insertItem.run(docId, item.description, item.quantity, item.unit_price, item.total);
    }
  });

  transaction();
}
