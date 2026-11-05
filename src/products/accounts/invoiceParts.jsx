import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { todayISO, inr, inputCls, Field } from "../../shared";
import * as api from "./data";
import { buildSplitReceiptLines, round2, rankOptions } from "./calc";

/* ---------- a dropdown with search AND a "+ Create new" row ---------- */
export function CreatablePicker({ options, value, onChange, placeholder, createLabel, onCreate, showOnFocus = true, minChars = 0, maxResults = 30 }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const selected = options.find((o) => o.id === value);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = query.trim();
  // Type-ahead mode (showOnFocus=false): nothing is listed until you start typing, then only the best matches.
  const listing = q.length >= minChars && (q.length > 0 || showOnFocus);
  const matches = listing ? rankOptions(options, q, maxResults) : [];
  const choose = (o) => { onChange(o.id); setQuery(""); setOpen(false); setActive(0); };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && matches[active]) { e.preventDefault(); choose(matches[active]); } }
    else if (e.key === "Escape") { setOpen(false); }
  };
  const mark = (text) => {
    const first = q.split(/\s+/).filter(Boolean)[0];
    if (!first) return text;
    const i = String(text).toLowerCase().indexOf(first.toLowerCase());
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark className="bg-yellow-100 text-inherit rounded-sm">{text.slice(i, i + first.length)}</mark>{text.slice(i + first.length)}</>;
  };
  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className={inputCls + " flex items-center justify-between"}>
          <span className="truncate">{selected.label}{selected.sublabel ? ` · ${selected.sublabel}` : ""}</span>
          <button type="button" aria-label="Clear selection" onClick={() => { onChange(""); setQuery(""); }} className="text-gray-400 hover:text-black ml-2 shrink-0"><X size={15} /></button>
        </div>
      ) : (
        <input className={inputCls} placeholder={placeholder} value={query} autoComplete="off" onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }} />
      )}
      {open && !selected && listing && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {matches.length === 0 && <p className="text-xs text-gray-400 px-3 py-3">No matches.</p>}
          {matches.map((o, i) => (
            <button key={o.id} type="button" data-active={i === active ? "true" : "false"} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}
              className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 ${i === active ? "bg-blue-50" : "hover:bg-gray-50"}`}>
              <div className="font-medium">{mark(o.label)}</div>
              {o.sublabel && <div className="text-xs text-gray-400">{o.sublabel}</div>}
            </button>
          ))}
          {onCreate && (
            <button type="button" onClick={() => { setOpen(false); onCreate(query.trim()); setQuery(""); }} className="w-full text-left px-3 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 flex items-center gap-1.5 sticky bottom-0 bg-white border-t border-gray-200">
              <Plus size={14} /> {createLabel}{query.trim() ? ` "${query.trim()}"` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`bg-white rounded-xl p-5 w-full ${wide ? "max-w-xl" : "max-w-md"} max-h-[90vh] overflow-y-auto shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3"><h3 className="font-display text-lg">{title}</h3><button aria-label="Close" onClick={onClose} className="text-gray-400"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

/* ---------- bank account dropdown (with "+ New bank account") ---------- */
export function BankPicker({ ledgers, value, onChange, businessId, reload, showToast }) {
  const [creating, setCreating] = useState(null);
  const [name, setName] = useState(""); const [acct, setAcct] = useState("");
  const options = ledgers.filter((l) => l.group_key === "bank_accounts").map((l) => ({ id: l.id, label: l.name, sublabel: l.bank_details?.account_number ? `A/c ${l.bank_details.account_number}` : "" }));
  const save = async () => {
    if (!name.trim()) { showToast("Enter the bank account name."); return; }
    try {
      const id = await api.saveLedger({ id: null, business_id: businessId, kind: "other", name: name.trim(), group_key: "bank_accounts", bank_details: { account_number: acct.trim() }, opening_balance: 0, opening_side: "Dr" });
      await reload(); onChange(id); setCreating(null);
    } catch (e) { showToast(/duplicate|unique/i.test(e.message) ? "A ledger with this name already exists." : e.message); }
  };
  return (
    <>
      <CreatablePicker options={options} value={value} onChange={onChange} placeholder="Select bank account" createLabel="New bank account" onCreate={(q) => { setName(q); setAcct(""); setCreating(true); }} />
      {creating && (
        <Modal title="New bank account" onClose={() => setCreating(null)}>
          <div className="space-y-3">
            <Field label="Bank account name *"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC Current A/c" /></Field>
            <Field label="Account number (optional)"><input className={inputCls} value={acct} onChange={(e) => setAcct(e.target.value)} /></Field>
            <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save bank account</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- a received amount split across Cash and Bank ---------- */
let partKey = 0;
export const newPart = (mode = "cash") => ({ key: ++partKey, mode, ledgerId: "", amount: "" });
export const partsTotal = (parts) => round2(parts.reduce((s, p) => s + (Number(p.amount) || 0), 0));

/** [{mode, ledgerId, amount}] -> [{ledgerId, amount}] with Cash resolved to the Cash ledger. */
export function partsToLedgerParts(parts, cashLedgerId) {
  return parts.filter((p) => Number(p.amount) > 0).map((p) => ({ ledgerId: p.mode === "cash" ? cashLedgerId : p.ledgerId, amount: round2(p.amount), mode: p.mode }));
}
export function validateParts(parts, cashLedgerId, limit) {
  const used = parts.filter((p) => Number(p.amount) > 0);
  if (!used.length) return "Enter an amount to receive.";
  if (used.some((p) => p.mode === "cash" && !cashLedgerId)) return "The Cash ledger was not found. Please reload the page.";
  if (used.some((p) => p.mode === "bank" && !p.ledgerId)) return "Choose a bank account for every Bank amount.";
  if (used.some((p) => Number(p.amount) < 0)) return "Amounts cannot be negative.";
  if (limit !== undefined && partsTotal(used) > round2(limit) + 0.005) return `The amount received (${inr(partsTotal(used))}) is more than the outstanding balance (${inr(limit)}).`;
  return null;
}

/** Builds the receipt voucher + ledger lines for a payment against one invoice. */
export function buildReceiptForInvoice({ invoice, businessId, date, parts, cashLedgerId, voucherNo }) {
  const lp = partsToLedgerParts(parts, cashLedgerId);
  const lines = buildSplitReceiptLines({ partyLedgerId: invoice.party_ledger_id, parts: lp });
  const total = round2(lp.reduce((s, p) => s + p.amount, 0));
  const receiptVoucher = {
    business_id: businessId, vtype: "receipt", voucher_no: voucherNo, vdate: date, party_ledger_id: invoice.party_ledger_id,
    cash_bank_ledger_id: lp[0].ledgerId, narration: `Against invoice ${invoice.voucher_no}`, total,
    meta: { invoice_id: invoice.id, invoice_no: invoice.voucher_no, split: lp.map((p) => ({ mode: p.mode, ledger_id: p.ledgerId, amount: p.amount })) },
  };
  return { receiptVoucher, lines, total };
}

export function PaymentPartsEditor({ parts, setParts, ledgers, businessId, reload, showToast, outstanding }) {
  const setPart = (key, patch) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const total = partsTotal(parts);
  const fillBalance = () => {
    if (outstanding === undefined) return;
    const others = parts.slice(1).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    setParts((ps) => ps.map((p, i) => (i === 0 ? { ...p, amount: Math.max(0, round2(outstanding - others)) } : p)));
  };
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={p.key} className="grid grid-cols-12 gap-2 items-start">
          <select aria-label={`Payment mode ${i + 1}`} className={inputCls + " col-span-4"} value={p.mode} onChange={(e) => setPart(p.key, { mode: e.target.value, ledgerId: "" })}>
            <option value="cash">Cash</option><option value="bank">Bank</option>
          </select>
          <div className="col-span-8 sm:col-span-4">
            {p.mode === "bank" ? <BankPicker ledgers={ledgers} value={p.ledgerId} onChange={(id) => setPart(p.key, { ledgerId: id })} businessId={businessId} reload={reload} showToast={showToast} /> : <div className={inputCls + " bg-gray-50 text-gray-500"}>Cash in hand</div>}
          </div>
          <input aria-label={`Amount ${i + 1}`} type="number" min="0" className={inputCls + " col-span-9 sm:col-span-3 text-right"} placeholder="Amount" value={p.amount} onChange={(e) => setPart(p.key, { amount: e.target.value === "" ? "" : parseFloat(e.target.value) })} />
          <button type="button" aria-label={`Remove payment row ${i + 1}`} disabled={parts.length === 1} onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))} className="col-span-3 sm:col-span-1 pt-2 text-gray-300 hover:text-red-600 disabled:opacity-30 flex justify-end"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <div className="flex gap-3">
          <button type="button" onClick={() => setParts((ps) => [...ps, newPart(ps.some((x) => x.mode === "cash") ? "bank" : "cash")])} className="text-xs text-blue-700 font-medium flex items-center gap-1"><Plus size={12} /> Split with another mode</button>
          {outstanding !== undefined && <button type="button" onClick={fillBalance} className="text-xs text-blue-700 font-medium">Fill full balance</button>}
        </div>
        <div className="text-xs text-gray-500">Receiving now: <b className="text-black tabnum">{inr(total)}</b>{outstanding !== undefined && <> · Left after this: <b className="text-black tabnum">{inr(Math.max(0, round2(outstanding - total)))}</b></>}</div>
      </div>
    </div>
  );
}

/* ---------- payments received against a saved invoice ---------- */
export function PaymentsPanel({ invoice, vouchers, allocations, ledgers, businessId, reload, showToast, numbering }) {
  const cashLedgerId = ledgers.find((l) => l.system_key === "cash")?.id;
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "Bank";
  const mine = allocations.filter((a) => a.invoice_voucher_id === invoice.id)
    .map((a) => ({ alloc: a, v: vouchers.find((x) => x.id === a.source_voucher_id) })).filter((r) => r.v)
    .sort((a, b) => (a.v.vdate < b.v.vdate ? -1 : 1));
  const received = round2(mine.reduce((s, r) => s + Number(r.alloc.amount), 0));
  const outstanding = round2(invoice.total - received);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [parts, setParts] = useState([newPart("cash")]);
  const [saving, setSaving] = useState(false);

  const openModal = () => { setDate(todayISO()); setParts([newPart("cash")]); setOpen(true); };
  const save = async () => {
    const problem = validateParts(parts, cashLedgerId, outstanding);
    if (problem) { showToast(problem); return; }
    setSaving(true);
    try {
      const voucherNo = await api.nextVoucherNumber(businessId, "receipt", "RCT-", numbering, date);
      const { receiptVoucher, lines } = buildReceiptForInvoice({ invoice, businessId, date, parts, cashLedgerId, voucherNo });
      await api.recordInvoicePayment(invoice.id, receiptVoucher, lines);
      await reload(); setOpen(false); showToast("Payment recorded");
    } catch (e) { showToast(e.message); }
    finally { setSaving(false); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Delete receipt ${v.voucher_no}? The invoice's outstanding balance goes back up.`)) return;
    try { await api.deleteVoucher(v.id); await reload(); showToast("Receipt deleted"); } catch (e) { showToast(e.message); }
  };
  const modesOf = (v) => (Array.isArray(v.meta?.split) && v.meta.split.length
    ? v.meta.split.map((s) => `${s.mode === "cash" ? "Cash" : nameOf(s.ledger_id)} ${inr(s.amount)}`).join(" + ")
    : nameOf(v.cash_bank_ledger_id));

  return (
    <div className="border border-gray-200 rounded-lg p-4" aria-label="Payments received">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-base">Payments received</h3>
        {outstanding > 0.5 && <button type="button" onClick={openModal} className="bg-black text-white rounded px-3 py-1.5 text-sm font-medium flex items-center gap-1"><Plus size={14} /> Record payment</button>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm mb-3">
        <div className="bg-gray-50 rounded p-2"><div className="text-[11px] text-gray-500">Invoice total</div><div className="tabnum font-medium">{inr(invoice.total)}</div></div>
        <div className="bg-green-50 rounded p-2"><div className="text-[11px] text-green-700">Received</div><div className="tabnum font-medium">{inr(received)}</div></div>
        <div className={`${outstanding > 0.5 ? "bg-red-50" : "bg-green-50"} rounded p-2`}><div className={`text-[11px] ${outstanding > 0.5 ? "text-red-700" : "text-green-700"}`}>Outstanding</div><div className="tabnum font-medium">{inr(Math.max(0, outstanding))}</div></div>
      </div>
      {mine.length === 0 ? <p className="text-xs text-gray-400">No payments recorded yet.</p> : (
        <div className="space-y-1">
          {mine.map(({ alloc, v }) => (
            <div key={alloc.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2 gap-2">
              <div className="min-w-0"><div className="font-medium">{inr(alloc.amount)} <span className="text-xs text-gray-400 font-normal">· {v.vdate} · {v.voucher_no}</span></div><div className="text-xs text-gray-500 truncate">{modesOf(v)}</div></div>
              <button type="button" aria-label={`Delete receipt ${v.voucher_no}`} onClick={() => remove(v)} className="text-gray-300 hover:text-red-600 shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal title="Record payment received" onClose={() => setOpen(false)} wide>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Outstanding on {invoice.voucher_no}: <b className="tabnum">{inr(outstanding)}</b></p>
            <Field label="Payment date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <PaymentPartsEditor parts={parts} setParts={setParts} ledgers={ledgers} businessId={businessId} reload={reload} showToast={showToast} outstanding={outstanding} />
            <button disabled={saving} onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save payment"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
