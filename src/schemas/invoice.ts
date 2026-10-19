import { z } from 'zod';

export const InvoiceItemSchema = z.object({
  description: z.string().min(1, 'Item description cannot be empty'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unit_price: z.number().nonnegative('Unit price cannot be negative'),
  total: z.number().nonnegative('Line total cannot be negative')
});

export const ExtractedInvoiceSchema = z.object({
  invoice_number: z.string().min(1, 'Invoice number is mandatory'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must follow YYYY-MM-DD format'),
  vendor_name: z.string().min(2, 'Vendor name is mandatory'),
  vendor_tax_id: z.string().optional(),
  customer_name: z.string().min(2, 'Customer name is mandatory'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'ARS']).default('USD'),
  items: z.array(InvoiceItemSchema).min(1, 'Must contain at least 1 invoice line item'),
  subtotal: z.number().nonnegative(),
  tax_rate_pct: z.number().min(0).max(100).default(0),
  tax_amount: z.number().nonnegative(),
  grand_total: z.number().positive(),
  payment_terms: z.string().default('Net 30'),
  confidence_score: z.number().min(0).max(1).default(0.95)
});

export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

// Business reconciliation validation: subtotal + tax must match grand_total
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  discrepancyUsd?: number;
}

export function validateFinancialIntegrity(invoice: ExtractedInvoice): ValidationResult {
  const errors: string[] = [];
  
  // 1. Check line items sum vs subtotal
  const calculatedSubtotal = invoice.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
  const subtotalDiff = Math.abs(calculatedSubtotal - invoice.subtotal);
  if (subtotalDiff > 0.05) {
    errors.push(`Line items sum ($${calculatedSubtotal.toFixed(2)}) does not match stated subtotal ($${invoice.subtotal.toFixed(2)})`);
  }

  // 2. Check subtotal + tax vs grand_total
  const expectedTotal = invoice.subtotal + invoice.tax_amount;
  const totalDiff = Math.abs(expectedTotal - invoice.grand_total);
  if (totalDiff > 0.05) {
    errors.push(`Subtotal + Tax ($${expectedTotal.toFixed(2)}) does not match stated grand total ($${invoice.grand_total.toFixed(2)})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    discrepancyUsd: Math.max(subtotalDiff, totalDiff)
  };
}
