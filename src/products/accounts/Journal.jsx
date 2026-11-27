import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import * as api from "./data";
import { todayISO, inr, inputCls, Field, BackHeader } from "../../shared";
import { CreatablePicker, Modal } from "./invoiceParts";
import { validateJournal, journalLines, groupInfo, round2 } from "./calc";

const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Picks ANY ledger: customers, vendors, expenses, banks and the built-in ones (Cash, GST, Round Off...). */
export function LedgerPicker({ ledgers, value, onChange, placeholder = "Select ledger", exclude = [] }) {
  const options = ledgers.filter((l) => !exclude.includes(l.id)).map((l) => ({
    id: l.id, label: l.name, keywords: [groupInfo(l.group_key).name, l.mobile, l.gstin].filter(Boolean).join(" "),
    sublabel: [l.kind === "customer" ? "Customer" : l.kind === "vendor" ? "Vendor" : groupInfo(l.group_key).name, l.mobile].filter(Boolean).join(" · "),
  })).sort((a, b) => a.label.localeCompare(b.label));
  return <CreatablePicker options={options} value={value} onChange={onChange} placeholder={placeholder} />;
}

/** Picks an expense ledger (rent, electricity...), and can create a new one on the spot. */
export function ExpenseLedgerPicker({ ledgers, value, onChange, businessId, reload, showToast }) {
  const [creating, setCreating] = useState(null);
  const [name, setName] = useState(""); const [group, setGroup] = useState("indirect_expenses");
  const options = ledgers.filter((l) => ["direct_expenses", "indirect_expenses"].includes(l.group_key) && !l.system_key).map((l) => ({ id: l.id, label: l.name, sublabel: groupInfo(l.group_key).name })).sort((a, b) => a.label.localeCompare(b.label));
  const save = async () => {
    if (!name.trim()) { showToast("Give the expense ledger a name."); return; }
    try { const id = await api.saveLedger({ id: null, business_id: businessId, kind: "other", name: name.trim(), group_key: group, opening_balance: 0, opening_side: "Dr" }); await reload(); onChange(id); setCreating(null); }
    catch (e) { showToast(/duplicate|unique/i.test(e.message) ? "A ledger with this name already exists." : e.message); }
  };
  return (
    <>
      <CreatablePicker options={options} value={value} onChange={onChange} placeholder="Choose the expense (e.g. Rent, Electricity)" createLabel="New expense ledger" onCreate={(q) => { setName(q); setGroup("indirect_expenses"); setCreating(true); }} />
      {creating && (
        <Modal title="New expense ledger" onClose={() => setCreating(null)}>
          <div className="space-y-3">
            <Field label="Name *"><input autoFocus aria-label="Expense ledger name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internet & Communication" /></Field>
            <Field label="Type"><select aria-label="Expense type" className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}><option value="indirect_expenses">Indirect expense (rent, salaries, office)</option><option value="direct_expenses">Direct expense (freight, labour on goods)</option></select></Field>
            <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save expense ledger</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function JournalForm({ businessId, ledgers, existing, existingLines, business, onCancel, onSaved, showToast }) {
  const settings = business?.settings || {};
  const keyRef = useRef(0);
  const blank = () => ({ key: ++keyRef.current, ledgerId: "", debit: "", credit: "", narration: "" });
  const [vdate, setVdate] = useState(existing?.vdate || todayISO());
  const [voucherNo, setVoucherNo] = useState(existing?.voucher_no || "");
  const [touched, setTouched] = useState(false);
  const [narration, setNarration] = useState(existing?.narration || "");
  const [rows, setRows] = useState(() => (existing ? existingLines.map((l) => ({ key: ++keyRef.current, ledgerId: l.ledger_id, debit: Number(l.debit) || "", credit: Number(l.credit) || "", narration: l.narration || "" })) : [blank(), blank()]));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing || touched) return;
    api.nextVoucherNumber(businessId, "journal", "JV-", settings.numbering?.journal, vdate).then(setVoucherNo).catch(() => {});
  }, [businessId, vdate, touched, existing]);

  const dr = round2(rows.reduce((s, r) => s + (Number(r.debit) || 0), 0));
  const cr = round2(rows.reduce((s, r) => s + (Number(r.credit) || 0), 0));
  const diff = round2(dr - cr);
  const problem = validateJournal(rows);
  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const onAmount = (key, side, raw) => setRow(key, side === "debit" ? { debit: raw === "" ? "" : parseFloat(raw), ...(raw === "" ? {} : { credit: "" }) } : { credit: raw === "" ? "" : parseFloat(raw), ...(raw === "" ? {} : { debit: "" }) });
  const balance = (key) => setRow(key, diff > 0 ? { credit: diff, debit: "" } : { debit: -diff, credit: "" });

  const save = async () => {
    if (!voucherNo.trim()) { showToast("Enter a voucher number."); return; }
    if (problem) { showToast(problem); return; }
    setSaving(true);
    try {
      const voucher = { id: existing?.id, business_id: businessId, vtype: "journal", voucher_no: voucherNo.trim(), vdate, narration, total: dr, meta: { ...(existing?.meta || {}) } };
      await api.saveVoucher(voucher, [], journalLines(rows));
      showToast("Journal entry saved"); onSaved();
    } catch (e) { showToast(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="pb-24 max-w-4xl">
      <BackHeader title={existing ? `Edit Journal ${existing.voucher_no}` : "New Journal Entry"} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Date"><input type="date" aria-label="Journal date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Journal entry no.">
            <input aria-label="Journal number" className={inputCls} value={voucherNo} onChange={(e) => { setVoucherNo(e.target.value); setTouched(true); }} />
            {!existing && touched && <button type="button" onClick={() => setTouched(false)} className="text-[11px] text-blue-700 mt-1">Use automatic number</button>}
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-200"><th className="py-2 pr-2 w-[40%]">LEDGER</th><th className="py-2 pr-2 text-right">DEBIT</th><th className="py-2 pr-2 text-right">CREDIT</th><th className="py-2 pr-2">LINE NOTE</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-2"><LedgerPicker ledgers={ledgers} value={r.ledgerId} onChange={(id) => setRow(r.key, { ledgerId: id })} placeholder="Select ledger" /></td>
                  <td className="py-1.5 pr-2"><input aria-label={`Debit ${i + 1}`} type="number" min="0" className={inputCls + " text-right"} value={r.debit ?? ""} onChange={(e) => onAmount(r.key, "debit", e.target.value)} /></td>
                  <td className="py-1.5 pr-2"><input aria-label={`Credit ${i + 1}`} type="number" min="0" className={inputCls + " text-right"} value={r.credit ?? ""} onChange={(e) => onAmount(r.key, "credit", e.target.value)} /></td>
                  <td className="py-1.5 pr-2"><input aria-label={`Line note ${i + 1}`} className={inputCls} value={r.narration} onChange={(e) => setRow(r.key, { narration: e.target.value })} /></td>
                  <td className="py-1.5 whitespace-nowrap">
                    {Math.abs(diff) > 0.005 && <button type="button" aria-label={`Balance on row ${i + 1}`} title="Put the difference on this line" onClick={() => balance(r.key)} className="text-[11px] text-blue-700 mr-2">= balance</button>}
                    <button type="button" aria-label={`Remove row ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-gray-300 hover:text-red-600 disabled:opacity-30"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 border-black"><td className="py-2">Total</td><td className="py-2 pr-2 text-right tabnum" aria-label="Total debit">{fmt(dr)}</td><td className="py-2 pr-2 text-right tabnum" aria-label="Total credit">{fmt(cr)}</td><td colSpan={2} className={`py-2 text-xs ${Math.abs(diff) < 0.005 && dr > 0 ? "text-green-700" : "text-red-700"}`} aria-label="Balance status">{Math.abs(diff) < 0.005 ? (dr > 0 ? "✓ Balanced" : "") : `Difference ${fmt(Math.abs(diff))} ${diff > 0 ? "(debits more)" : "(credits more)"}`}</td></tr>
            </tfoot>
          </table>
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-sm bg-blue-50 text-blue-700 font-medium rounded px-3 py-1.5 flex items-center gap-1"><Plus size={14} /> Add line</button>
        <Field label="Narration"><textarea aria-label="Journal narration" rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Why this entry is being made" /></Field>
      </div>
      <div className="fixed bottom-0 left-0 right-0 md:left-56 z-30 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2">
        <button disabled={saving || !!problem} onClick={save} className="bg-black text-white rounded px-5 py-2 text-sm font-medium disabled:opacity-40">{saving ? "Saving…" : "Save journal"}</button>
        <button onClick={onCancel} className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:border-black">Cancel</button>
        {problem && <span className="text-xs text-gray-500 ml-2" aria-label="Why it cannot be saved yet">{problem}</span>}
      </div>
    </div>
  );
}

export default function JournalScreen({ businessId, ledgers, vouchers, lines, business, reload, showToast }) {
  const [mode, setMode] = useState("list");
  const [editing, setEditing] = useState(null);
  const journals = vouchers.filter((v) => v.vtype === "journal");
  const totalOf = (v) => round2(lines.filter((l) => l.voucher_id === v.id).reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const remove = async (v) => {
    if (!window.confirm(`Delete journal ${v.voucher_no}? Its entries are removed from the books. This cannot be undone.`)) return;
    try { await api.deleteVoucher(v.id); await reload(); showToast("Deleted"); } catch (e) { showToast(e.message); }
  };
  const done = async () => { await reload(); setMode("list"); setEditing(null); };
  if (mode === "form") return <JournalForm key={editing?.id || "new"} businessId={businessId} ledgers={ledgers} existing={editing} existingLines={editing ? lines.filter((l) => l.voucher_id === editing.id) : []} business={business} onCancel={() => { setMode("list"); setEditing(null); }} onSaved={done} showToast={showToast} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-4"><h2 className="font-display text-xl">Journal Entries</h2><button onClick={() => { setEditing(null); setMode("form"); }} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> New Journal</button></div>
      {journals.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No journal entries yet. Use one for adjustments that are not a sale, purchase, receipt or payment.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">No.</th><th className="py-2 pr-2">Ledgers</th><th className="py-2 pr-2">Narration</th><th className="py-2 pr-2 text-right">Amount</th><th /></tr></thead>
          <tbody>{journals.map((v) => (
            <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => { setEditing(v); setMode("form"); }}>
              <td className="py-2.5 pr-2 whitespace-nowrap">{v.vdate}</td><td className="py-2.5 pr-2">{v.voucher_no}</td>
              <td className="py-2.5 pr-2 text-xs text-gray-600">{[...new Set(lines.filter((l) => l.voucher_id === v.id).map((l) => nameOf(l.ledger_id)))].join(", ")}</td>
              <td className="py-2.5 pr-2 text-gray-500">{v.narration}</td><td className="py-2.5 pr-2 text-right tabnum">{inr(totalOf(v))}</td>
              <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}><button aria-label={`Delete ${v.voucher_no}`} onClick={() => remove(v)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
