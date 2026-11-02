import React, { useState, useEffect } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { inputCls, Field } from "../../shared";
import * as api from "./data";
import { slugKey, validateFormula, PAPER_SIZES, normalizeNumbering, formatVoucherNo, gstNumberProblem } from "./calc";

const RESERVED_LINE = ["qty", "rate", "amount"];
const RESERVED_HEADER = ["gross", "taxable", "tax", "total", "qty"];
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const TYPE_LABEL = { text: "Text", number: "Number", calculated: "Calculated" };
const TAX_LABEL = { percent: "% of taxable value", fixed_invoice: "Fixed amount per invoice", fixed_unit: "Fixed amount per unit" };

export default function SettingsScreen({ business, businessId, showToast, reloadBusinesses }) {
  const [tab, setTab] = useState("format");
  const settings = business?.settings || {};
  const saveSettings = async (patch, msg = "Saved") => {
    try { await api.updateBusinessSettings(businessId, patch); await reloadBusinesses(); showToast(msg); return true; }
    catch (e) { showToast(e.message); return false; }
  };
  const tabs = [["format", "Bill format"], ["fields", "Invoice fields"], ["taxes", "Other taxes"], ["adjust", "Charges & discounts"], ["terms", "Terms & notes"]];
  return (
    <div className="max-w-3xl">
      <h2 className="font-display text-xl mb-1">Invoice Settings</h2>
      <p className="text-xs text-gray-500 mb-4">Set these up once. Every new invoice then uses them. Nothing here needs any change to the software.</p>
      <div className="flex gap-4 border-b border-gray-200 mb-5 text-sm overflow-x-auto">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`pb-2.5 whitespace-nowrap ${tab === k ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>{l}</button>)}
      </div>
      {tab === "format" && <BillFormatTab settings={settings} save={(p) => saveSettings(p)} />}
      {tab === "fields" && <FieldsTab fields={settings.invoice_fields || []} save={(f) => saveSettings({ invoice_fields: f })} showToast={showToast} />}
      {tab === "taxes" && <TaxesTab businessId={businessId} showToast={showToast} />}
      {tab === "adjust" && <AdjustTab presets={settings.adjustment_presets || []} save={(p) => saveSettings({ adjustment_presets: p })} />}
      {tab === "terms" && <TermsTab settings={settings} save={(p) => saveSettings(p)} />}
    </div>
  );
}

/* ---------------- custom fields ---------------- */
function FieldsTab({ fields, save, showToast }) {
  const [editing, setEditing] = useState(null);
  const blank = () => ({ id: newId(), key: "", label: "", type: "text", scope: "header", formula: "", defaultValue: "", showOnPrint: true, isNew: true });

  const variablesFor = (f) => {
    const others = fields.filter((x) => x.id !== f.id && x.scope === f.scope && (x.type === "number" || x.type === "calculated")).map((x) => x.key);
    return [...(f.scope === "line" ? RESERVED_LINE : RESERVED_HEADER), ...others];
  };
  const submit = async () => {
    const label = editing.label.trim();
    if (!label) { showToast("Give the field a name."); return; }
    let key = editing.key;
    if (editing.isNew) {
      const taken = new Set([...fields.map((x) => x.key), ...RESERVED_LINE, ...RESERVED_HEADER]);
      const base = slugKey(label); key = base; let n = 2;
      while (taken.has(key)) key = `${base}_${n++}`;
    }
    if (editing.type === "calculated") {
      const problem = validateFormula(editing.formula, variablesFor({ ...editing, key }));
      if (problem) { showToast(`Formula problem: ${problem}`); return; }
    }
    const clean = { id: editing.id, key, label, type: editing.type, scope: editing.scope, showOnPrint: editing.showOnPrint,
      ...(editing.type === "calculated" ? { formula: editing.formula.trim() } : { defaultValue: editing.defaultValue ?? "" }) };
    const next = editing.isNew ? [...fields, clean] : fields.map((x) => (x.id === clean.id ? clean : x));
    if (await save(next)) setEditing(null);
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove the field "${f.label}"? Invoices already saved keep what was entered.`)) return;
    await save(fields.filter((x) => x.id !== f.id));
  };

  if (editing) {
    const vars = variablesFor(editing);
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h3 className="font-display text-lg">{editing.isNew ? "New field" : "Edit field"}</h3>
        <Field label="Field name (what you see on the invoice) *"><input autoFocus aria-label="Field name" className={inputCls} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. Vehicle Number" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select aria-label="Field type" className={inputCls} value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              <option value="text">Text (descriptions, references, instructions)</option><option value="number">Number (quantities, measurements, amounts)</option><option value="calculated">Calculated (worked out from other fields)</option>
            </select>
          </Field>
          <Field label="Where it appears">
            <select aria-label="Field scope" className={inputCls} value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
              <option value="header">Once on the invoice</option><option value="line">On every item row</option>
            </select>
          </Field>
        </div>
        {editing.type === "calculated" ? (
          <div>
            <Field label="Formula"><input aria-label="Formula" className={inputCls} value={editing.formula} onChange={(e) => setEditing({ ...editing, formula: e.target.value })} placeholder={editing.scope === "line" ? "e.g. weight * making_rate" : "e.g. taxable * 2%"} /></Field>
            <p className="text-[11px] text-gray-500 mt-1">Use + − × ÷ ( ) and %. You can use: {vars.map((v) => <code key={v} className="bg-gray-100 rounded px-1 mx-0.5">{v}</code>)}</p>
            <p className="text-[11px] text-gray-400 mt-1">A calculated field is shown on the invoice for information. It does not change the invoice total (use Charges &amp; discounts for that).</p>
          </div>
        ) : (
          <Field label="Default value (optional)"><input aria-label="Default value" type={editing.type === "number" ? "number" : "text"} className={inputCls} value={editing.defaultValue ?? ""} onChange={(e) => setEditing({ ...editing, defaultValue: e.target.value })} /></Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.showOnPrint} onChange={(e) => setEditing({ ...editing, showOnPrint: e.target.checked })} /> Show on the printed / shared invoice</label>
        <div className="flex gap-2">
          <button onClick={submit} className="bg-black text-white rounded px-5 py-2 text-sm font-medium">Save field</button>
          <button onClick={() => setEditing(null)} className="border border-gray-300 rounded px-5 py-2 text-sm">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-3"><p className="text-sm text-gray-500">Extra fields you want on your invoices.</p><button onClick={() => setEditing(blank())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Add field</button></div>
      {fields.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">No extra fields yet. Example: add “Vehicle Number” as a Text field.</p> : (
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm">{f.label}</div>
                <div className="text-xs text-gray-500">{TYPE_LABEL[f.type]} · {f.scope === "line" ? "every item row" : "once per invoice"}{f.type === "calculated" ? ` · = ${f.formula}` : ""}{f.showOnPrint === false ? " · not printed" : ""}</div>
              </div>
              <div className="flex gap-3 shrink-0"><button aria-label={`Edit ${f.label}`} onClick={() => setEditing({ ...f })}><Pencil size={14} className="text-gray-400" /></button><button aria-label={`Remove ${f.label}`} onClick={() => remove(f)}><Trash2 size={14} className="text-gray-400" /></button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- other taxes master ---------------- */
function TaxesTab({ businessId, showToast }) {
  const [taxes, setTaxes] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = async () => { try { setTaxes(await api.fetchOtherTaxes(businessId)); } catch (e) { showToast(e.message); setTaxes([]); } };
  useEffect(() => { load(); }, [businessId]);
  const blank = () => ({ id: null, name: "", calc_type: "percent", value: "", applies_to: "both", active: true });
  const submit = async () => {
    if (!editing.name.trim()) { showToast("Give the tax a name."); return; }
    if (!(Number(editing.value) > 0)) { showToast("Enter the rate or amount."); return; }
    try {
      await api.saveOtherTax({ id: editing.id, business_id: businessId, name: editing.name.trim(), calc_type: editing.calc_type, value: Number(editing.value), applies_to: editing.applies_to, active: editing.active });
      await load(); setEditing(null); showToast("Saved");
    } catch (e) { showToast(/duplicate|unique/i.test(e.message) ? "A tax with this name already exists." : e.message); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? Invoices already made keep the tax they used.`)) return;
    try { await api.deleteOtherTax(t.id); await load(); } catch (e) { showToast(e.message); }
  };
  if (editing) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h3 className="font-display text-lg">{editing.id ? "Edit tax" : "New tax"}</h3>
        <Field label="Tax name *"><input autoFocus aria-label="Tax name" className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Cess, TCS, Loading charge" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How it is calculated">
            <select aria-label="Calculation method" className={inputCls} value={editing.calc_type} onChange={(e) => setEditing({ ...editing, calc_type: e.target.value })}>
              {Object.entries(TAX_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label={editing.calc_type === "percent" ? "Rate (%)" : "Amount (₹)"}><input aria-label="Tax value" type="number" min="0" className={inputCls} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Applies to"><select aria-label="Applies to" className={inputCls} value={editing.applies_to} onChange={(e) => setEditing({ ...editing, applies_to: e.target.value })}><option value="both">Sales and purchases</option><option value="sales">Sales only</option><option value="purchase">Purchases only</option></select></Field>
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active (shown in the invoice dropdown)</label>
        </div>
        <div className="flex gap-2"><button onClick={submit} className="bg-black text-white rounded px-5 py-2 text-sm font-medium">Save tax</button><button onClick={() => setEditing(null)} className="border border-gray-300 rounded px-5 py-2 text-sm">Cancel</button></div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-3"><p className="text-sm text-gray-500">Taxes you can pick from on any invoice.</p><button onClick={() => setEditing(blank())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Add tax</button></div>
      {taxes === null ? <p className="text-sm text-gray-400">Loading…</p> : taxes.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">No other taxes yet.</p> : (
        <div className="space-y-2">
          {taxes.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div><div className="font-medium text-sm">{t.name}{!t.active && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">inactive</span>}</div>
                <div className="text-xs text-gray-500">{t.calc_type === "percent" ? `${t.value}%` : `₹${t.value}`} · {TAX_LABEL[t.calc_type]} · {t.applies_to === "both" ? "sales & purchases" : `${t.applies_to} only`}</div></div>
              <div className="flex gap-3"><button aria-label={`Edit ${t.name}`} onClick={() => setEditing({ ...t })}><Pencil size={14} className="text-gray-400" /></button><button aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 size={14} className="text-gray-400" /></button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- additional charges & discounts ---------------- */
function AdjustTab({ presets, save }) {
  const [editing, setEditing] = useState(null);
  const blank = () => ({ id: newId(), name: "", kind: "charge", mode: "fixed", value: "", gstRate: 0, autoApply: false, isNew: true });
  const submit = async () => {
    if (!editing.name.trim()) return;
    const clean = { id: editing.id, name: editing.name.trim(), kind: editing.kind, mode: editing.mode, value: Number(editing.value) || 0, gstRate: editing.kind === "charge" ? Number(editing.gstRate) || 0 : 0, autoApply: !!editing.autoApply };
    const next = editing.isNew ? [...presets, clean] : presets.map((p) => (p.id === clean.id ? clean : p));
    if (await save(next)) setEditing(null);
  };
  if (editing) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h3 className="font-display text-lg">{editing.isNew ? "New charge or discount" : "Edit"}</h3>
        <Field label="Name *"><input autoFocus aria-label="Preset name" className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Freight, Packing, Cash discount" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Kind"><select aria-label="Preset kind" className={inputCls} value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}><option value="charge">Charge (adds)</option><option value="discount">Discount (reduces)</option></select></Field>
          <Field label="Method"><select aria-label="Preset method" className={inputCls} value={editing.mode} onChange={(e) => setEditing({ ...editing, mode: e.target.value })}><option value="fixed">Fixed ₹</option><option value="percent">Percent %</option></select></Field>
          <Field label="Usual value"><input aria-label="Preset value" type="number" min="0" className={inputCls} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
        </div>
        {editing.kind === "charge" && <Field label="GST % charged on this (0 if none)"><input aria-label="Preset GST" type="number" min="0" className={inputCls} value={editing.gstRate} onChange={(e) => setEditing({ ...editing, gstRate: e.target.value })} /></Field>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.autoApply} onChange={(e) => setEditing({ ...editing, autoApply: e.target.checked })} /> Add automatically to every new invoice (you can still change or remove it on the invoice)</label>
        <div className="flex gap-2"><button onClick={submit} className="bg-black text-white rounded px-5 py-2 text-sm font-medium">Save</button><button onClick={() => setEditing(null)} className="border border-gray-300 rounded px-5 py-2 text-sm">Cancel</button></div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-3"><p className="text-sm text-gray-500">Ready-made charges and discounts for quick use on invoices. The invoice total updates automatically.</p><button onClick={() => setEditing(blank())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 shrink-0"><Plus size={15} /> Add</button></div>
      {presets.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">None yet. You can still add one-off charges and discounts on any invoice.</p> : (
        <div className="space-y-2">
          {presets.map((p) => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div><div className="font-medium text-sm">{p.name} <span className={`text-[10px] px-1.5 py-0.5 rounded ml-1 ${p.kind === "charge" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{p.kind}</span>{p.autoApply && <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded ml-1">auto</span>}</div>
                <div className="text-xs text-gray-500">{p.mode === "percent" ? `${p.value}%` : `₹${p.value}`}{p.kind === "charge" && p.gstRate ? ` · GST ${p.gstRate}%` : ""}</div></div>
              <div className="flex gap-3"><button aria-label={`Edit ${p.name}`} onClick={() => setEditing({ ...p })}><Pencil size={14} className="text-gray-400" /></button><button aria-label={`Remove ${p.name}`} onClick={() => { if (window.confirm(`Remove "${p.name}"?`)) save(presets.filter((x) => x.id !== p.id)); }}><Trash2 size={14} className="text-gray-400" /></button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- default terms & notes ---------------- */
function TermsTab({ settings, save }) {
  const [terms, setTerms] = useState(settings.default_terms || "");
  const [notes, setNotes] = useState(settings.default_notes || "");
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <Field label="Default Terms & Conditions"><textarea aria-label="Default terms" rows={5} className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Printed on every new invoice. You can edit them on any single invoice without changing this default." /></Field>
      <Field label="Default Customer Notes / Remarks"><textarea aria-label="Default notes" rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Thanks for your business." /></Field>
      <button onClick={() => save({ default_terms: terms, default_notes: notes })} className="bg-black text-white rounded px-5 py-2 text-sm font-medium">Save</button>
      <p className="text-[11px] text-gray-400">These fill in automatically on each new invoice. Changing them here does not alter invoices you have already made.</p>
    </div>
  );
}


/* ---------------- bill format: paper size, numbering, bank details ---------------- */
const NUMBER_TYPES = [
  ["sales_invoice", "Tax invoice", "INV-"], ["proforma_invoice", "Proforma invoice", "PF-"], ["receipt", "Receipt", "RCT-"], ["payment", "Payment", "PMT-"],
  ["purchase_invoice", "Purchase invoice", "PUR-"], ["expense", "Expense", "EXP-"], ["debit_note", "Debit note", "DN-"], ["other_income", "Other income", "OI-"],
];
function BillFormatTab({ settings, save }) {
  const [paper, setPaper] = useState(settings.paper_size || "a4");
  const [numbering, setNumbering] = useState(() => Object.fromEntries(NUMBER_TYPES.map(([k, , d]) => [k, normalizeNumbering(settings.numbering?.[k], d)])));
  const [bank, setBank] = useState({ account_name: "", bank_name: "", account_number: "", ifsc: "", branch: "", upi: "", ...(settings.invoice_bank || {}) });
  const today = new Date().toISOString().slice(0, 10);
  const setNum = (k, patch) => setNumbering((n) => ({ ...n, [k]: { ...n[k], ...patch } }));
  const bankField = (key, label, ph) => <Field label={label}><input aria-label={label} className={inputCls} value={bank[key] || ""} placeholder={ph} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} /></Field>;
  const submit = () => save({ paper_size: paper, numbering: Object.fromEntries(NUMBER_TYPES.map(([k, , d]) => [k, normalizeNumbering(numbering[k], d)])), invoice_bank: bank });
  const P = PAPER_SIZES[paper];
  return (
    <div className="space-y-6">
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-lg">Bill size</h3>
        <Field label="Paper size for this company's bills">
          <select aria-label="Bill size" className={inputCls} value={paper} onChange={(e) => setPaper(e.target.value)}>
            {Object.entries(PAPER_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <p className="text-[11px] text-gray-500">{P.layout === "receipt" ? "Narrow receipt layout: one item per line, no wide columns." : P.layout === "compact" ? "Compact layout with smaller text so everything fits the small page." : "Full layout with all columns. Text size is scaled for the chosen page."} When you print or Save as PDF, choose “Paper size: {P.page.replace(" auto", "")}” if your printer dialog does not pick it up by itself.</p>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-lg">Bill numbering</h3>
        <p className="text-[11px] text-gray-500">Number = Prefix + running number + Suffix. Put <code className="bg-gray-100 px-1 rounded">{"{FY}"}</code> in the prefix or suffix to include the financial year (e.g. <code className="bg-gray-100 px-1 rounded">{"SJ/{FY}/"}</code> gives SJ/{formatVoucherNo({ prefix: "", suffix: "" }, 0, today) && ""}26-27/0001); numbering then starts again from 1 every April. You can always type a different number on a bill.</p>
        <div className="space-y-3">
          {NUMBER_TYPES.map(([k, label, d]) => {
            const c = numbering[k];
            const preview = formatVoucherNo(c, c.start, today);
            const problem = k === "sales_invoice" ? gstNumberProblem(preview) : null;
            return (
              <div key={k} className="border border-gray-100 rounded p-3">
                <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium">{label}</span><span aria-label={`${label} preview`} className="text-xs text-gray-500">Example: <b className="text-black">{preview}</b></span></div>
                <div className="grid grid-cols-4 gap-2">
                  <input aria-label={`${label} prefix`} className={inputCls} placeholder="Prefix" value={c.prefix} onChange={(e) => setNum(k, { prefix: e.target.value })} />
                  <input aria-label={`${label} suffix`} className={inputCls} placeholder="Suffix" value={c.suffix} onChange={(e) => setNum(k, { suffix: e.target.value })} />
                  <input aria-label={`${label} start`} type="number" min="1" className={inputCls} title="Start from" value={c.start} onChange={(e) => setNum(k, { start: e.target.value })} />
                  <input aria-label={`${label} digits`} type="number" min="1" max="10" className={inputCls} title="Digits" value={c.pad} onChange={(e) => setNum(k, { pad: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-400 mt-0.5"><span>Prefix</span><span>Suffix</span><span>Start from</span><span>Digits</span></div>
                {problem && <p className="text-[11px] text-amber-700 mt-1">{problem}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-lg">Bank details on the bill</h3>
        <p className="text-[11px] text-gray-500">Printed on every bill so customers know where to pay. You can switch it off on any single bill. Leave everything blank to print nothing.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {bankField("account_name", "Account name", "e.g. Sangam Jewellers")}
          {bankField("bank_name", "Bank name", "e.g. HDFC Bank")}
          {bankField("account_number", "Account number", "")}
          {bankField("ifsc", "IFSC code", "")}
          {bankField("branch", "Branch", "")}
          {bankField("upi", "UPI ID (optional)", "name@bank")}
        </div>
      </section>
      <button onClick={submit} className="bg-black text-white rounded px-6 py-2.5 text-sm font-medium">Save bill format</button>
    </div>
  );
}
