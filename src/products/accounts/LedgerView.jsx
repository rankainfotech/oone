import React, { useState, useMemo } from "react";
import { Download, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { todayISO, inputCls, BackHeader } from "../../shared";
import { ledgerStatement, fyRange, safeFileName } from "./calc";
import { printHtml } from "./Invoice";

const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const drCr = (n) => (Math.abs(n) < 0.005 ? "₹0.00" : `₹${fmt(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);
const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");

export default function LedgerView({ ledger, vouchers, lines, business, onBack }) {
  const thisFy = fyRange(todayISO());
  const [from, setFrom] = useState(thisFy.from);
  const [to, setTo] = useState(thisFy.to);
  const st = useMemo(() => ledgerStatement(ledger, lines, vouchers, from || null, to || null), [ledger, lines, vouchers, from, to]);
  const lastFy = fyRange(`${Number(thisFy.from.slice(0, 4)) - 1}-04-01`);
  const preset = (r) => { setFrom(r.from); setTo(r.to); };
  const fileName = safeFileName(ledger.name, "Ledger", from && to ? `${dmy(from)} to ${dmy(to)}` : "All time");

  const downloadExcel = () => {
    const aoa = [
      [business?.name || ""], [`Ledger: ${ledger.name}`], [from && to ? `Period: ${dmy(from)} to ${dmy(to)}` : "Period: all time"], [],
      ["Date", "Type", "Voucher No.", "Narration", "Debit", "Credit", "Balance"],
      [dmy(from), "", "", "Opening balance", "", "", drCr(st.opening)],
      ...st.rows.map((r) => [dmy(r.date), r.label, r.voucherNo, r.narration, r.debit || "", r.credit || "", drCr(r.balance)]),
      ["", "", "", "Total", st.totalDebit, st.totalCredit, ""],
      ["", "", "", "Closing balance", "", "", drCr(st.closing)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  const print = () => {
    const rows = st.rows.map((r) => `<tr><td>${dmy(r.date)}</td><td>${esc(r.label)}</td><td>${esc(r.voucherNo)}</td><td>${esc(r.narration)}</td><td class="r">${r.debit ? fmt(r.debit) : ""}</td><td class="r">${r.credit ? fmt(r.credit) : ""}</td><td class="r">${drCr(r.balance)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName)}</title><style>
      @page{size:A4;margin:12mm} body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0}
      h1{font-size:18px;margin:0} .muted{color:#555;margin:2px 0 10px} table{width:100%;border-collapse:collapse}
      th,td{padding:5px 7px;border-bottom:1px solid #ddd;text-align:left} th{background:#f3f3f3;font-size:11px} .r{text-align:right} .b td{font-weight:bold;border-top:2px solid #111}</style></head><body>
      <h1>${esc(business?.name)}</h1><div class="muted">Ledger account: <b>${esc(ledger.name)}</b> · ${from && to ? `${dmy(from)} to ${dmy(to)}` : "All time"}</div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Voucher No.</th><th>Narration</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
      <tr><td>${dmy(from)}</td><td></td><td></td><td><i>Opening balance</i></td><td></td><td></td><td class="r">${drCr(st.opening)}</td></tr>${rows}
      <tr class="b"><td colspan="4">Total</td><td class="r">${fmt(st.totalDebit)}</td><td class="r">${fmt(st.totalCredit)}</td><td></td></tr>
      <tr class="b"><td colspan="6">Closing balance</td><td class="r">${drCr(st.closing)}</td></tr></tbody></table></body></html>`;
    printHtml(html, fileName);
  };

  const box = "bg-gray-50 rounded-lg p-3";
  return (
    <div>
      <BackHeader title={`${ledger.name} — Ledger`} onBack={onBack} />
      <div className="flex items-end gap-2 flex-wrap mb-4">
        <div className="flex gap-1.5">
          <button onClick={() => preset(thisFy)} className="text-xs border border-gray-300 rounded px-2.5 py-1.5 hover:border-black">This year</button>
          <button onClick={() => preset(lastFy)} className="text-xs border border-gray-300 rounded px-2.5 py-1.5 hover:border-black">Last year</button>
          <button onClick={() => { setFrom(""); setTo(""); }} className="text-xs border border-gray-300 rounded px-2.5 py-1.5 hover:border-black">All time</button>
        </div>
        <label className="text-xs text-gray-500">From <input type="date" aria-label="From date" className={inputCls + " !w-auto"} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-gray-500">To <input type="date" aria-label="To date" className={inputCls + " !w-auto"} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="ml-auto flex gap-2">
          <button onClick={downloadExcel} className="text-sm border border-gray-300 rounded px-3 py-1.5 flex items-center gap-1.5 hover:border-black"><Download size={14} /> Excel</button>
          <button onClick={print} className="text-sm border border-gray-300 rounded px-3 py-1.5 flex items-center gap-1.5 hover:border-black"><Printer size={14} /> Print / PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className={box}><div className="text-[11px] text-gray-500">Opening balance</div><div className="tabnum font-medium" aria-label="Opening balance">{drCr(st.opening)}</div></div>
        <div className={box}><div className="text-[11px] text-gray-500">Total debit</div><div className="tabnum font-medium">₹{fmt(st.totalDebit)}</div></div>
        <div className={box}><div className="text-[11px] text-gray-500">Total credit</div><div className="tabnum font-medium">₹{fmt(st.totalCredit)}</div></div>
        <div className="bg-black text-white rounded-lg p-3"><div className="text-[11px] text-gray-300">Closing balance</div><div className="tabnum font-medium" aria-label="Closing balance">{drCr(st.closing)}</div></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]" aria-label="Ledger transactions">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Particulars</th><th className="py-2 pr-2 text-right">Debit</th><th className="py-2 pr-2 text-right">Credit</th><th className="py-2 text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="border-b border-gray-100 text-gray-500 italic"><td className="py-2 pr-2">{dmy(from)}</td><td className="py-2 pr-2">Opening balance</td><td /><td /><td className="py-2 text-right tabnum">{drCr(st.opening)}</td></tr>
            {st.rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2 pr-2 whitespace-nowrap">{dmy(r.date)}</td>
                <td className="py-2 pr-2"><span className="font-medium">{r.label}</span> <span className="text-gray-500">{r.voucherNo}</span>{r.narration && <div className="text-xs text-gray-400">{r.narration}</div>}</td>
                <td className="py-2 pr-2 text-right tabnum">{r.debit ? fmt(r.debit) : ""}</td>
                <td className="py-2 pr-2 text-right tabnum">{r.credit ? fmt(r.credit) : ""}</td>
                <td className="py-2 text-right tabnum">{drCr(r.balance)}</td>
              </tr>
            ))}
            {st.rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-400">No transactions in this period.</td></tr>}
          </tbody>
          <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2" colSpan={2}>Total</td><td className="py-2 pr-2 text-right tabnum">{fmt(st.totalDebit)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(st.totalCredit)}</td><td className="py-2 text-right tabnum">{drCr(st.closing)}</td></tr></tfoot>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Dr = the customer owes you · Cr = you owe them (or they paid in advance). Drafts and proforma invoices are not part of the ledger.</p>
    </div>
  );
}
