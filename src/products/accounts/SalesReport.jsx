import React, { useState, useMemo } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { inr } from "../../shared";
import { salesBySalesperson, safeFileName } from "./calc";
import { PeriodBar, initialPeriod, periodLabel } from "./PeriodBar";

const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How much each salesperson has sold, collected and still has to collect. */
export default function SalesBySalesperson({ vouchers, allocations, ledgers, onOpenVoucher }) {
  const [period, setPeriod] = useState(initialPeriod());
  const [open, setOpen] = useState(null);
  const data = useMemo(() => salesBySalesperson(vouchers, allocations, period.from, period.to), [vouchers, allocations, period]);
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const selected = data.rows.find((r) => r.key === open);

  const download = () => {
    const aoa = [["Sales by salesperson"], [periodLabel(period)], [], ["Salesperson", "Invoices", "Net sales", "GST & other taxes", "Invoice total", "Collected", "Outstanding", "Share of sales %"],
      ...data.rows.map((r) => [r.name, r.count, r.net, r.tax, r.total, r.collected, r.outstanding, r.share]),
      ["Total", data.totals.count, data.totals.net, data.totals.tax, data.totals.total, data.totals.collected, data.totals.outstanding, ""]];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Salespersons");
    XLSX.writeFile(wb, `${safeFileName("Sales by salesperson", periodLabel(period))}.xlsx`);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <PeriodBar value={period} onChange={(p) => { setPeriod(p); setOpen(null); }} />
        <button onClick={download} className="text-sm border border-gray-300 rounded px-3 py-1.5 flex items-center gap-1.5 hover:border-black"><Download size={14} /> Excel</button>
      </div>
      {data.rows.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No sales in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]" aria-label="Sales by salesperson">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Salesperson</th><th className="py-2 pr-2 text-right">Invoices</th><th className="py-2 pr-2 text-right">Net sales</th><th className="py-2 pr-2 text-right">GST &amp; taxes</th><th className="py-2 pr-2 text-right">Invoice total</th><th className="py-2 pr-2 text-right">Collected</th><th className="py-2 pr-2 text-right">Outstanding</th><th className="py-2 text-right">Share</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} onClick={() => setOpen(open === r.key ? null : r.key)} className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${open === r.key ? "bg-gray-50" : ""}`}>
                  <td className="py-2.5 pr-2 font-medium">{r.name}</td><td className="py-2.5 pr-2 text-right tabnum">{r.count}</td>
                  <td className="py-2.5 pr-2 text-right tabnum">{fmt(r.net)}</td><td className="py-2.5 pr-2 text-right tabnum">{fmt(r.tax)}</td><td className="py-2.5 pr-2 text-right tabnum">{fmt(r.total)}</td>
                  <td className="py-2.5 pr-2 text-right tabnum text-green-700">{fmt(r.collected)}</td><td className="py-2.5 pr-2 text-right tabnum text-red-700">{fmt(r.outstanding)}</td>
                  <td className="py-2.5 text-right tabnum">{r.share}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2">Total</td><td className="py-2 pr-2 text-right tabnum">{data.totals.count}</td><td className="py-2 pr-2 text-right tabnum">{fmt(data.totals.net)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(data.totals.tax)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(data.totals.total)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(data.totals.collected)}</td><td className="py-2 pr-2 text-right tabnum">{fmt(data.totals.outstanding)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      {selected && (
        <div className="mt-5 border border-gray-200 rounded-lg p-4" aria-label={`Invoices of ${selected.name}`}>
          <h3 className="font-display text-base mb-2">{selected.name} — invoices</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-1.5 pr-2">Date</th><th className="py-1.5 pr-2">Invoice</th><th className="py-1.5 pr-2">Customer</th><th className="py-1.5 pr-2 text-right">Total</th><th className="py-1.5 pr-2 text-right">Collected</th><th className="py-1.5 text-right">Outstanding</th></tr></thead>
            <tbody>{selected.invoices.map((i) => (
              <tr key={i.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 whitespace-nowrap">{i.date}</td>
                <td className="py-1.5 pr-2">{onOpenVoucher ? <button className="text-blue-700 underline" onClick={() => onOpenVoucher({ id: i.id, vtype: "sales_invoice" })}>{i.no}</button> : i.no}</td>
                <td className="py-1.5 pr-2">{nameOf(i.partyId)}</td><td className="py-1.5 pr-2 text-right tabnum">{inr(i.total)}</td><td className="py-1.5 pr-2 text-right tabnum">{inr(i.collected)}</td><td className="py-1.5 text-right tabnum">{inr(i.outstanding)}</td>
              </tr>))}</tbody></table></div>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-4">Counts final tax invoices only. Drafts and proforma invoices are left out. Net sales is before GST; “Collected” is the money received against these invoices so far, including amounts adjusted by credit notes. Credit notes are not deducted from the salesperson’s sales. Click a salesperson to see their invoices.</p>
    </div>
  );
}
