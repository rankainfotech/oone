import React, { useState, useMemo } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { todayISO, inputCls } from "../../shared";
import { PeriodBar, initialPeriod, periodLabel } from "./PeriodBar";
import { gstReport, ageingReport, billRegister, safeFileName, BUCKETS } from "./calc";

const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");
function exportAoa(nameParts, sheet, aoa) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet.slice(0, 30));
  XLSX.writeFile(wb, `${safeFileName(...nameParts)}.xlsx`);
}
const ExcelButton = ({ onClick }) => <button onClick={onClick} className="text-sm border border-gray-300 rounded px-3 py-1.5 flex items-center gap-1.5 hover:border-black"><Download size={14} /> Excel</button>;
const Th = ({ children, right }) => <th className={`py-2 pr-2 ${right ? "text-right" : ""}`}>{children}</th>;

/* ---------------- GST ---------------- */
export function GstReport({ vouchers, ledgers }) {
  const [period, setPeriod] = useState(initialPeriod());
  const r = useMemo(() => gstReport(vouchers, ledgers, period.from, period.to), [vouchers, ledgers, period]);
  const T = r.totals;
  const taxRow = (label, o) => <tr className="border-b border-gray-100"><td className="py-2 pr-2">{label}</td><td className="py-2 pr-2 text-right tabnum">{fmt(o.taxable)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(o.cgst)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(o.sgst)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(o.igst)}</td><td className="py-2 text-right tabnum">{fmt(o.total)}</td></tr>;
  const download = () => exportAoa(["GST report", periodLabel(period)], "GST", [["GST report", periodLabel(period)], [], ["Summary", "Taxable value", "CGST", "SGST", "IGST"],
    ["Outward supplies (sales less credit notes)", T.outward.taxable, T.outward.cgst, T.outward.sgst, T.outward.igst], ["Input tax credit (purchases less debit notes)", T.inward.taxable, T.inward.cgst, T.inward.sgst, T.inward.igst], ["Net GST payable", "", r.net.cgst, r.net.sgst, r.net.igst], [],
    ["Outward invoices"], ["Date", "Type", "No.", "Party", "GSTIN", "Place of supply", "Taxable", "CGST", "SGST", "IGST", "Total"], ...r.outward.map((x) => [dmy(x.date), x.type, x.no, x.party, x.gstin, x.place, x.taxable, x.cgst, x.sgst, x.igst, x.total]), [],
    ["Inward (purchases)"], ["Date", "Type", "No.", "Party", "GSTIN", "", "Taxable", "CGST", "SGST", "IGST", "Total"], ...r.inward.map((x) => [dmy(x.date), x.type, x.no, x.party, x.gstin, "", x.taxable, x.cgst, x.sgst, x.igst, x.total])]);
  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4"><PeriodBar value={period} onChange={setPeriod} /><ExcelButton onClick={download} /></div>
      <h3 className="font-display text-base mb-2">GST position</h3>
      <div className="overflow-x-auto mb-6"><table className="w-full text-sm min-w-[560px]" aria-label="GST summary">
        <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><Th>&nbsp;</Th><Th right>Taxable value</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>IGST</Th><Th right>Total</Th></tr></thead>
        <tbody>
          {taxRow("Outward supplies (sales less credit notes)", T.outward)}
          {taxRow("Input tax credit (purchases less debit notes)", T.inward)}
          <tr className="font-semibold border-t-2 border-black bg-gray-50"><td className="py-2 pr-2">Net GST payable (output − input)</td><td /><td className="py-2 pr-2 text-right tabnum" aria-label="Net CGST">{fmt(r.net.cgst)}</td><td className="py-2 pr-2 text-right tabnum" aria-label="Net SGST">{fmt(r.net.sgst)}</td><td className="py-2 pr-2 text-right tabnum" aria-label="Net IGST">{fmt(r.net.igst)}</td><td className="py-2 text-right tabnum" aria-label="Net GST total">{fmt(r.net.total)}</td></tr>
        </tbody></table></div>
      <h3 className="font-display text-base mb-2">Sales to registered businesses (B2B) — {r.b2b.length}</h3>
      <BillTable rows={r.b2b} label="B2B invoices" />
      <h3 className="font-display text-base mt-6 mb-2">Sales to others (B2C) — {r.b2c.length}</h3>
      <BillTable rows={r.b2c} label="B2C invoices" />
      <p className="text-[11px] text-gray-400 mt-5">Worked out from your final bills. Drafts and proforma invoices are left out; credit and debit notes reduce the totals. A negative net amount means you have more input credit than output tax. Use this to prepare your return; it is not filed from here.</p>
    </div>
  );
}
function BillTable({ rows, label }) {
  if (!rows.length) return <p className="text-sm text-gray-400 mb-2">None in this period.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]" aria-label={label}>
      <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><Th>Date</Th><Th>No.</Th><Th>Party</Th><Th>GSTIN</Th><Th right>Taxable</Th><Th right>Tax</Th><Th right>Total</Th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.id} className="border-b border-gray-100"><td className="py-1.5 pr-2 whitespace-nowrap">{dmy(x.date)}</td><td className="py-1.5 pr-2">{x.no}{x.type === "credit_note" && <span className="ml-1 text-[10px] text-red-700">credit note</span>}</td><td className="py-1.5 pr-2">{x.party}</td><td className="py-1.5 pr-2 text-xs text-gray-500">{x.gstin}</td><td className="py-1.5 pr-2 text-right tabnum">{fmt(x.taxable)}</td><td className="py-1.5 pr-2 text-right tabnum">{fmt(x.cgst + x.sgst + x.igst + x.other)}</td><td className="py-1.5 text-right tabnum">{fmt(x.total)}</td></tr>)}</tbody></table></div>
  );
}

