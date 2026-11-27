import * as api from "./data";
import { dueRecurringDates, buildSalesInvoiceLines } from "./calc";

const addDaysIso = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const ITEM_KEYS = ["line_no", "item_id", "description", "hsn_sac", "qty", "rate", "amount", "gst_rate", "other_tax_rate", "cgst_amt", "sgst_amt", "igst_amt", "other_tax_amt", "rfid", "extra"];

/**
 * Creates every invoice that has fallen due from the recurring templates (final tax invoices that were
 * marked "repeat"). Each copy is a normal invoice with its own number and its own accounting entries.
 * A template is only advanced after its invoices were saved, so a failure never skips or doubles a date.
 */
export async function generateDueRecurring({ templates, ledgers, businessId, settings = {}, today }) {
  const sys = {}; ledgers.filter((l) => l.system_key).forEach((l) => { sys[l.system_key] = l.id; });
  let created = 0; const errors = [];
  for (const t of templates) {
    const rec = t.meta?.recurring; const { dates, next } = dueRecurringDates(rec, today);
    if (!dates.length) continue;
    try {
      const rows = await api.fetchVoucherItems(t.id);
      const items = rows.map((r) => Object.fromEntries(ITEM_KEYS.filter((k) => k in r).map((k) => [k, r[k]])));
      const totals = { subtotal: t.subtotal, cgst: t.cgst, sgst: t.sgst, igst: t.igst, otherTax: t.other_tax, roundOff: t.round_off, total: t.total };
      for (const date of dates) {
        const voucherNo = await api.nextVoucherNumber(businessId, "sales_invoice", "INV-", settings.numbering?.sales_invoice, date);
        const meta = { ...t.meta, status: "final", send_later: false, generated_from: t.id, due_date: addDaysIso(date, t.meta?.terms?.days || 0) }; delete meta.recurring; delete meta.converted_to; delete meta.converted_from;
        const voucher = { business_id: businessId, vtype: "sales_invoice", voucher_no: voucherNo, vdate: date, party_ledger_id: t.party_ledger_id, main_ledger_id: sys.sales, po_number: t.po_number, narration: t.narration,
          supply_type: t.supply_type, subtotal: t.subtotal, cgst: t.cgst, sgst: t.sgst, igst: t.igst, other_tax: t.other_tax, round_off: t.round_off, total: t.total, meta };
        const lines = buildSalesInvoiceLines({ partyLedgerId: t.party_ledger_id, salesLedgerId: sys.sales, gstLedgers: sys, invoiceTotals: totals });
        await api.saveVoucher(voucher, items, lines);
        created++;
      }
      const ended = rec.end && next > rec.end;
      await api.updateVoucherMeta(t.id, { ...t.meta, recurring: { ...rec, next, active: !ended, last_generated: dates[dates.length - 1] } });
    } catch (e) { errors.push(`${t.voucher_no}: ${e.message}`); }
  }
  return { created, errors };
}
