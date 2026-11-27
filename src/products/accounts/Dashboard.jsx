import React, { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from "recharts";
import { inr, inputCls, BackHeader } from "../../shared";
import { computeLedgerBalances, groupInfo, round2, monthlySeries, expenseBreakdown, stockRegister, cashFlowStatement, ledgerMovements, searchAccounts, VOUCHER_LABELS } from "./calc";
import { PeriodBar, initialPeriod, periodLabel } from "./PeriodBar";
import LedgerView from "./LedgerView";

const PIE_COLORS = ["#111111", "#555555", "#888888", "#b5b5b5", "#c0392b", "#e88c8c", "#2b7fa8", "#3aa384"];
const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");
const sum = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

export default function Dashboard({ ledgers, items = [], lines, vouchers, voucherItems = [], business, onOpenVoucher, onNavigate }) {
  const [period, setPeriod] = useState(initialPeriod());
  const [detail, setDetail] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [query, setQuery] = useState("");
  const { from, to } = period;
  const asAt = to ? dmy(to) : "today";

  const lineDates = useMemo(() => Object.fromEntries(vouchers.map((v) => [v.id, v.vdate])), [vouchers]);
  const balance = useMemo(() => Object.fromEntries(computeLedgerBalances(ledgers, lines, to, lineDates).map((b) => [b.ledgerId, b.net])), [ledgers, lines, to, lineDates]);
  const ofGroup = (...keys) => ledgers.filter((l) => keys.includes(l.group_key));
  const rowsOf = (list, fn) => list.map((l) => ({ id: l.id, name: l.name, amount: round2(fn(balance[l.id] || 0)) })).filter((r) => Math.abs(r.amount) >= 0.005).sort((a, b) => b.amount - a.amount);
  const receivables = rowsOf(ofGroup("sundry_debtors"), (n) => Math.max(0, n));
  const payables = rowsOf(ofGroup("sundry_creditors"), (n) => Math.max(0, -n));
  const cash = rowsOf(ofGroup("cash_in_hand"), (n) => n);
  const bank = rowsOf(ofGroup("bank_accounts"), (n) => n);

  const stock = useMemo(() => stockRegister(items, voucherItems, vouchers, to), [items, voucherItems, vouchers, to]);
  const cf = useMemo(() => cashFlowStatement(ledgers, lines, vouchers, from, to), [ledgers, lines, vouchers, from, to]);

  const finalIn = (type) => vouchers.filter((v) => v.vtype === type && (v.meta?.status ?? "final") !== "draft" && (!from || v.vdate >= from) && (!to || v.vdate <= to));
  const partyRows = (list, notes = []) => {
    const by = {};
    const row = (id) => (by[id] = by[id] || { id, name: ledgers.find((l) => l.id === id)?.name || "—", amount: 0, count: 0 });
    for (const v of list) { const r = row(v.party_ledger_id); r.amount = round2(r.amount + (Number(v.subtotal) || 0)); r.count += 1; }
    for (const v of notes) { const r = row(v.party_ledger_id); r.amount = round2(r.amount - (Number(v.subtotal) || 0)); }   // credit / debit notes reduce it
    return Object.values(by).filter((r) => Math.abs(r.amount) > 0.004 || r.count).sort((a, b) => b.amount - a.amount);
  };
  const salesRows = useMemo(() => partyRows(finalIn("sales_invoice"), finalIn("credit_note")), [vouchers, ledgers, from, to]);
  const purchaseRows = useMemo(() => partyRows(finalIn("purchase_invoice"), finalIn("debit_note")), [vouchers, ledgers, from, to]);

  const mv = useMemo(() => ledgerMovements(lines, vouchers, from, to), [lines, vouchers, from, to]);
  const incomeRows = ledgers.filter((l) => groupInfo(l.group_key).nature === "income").map((l) => ({ id: l.id, name: l.name, amount: round2((mv[l.id]?.credit || 0) - (mv[l.id]?.debit || 0)) })).filter((r) => r.amount > 0.005).sort((a, b) => b.amount - a.amount);
  const expenseRows = useMemo(() => expenseBreakdown(ledgers, lines, vouchers, from, to).map((e) => ({ id: e.ledgerId, name: e.name, amount: e.amount })), [ledgers, lines, vouchers, from, to]);
  const profit = round2(sum(incomeRows) - sum(expenseRows));

  const monthly = useMemo(() => monthlySeries(ledgers, lines, vouchers, from, to), [ledgers, lines, vouchers, from, to]);
  const chartData = monthly.map((m) => ({ label: m.label, Income: m.income, Expenses: m.expense }));
  const pie = expenseRows.slice(0, 8);
  const pieTotal = sum(expenseRows);

  const results = useMemo(() => searchAccounts(query, { ledgers, items, vouchers }), [query, ledgers, items, vouchers]);
  const hasResults = results.ledgers.length + results.items.length + results.vouchers.length > 0;
  const openLedger = (id) => { const l = ledgers.find((x) => x.id === id); if (l) setViewing(l); };

  const boxes = [
    { label: "Receivables", value: sum(receivables), sub: `as at ${asAt}`, open: () => setDetail({ kind: "ledgers", title: "Receivables — customer-wise", note: `What customers owe you as at ${asAt}.`, rows: receivables }) },
    { label: "Payables", value: sum(payables), sub: `as at ${asAt}`, open: () => setDetail({ kind: "ledgers", title: "Payables — vendor-wise", note: `What you owe vendors as at ${asAt}.`, rows: payables }) },
    { label: "Cash balance", value: sum(cash), sub: `as at ${asAt}`, open: () => setDetail({ kind: "ledgers", title: "Cash balance", note: `As at ${asAt}.`, rows: cash }) },
    { label: "Bank balance", value: sum(bank), sub: `${bank.length} account${bank.length === 1 ? "" : "s"}`, open: () => setDetail({ kind: "ledgers", title: "Bank balance — account-wise", note: `As at ${asAt}.`, rows: bank }) },
    { label: "Inventory register", value: stock.totalValue, sub: `${stock.rows.length} stocked item${stock.rows.length === 1 ? "" : "s"}`, open: () => setDetail({ kind: "stock" }) },
    { label: "Cash flow", value: cf.net, sub: `In ${inr(cf.inflow)} · Out ${inr(cf.outflow)}`, open: () => setDetail({ kind: "cashflow" }) },
    { label: "Sales (before GST)", value: sum(salesRows), sub: `${salesRows.reduce((s, r) => s + r.count, 0)} invoice(s)`, open: () => setDetail({ kind: "ledgers", title: "Sales — customer-wise", note: `Final tax invoices, ${periodLabel(period)}.`, rows: salesRows }) },
    { label: "Purchases (before GST)", value: sum(purchaseRows), sub: `${purchaseRows.reduce((s, r) => s + r.count, 0)} bill(s)`, open: () => setDetail({ kind: "ledgers", title: "Purchases — vendor-wise", note: `Final purchase invoices, ${periodLabel(period)}.`, rows: purchaseRows }) },
    { label: "Profit for the period", value: profit, sub: `Income ${inr(sum(incomeRows))} − Expenses ${inr(sum(expenseRows))}`, open: () => setDetail({ kind: "profit" }) },
  ];

  if (viewing) return <LedgerView ledger={viewing} vouchers={vouchers} lines={lines} business={business} onBack={() => setViewing(null)} />;

  const LedgerRows = ({ rows }) => (
    <div className="space-y-1.5">
      {rows.length === 0 && <p className="text-sm text-gray-400">Nothing to show for this period.</p>}
      {rows.map((r) => (
        <button key={r.id} type="button" aria-label={`Open ledger ${r.name}`} onClick={() => openLedger(r.id)} className="w-full flex justify-between bg-gray-50 hover:bg-gray-100 rounded px-4 py-2.5 text-sm text-left">
          <span>{r.name}{r.count ? <span className="text-xs text-gray-400"> · {r.count} bill{r.count > 1 ? "s" : ""}</span> : null}</span><b className="tabnum">{inr(r.amount)}</b>
        </button>
      ))}
      <div className="flex justify-between px-4 pt-2 text-sm font-semibold border-t border-gray-200"><span>Total</span><span className="tabnum" aria-label="Detail total">{inr(sum(rows))}</span></div>
    </div>
  );

  if (detail) {
    const back = () => setDetail(null);
    if (detail.kind === "ledgers") return <div><BackHeader title={detail.title} onBack={back} />{detail.note && <p className="text-xs text-gray-500 mb-3">{detail.note} Click a name to see the full ledger.</p>}<LedgerRows rows={detail.rows} /></div>;
    if (detail.kind === "profit") return (
      <div><BackHeader title={`Profit — ${periodLabel(period)}`} onBack={back} />
        <div className="grid md:grid-cols-2 gap-6"><div><h3 className="font-display text-base mb-2">Income</h3><LedgerRows rows={incomeRows} /></div><div><h3 className="font-display text-base mb-2">Expenses</h3><LedgerRows rows={expenseRows} /></div></div>
        <div className="mt-4 flex justify-between bg-black text-white rounded px-4 py-3 text-sm font-semibold"><span>Profit</span><span className="tabnum" aria-label="Profit total">{inr(profit)}</span></div>
        <p className="text-[11px] text-gray-400 mt-2">Income minus expenses posted in this period. It does not include the change in closing stock.</p>
      </div>);
    if (detail.kind === "stock") return (
      <div><BackHeader title={`Inventory register — as at ${asAt}`} onBack={back} />
        {stock.rows.length === 0 ? <p className="text-sm text-gray-400">No product is set to “Affects inventory”. Tick it on a product to track its stock.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Inventory register"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Quantity</th><th className="py-2 pr-2 text-right">Average cost</th><th className="py-2 text-right">Value</th></tr></thead>
            <tbody>{stock.rows.map((r) => <tr key={r.itemId} className="border-b border-gray-100"><td className="py-2 pr-2">{r.name}{r.negative && <span className="ml-2 text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">sold more than in stock</span>}</td><td className="py-2 pr-2 text-right tabnum">{r.qty} {r.unit}</td><td className="py-2 pr-2 text-right tabnum">₹{fmt(r.avgCost)}</td><td className="py-2 text-right tabnum">₹{fmt(r.value)}</td></tr>)}</tbody>
            <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2" colSpan={3}>Total stock value</td><td className="py-2 text-right tabnum">₹{fmt(stock.totalValue)}</td></tr></tfoot></table></div>)}
        <p className="text-[11px] text-gray-400 mt-3">Worked out from your opening stock and final purchase and sales bills, at weighted average cost. It is a register for your information; it does not post to the books.</p>
      </div>);
    if (detail.kind === "cashflow") return (
      <div><BackHeader title={`Cash flow statement — ${periodLabel(period)}`} onBack={back} />
        <table className="w-full text-sm" aria-label="Cash flow statement"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2">&nbsp;</th><th className="py-2 text-right">Money in</th><th className="py-2 text-right">Money out</th></tr></thead>
          <tbody>
            <tr className="bg-gray-50 font-medium"><td className="py-2 px-2">Opening cash + bank</td><td /><td className="py-2 text-right tabnum" aria-label="Opening cash and bank">{inr(cf.opening)}</td></tr>
            {cf.sections.map((s) => (
              <React.Fragment key={s.name}>
                <tr><td className="pt-3 pb-1 font-display" colSpan={3}>{s.name} activities</td></tr>
                {s.rows.length === 0 && <tr><td className="py-1 px-2 text-gray-400 text-xs" colSpan={3}>None</td></tr>}
                {s.rows.map((r) => <tr key={r.label} className="border-b border-gray-100"><td className="py-1.5 px-2">{r.label}</td><td className="py-1.5 text-right tabnum">{r.inflow ? fmt(r.inflow) : ""}</td><td className="py-1.5 text-right tabnum">{r.outflow ? fmt(r.outflow) : ""}</td></tr>)}
                <tr className="text-xs text-gray-500"><td className="px-2 py-1">Net {s.name.toLowerCase()}</td><td colSpan={2} className="py-1 text-right tabnum">{inr(s.net)}</td></tr>
              </React.Fragment>))}
            <tr className="font-semibold border-t-2 border-black"><td className="py-2 px-2">Net change in cash + bank</td><td className="py-2 text-right tabnum">{fmt(cf.inflow)}</td><td className="py-2 text-right tabnum">{fmt(cf.outflow)}</td></tr>
            <tr className="bg-black text-white font-semibold"><td className="py-2 px-2">Closing cash + bank</td><td /><td className="py-2 text-right tabnum" aria-label="Closing cash and bank">{inr(cf.closing)}</td></tr>
          </tbody></table>
        <p className="text-[11px] text-gray-400 mt-3">Closing always equals your Cash and Bank balances for the same date. Moving money between cash and bank is not counted.</p>
      </div>);
  }

  return (
    <div>
      <div className="relative mb-4">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-gray-400" />
          <input aria-label="Search accounts" className={inputCls + " !pl-9"} placeholder="Search customers, vendors, invoices, products…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        {query.trim().length >= 2 && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto" aria-label="Search results">
            {!hasResults && <p className="text-xs text-gray-400 px-3 py-3">Nothing matches “{query.trim()}”.</p>}
            {results.ledgers.length > 0 && <div><p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-gray-400">Customers, vendors &amp; ledgers</p>
              {results.ledgers.map((l) => <button key={l.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setViewing(l); setQuery(""); }}>{l.name} <span className="text-xs text-gray-400">· {l.kind === "customer" ? "Customer" : l.kind === "vendor" ? "Vendor" : groupInfo(l.group_key).name}{l.mobile ? ` · ${l.mobile}` : ""}</span></button>)}</div>}
            {results.vouchers.length > 0 && <div><p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-gray-400">Bills &amp; vouchers</p>
              {results.vouchers.map((v) => <button key={v.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { onOpenVoucher?.(v); setQuery(""); }}>{v.voucher_no} <span className="text-xs text-gray-400">· {VOUCHER_LABELS[v.vtype] || v.vtype} · {ledgers.find((l) => l.id === v.party_ledger_id)?.name || "—"} · {inr(v.total)} · {dmy(v.vdate)}</span></button>)}</div>}
            {results.items.length > 0 && <div><p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-gray-400">Products</p>
              {results.items.map((i) => <button key={i.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { onNavigate?.("ledgers"); setQuery(""); }}>{i.name} <span className="text-xs text-gray-400">{i.item_code ? `· #${i.item_code}` : ""}</span></button>)}</div>}
          </div>)}
      </div>

      <div className="mb-4"><PeriodBar value={period} onChange={setPeriod} /></div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {boxes.map((b) => (
          <button key={b.label} type="button" aria-label={b.label} onClick={b.open} className="text-left bg-white rounded-lg p-4 border border-gray-200 hover:border-black transition-colors">
            <div className="text-[11px] text-gray-500 mb-1.5">{b.label}</div>
            <div className="font-display text-2xl tabnum" data-testid={`value-${b.label}`}>{inr(b.value)}</div>
            <div className="text-[10px] text-gray-400 mt-1">{b.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display text-base mb-3">Monthly Income vs Expenses</h3>
          {chartData.length === 0 ? <p className="text-sm text-gray-400">No transactions in this period.</p> : (
            <>
              <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Income" fill="#111111" radius={[3, 3, 0, 0]} /><Bar dataKey="Expenses" fill="#aaaaaa" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <table className="w-full text-xs mt-2" aria-label="Monthly summary"><thead><tr className="text-gray-400 text-left"><th className="py-1 font-medium">Month</th><th className="text-right font-medium">Income</th><th className="text-right font-medium">Expenses</th></tr></thead>
                <tbody>{monthly.map((m) => <tr key={m.month} className="border-t border-gray-100"><td className="py-1">{m.label}</td><td className="text-right tabnum">{inr(m.income)}</td><td className="text-right tabnum">{inr(m.expense)}</td></tr>)}</tbody></table>
            </>)}
        </div>
        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-display text-base">Expenses by ledger</h3>{expenseRows.length > 0 && <button type="button" onClick={() => setDetail({ kind: "ledgers", title: "Expenses — ledger-wise", note: `${periodLabel(period)}.`, rows: expenseRows })} className="text-xs text-blue-700 underline">View all</button>}</div>
          {pie.length === 0 ? <p className="text-sm text-gray-400">No expenses in this period.</p> : (
            <>
              <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie.map((p) => ({ ledgerId: p.id, name: p.name, value: p.amount }))} dataKey="value" nameKey="name" outerRadius={80} onClick={(d) => openLedger(d?.ledgerId ?? d?.payload?.ledgerId)}>{pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} cursor="pointer" />)}</Pie><Tooltip formatter={(v) => inr(v)} /></PieChart></ResponsiveContainer></div>
              <div className="space-y-1" aria-label="Expense ledgers">
                {pie.map((p, i) => <button key={p.id} type="button" aria-label={`Open ledger ${p.name}`} onClick={() => openLedger(p.id)} className="w-full flex items-center justify-between text-sm hover:bg-gray-50 rounded px-2 py-1"><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />{p.name}</span><span className="tabnum text-gray-600">{inr(p.amount)} <span className="text-xs text-gray-400">{pieTotal ? Math.round((p.amount / pieTotal) * 100) : 0}%</span></span></button>)}
              </div>
            </>)}
        </div>
      </div>
    </div>
  );
}