/* ---------------- ageing ---------------- */
const PRIORITY = { high: ["HIGH PRIORITY", "bg-red-100 text-red-800"], medium: ["MEDIUM", "bg-yellow-100 text-yellow-800"], low: ["LOW", "bg-gray-100 text-gray-700"], none: ["Not due", "bg-green-50 text-green-700"] };
export function AgeingReport({ kind, vouchers, allocations, ledgers, lines }) {
  const [asOf, setAsOf] = useState(todayISO());
  const [open, setOpen] = useState(null);
  const data = useMemo(() => ageingReport({ vouchers, allocations, ledgers, lines, asOf, kind }), [vouchers, allocations, ledgers, lines, asOf, kind]);
  const recv = kind === "receivable"; const sel = data.rows.find((r) => r.partyId === open);
  const download = () => exportAoa([recv ? "Receivable ageing" : "Payable ageing", dmy(asOf)], "Ageing", [[recv ? "Receivable ageing" : "Payable ageing", `as at ${dmy(asOf)}`], [], [recv ? "Customer" : "Vendor", ...BUCKETS.map(([, l]) => l), "Open bills", "On account", "Ledger balance", "Priority"],
    ...data.rows.map((r) => [r.name, ...BUCKETS.map(([k]) => r.buckets[k]), r.open, r.onAccount, r.ledgerBalance, PRIORITY[r.priority][0]]), ["Total", ...BUCKETS.map(([k]) => data.totals.buckets[k]), data.totals.open, "", "", ""]]);
  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4"><label className="text-xs text-gray-500">As at <input type="date" aria-label="Ageing as at" className={inputCls + " !w-auto"} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label><ExcelButton onClick={download} /></div>
      {data.rows.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">{recv ? "Nobody owes you anything on open bills." : "You owe nothing on open bills."}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]" aria-label={recv ? "Receivable ageing" : "Payable ageing"}>
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><Th>{recv ? "Customer" : "Vendor"}</Th>{BUCKETS.map(([k, l]) => <Th key={k} right>{l}</Th>)}<Th right>Open bills</Th><Th right>On account</Th>{recv && <Th>Priority</Th>}</tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.partyId} onClick={() => setOpen(open === r.partyId ? null : r.partyId)} className="border-b border-gray-100 cursor-pointer hover:bg-gray-50">
              <td className="py-2.5 pr-2 font-medium">{r.name}{r.maxOverdue > 0 && <div className="text-[11px] font-normal text-gray-400">oldest {r.maxOverdue} days overdue</div>}</td>
              {BUCKETS.map(([k]) => <td key={k} className={`py-2.5 pr-2 text-right tabnum ${k === "d90" && r.buckets[k] ? "text-red-700 font-medium" : ""}`}>{r.buckets[k] ? fmt(r.buckets[k]) : "—"}</td>)}
              <td className="py-2.5 pr-2 text-right tabnum font-medium">{fmt(r.open)}</td><td className="py-2.5 pr-2 text-right tabnum text-gray-500" title="Money received or paid that is not tied to a specific bill">{Math.abs(r.onAccount) > 0.005 ? fmt(r.onAccount) : "—"}</td>
              {recv && <td className="py-2.5"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${PRIORITY[r.priority][1]}`}>{PRIORITY[r.priority][0]}</span></td>}
            </tr>))}</tbody>
          <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2">Total</td>{BUCKETS.map(([k]) => <td key={k} className="py-2 pr-2 text-right tabnum">{fmt(data.totals.buckets[k])}</td>)}<td className="py-2 pr-2 text-right tabnum" aria-label="Total open">{fmt(data.totals.open)}</td><td colSpan={recv ? 2 : 1} /></tr></tfoot></table></div>
      )}
      {sel && (
        <div className="mt-5 border border-gray-200 rounded-lg p-4" aria-label={`Open bills of ${sel.name}`}>
          <h3 className="font-display text-base mb-2">{sel.name} — open bills</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><Th>Bill</Th><Th>Date</Th><Th>Due</Th><Th right>Days overdue</Th><Th right>Open</Th></tr></thead>
            <tbody>{sel.bills.map((b) => <tr key={b.id} className="border-b border-gray-100"><td className="py-1.5 pr-2">{b.no}</td><td className="py-1.5 pr-2 whitespace-nowrap">{dmy(b.date)}</td><td className="py-1.5 pr-2 whitespace-nowrap">{dmy(b.due)}</td><td className="py-1.5 pr-2 text-right tabnum">{b.overdue || "—"}</td><td className="py-1.5 text-right tabnum">{fmt(b.open)}</td></tr>)}</tbody></table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-4">Bills are aged from their due date (invoice date plus the payment terms). “On account” is money received or paid that is not tied to a particular bill, so Open bills + On account equals the party's ledger balance. {recv ? "Priority: HIGH = something over 90 days overdue (or over ₹1 lakh overdue by more than 60 days); MEDIUM = 31–90 days; LOW = up to 30 days." : ""}</p>
    </div>
  );
}

/* ---------------- registers ---------------- */
export function RegisterReport({ side, vouchers, ledgers }) {
  const [period, setPeriod] = useState(initialPeriod());
  const r = useMemo(() => billRegister(vouchers, ledgers, period.from, period.to, side), [vouchers, ledgers, period, side]);
  const title = side === "purchase" ? "Purchase register" : "Sales register";
  const download = () => exportAoa([title, periodLabel(period)], title, [[title, periodLabel(period)], [], ["Date", "Type", "No.", "Party", "GSTIN", "Taxable", "Tax", "Total"], ...r.rows.map((x) => [dmy(x.date), x.type, x.no, x.party, x.gstin, x.taxable, x.tax, x.total]), ["", "", "", "", "Total", r.totals.taxable, r.totals.tax, r.totals.total]]);
  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4"><PeriodBar value={period} onChange={setPeriod} /><ExcelButton onClick={download} /></div>
      {r.rows.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No {side === "purchase" ? "purchases" : "sales"} in this period.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]" aria-label={title}>
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th>Party</Th><Th right>Taxable</Th><Th right>Tax</Th><Th right>Total</Th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.id} className="border-b border-gray-100"><td className="py-2 pr-2 whitespace-nowrap">{dmy(x.date)}</td><td className="py-2 pr-2">{x.type}</td><td className="py-2 pr-2">{x.no}</td><td className="py-2 pr-2">{x.party}</td><td className="py-2 pr-2 text-right tabnum">{fmt(x.taxable)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(x.tax)}</td><td className="py-2 text-right tabnum">{fmt(x.total)}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2" colSpan={4}>Total</td><td className="py-2 pr-2 text-right tabnum" aria-label="Register taxable">{fmt(r.totals.taxable)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(r.totals.tax)}</td><td className="py-2 text-right tabnum" aria-label="Register total">{fmt(r.totals.total)}</td></tr></tfoot></table></div>
      )}
      <p className="text-[11px] text-gray-400 mt-4">Final bills only; drafts and proformas are left out. {side === "purchase" ? "Debit notes" : "Credit notes"} are shown as negative amounts.</p>
    </div>
  );
}
