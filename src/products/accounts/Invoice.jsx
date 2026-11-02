import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, X, ChevronDown, Paperclip, ScanLine } from "lucide-react";
import { todayISO, inr, inputCls, Field, BackHeader } from "../../shared";
import * as api from "./data";
import { computeInvoiceTotals, buildSalesInvoiceLines, detectSupplyType, INDIAN_STATES, amountInWords, round2, rateFromTotal, ledgerBalanceOf, computeCalculatedFields, gstSummaryByRate, safeFileName, gstNumberProblem, PAPER_SIZES } from "./calc";
import { CreatablePicker, Modal, PaymentPartsEditor, PaymentsPanel, newPart, partsTotal, validateParts, buildReceiptForInvoice } from "./invoiceParts";

const fmtDate = (s) => (s ? s.split("-").reverse().join("-") : "");
const addDays = (dateStr, n) => { const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => "₹" + fmt(n);
const rd4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sysMap = (ledgers) => { const m = {}; ledgers.filter((l) => l.system_key).forEach((l) => { m[l.system_key] = l.id; }); return m; };
const addressOf = (o) => [o?.office_no, o?.building_name, o?.street_name, o?.city, o?.state, o?.pin_code].filter(Boolean).join(", ");

/* ---------- a dropdown with search AND a "+ Create new" row ---------- */




/* ---------- create a customer / vendor without leaving the page ---------- */
export function QuickPartyCreate({ kind, businessId, initialName, onCreated, onCancel, showToast }) {
  const [f, setF] = useState({ name: initialName || "", mobile: "", email: "", state: "", gst_type: "unregistered", gstin: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim() || !f.mobile.trim()) { showToast("Name and mobile are required."); return; }
    setSaving(true);
    try {
      const id = await api.saveLedger({ id: null, business_id: businessId, kind, name: f.name.trim(), mobile: f.mobile.trim(), email: f.email.trim() || null,
        state: f.state || null, country: "India", gst_type: f.gst_type, gstin: f.gstin.trim() || null,
        group_key: kind === "customer" ? "sundry_debtors" : "sundry_creditors", opening_balance: 0, opening_side: "Dr" });
      onCreated(id);
    } catch (e) {
      showToast(/duplicate|unique/i.test(e.message) ? `That mobile number is already used by another ${kind} in this business.` : e.message);
    } finally { setSaving(false); }
  };
  return (
    <Modal title={`New ${kind}`} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="Name / company *"><input autoFocus className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile *"><input className={inputCls} value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <Field label="State (decides IGST or CGST+SGST)">
          <select className={inputCls} value={f.state} onChange={(e) => set("state", e.target.value)}>
            <option value="">Select state…</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST status"><select className={inputCls} value={f.gst_type} onChange={(e) => set("gst_type", e.target.value)}><option value="unregistered">Unregistered</option><option value="registered">Registered</option><option value="consumer">Consumer</option></select></Field>
          <Field label="GSTIN"><input className={inputCls} value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
        </div>
        <p className="text-[11px] text-gray-400">A GSTIN's first two digits also tell us the state. You can add the address and more details later under Ledgers.</p>
        <button disabled={saving} onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : `Save ${kind}`}</button>
      </div>
    </Modal>
  );
}

export function PartyPicker({ kind, ledgers, value, onChange, businessId, reload, showToast, allowAll, placeholder }) {
  const [creating, setCreating] = useState(null);
  const options = ledgers.filter((l) => (allowAll ? !l.system_key : l.kind === kind)).map((l) => ({ id: l.id, label: l.name, sublabel: l.mobile || (allowAll ? l.kind : "") }));
  return (
    <>
      <CreatablePicker options={options} value={value} onChange={onChange} placeholder={placeholder || `Search ${kind} by name or mobile…`} createLabel={`New ${kind}`} onCreate={(q) => setCreating(q)} />
      {creating !== null && (
        <QuickPartyCreate kind={kind} businessId={businessId} initialName={creating} showToast={showToast} onCancel={() => setCreating(null)}
          onCreated={async (id) => { await reload(); onChange(id); setCreating(null); showToast(`${kind === "customer" ? "Customer" : "Vendor"} created`); }} />
      )}
    </>
  );
}

function SalespersonPicker({ businessId, value, onChange, showToast }) {
  const [list, setList] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""); const [mobile, setMobile] = useState("");
  const load = async () => { try { setList(await api.fetchSalespersons(businessId)); } catch (e) { /* ignore */ } };
  useEffect(() => { load(); }, [businessId]);
  const save = async () => {
    if (!name.trim()) return;
    try { const id = await api.saveSalesperson({ id: null, business_id: businessId, name: name.trim(), mobile: mobile.trim() || null }); await load(); onChange(id); setCreating(false); }
    catch (e) { showToast(/duplicate|unique/i.test(e.message) ? "A salesperson with this name already exists." : e.message); }
  };
  return (
    <>
      <CreatablePicker options={list.map((s) => ({ id: s.id, label: s.name, sublabel: s.mobile || "" }))} value={value} onChange={onChange}
        placeholder="Select or search salesperson…" createLabel="New salesperson" onCreate={(q) => { setName(q); setMobile(""); setCreating(true); }} />
      {creating && (
        <Modal title="New salesperson" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <Field label="Name *"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Mobile (optional)"><input className={inputCls} value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
            <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save salesperson</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- printable invoice ---------- */
export function invoiceHtml({ business, party, vtype, voucherNo, vdate, dueDate, poNumber, totals, supply, notes, termsText, headerFields = [], lineColumns = [], salespersonName, gstOn, paper = "a4", fileName, bank = null }) {
  // The customer's outstanding balance is intentionally NOT an input here: it is for on-screen viewing only
  // and must never be printed or shared.
  const P = PAPER_SIZES[paper] || PAPER_SIZES.a4;
  const layout = P.layout;
  const title = vtype === "proforma_invoice" ? "PROFORMA INVOICE" : "TAX INVOICE";
  const attrsOf = (l) => (l.attrs || []).map((a) => `${esc(a.label)}: ${esc(a.value)}`).join(" · ");
  const customOf = (l) => lineColumns.map((c) => (l.colValues?.[c.key] !== undefined && l.colValues?.[c.key] !== "" && l.colValues?.[c.key] !== null ? `${esc(c.label)}: ${esc(l.colValues[c.key])}` : "")).filter(Boolean).join(" · ");
  const descCell = (l, withCustom) => `${esc(l.description)}${attrsOf(l) ? `<div class="attr">${attrsOf(l)}</div>` : ""}${withCustom && customOf(l) ? `<div class="attr">${customOf(l)}</div>` : ""}`;

  let itemsHtml;
  if (layout === "receipt") {
    itemsHtml = `<div class="items">${totals.lines.map((l, i) => `<div class="it"><div>${i + 1}. ${descCell(l, true)}</div><div class="row"><span>${l.qty} × ${money(l.rate)}</span><span>${money(l.amount)}</span></div></div>`).join("")}</div>`;
  } else if (layout === "compact") {
    itemsHtml = `<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${totals.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${descCell(l, true)}${l.hsn_sac ? `<div class="attr">HSN: ${esc(l.hsn_sac)}</div>` : ""}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join("")}</tbody></table>`;
  } else {
    const colHead = lineColumns.map((c) => `<th class="r">${esc(c.label)}</th>`).join("");
    itemsHtml = `<table><thead><tr><th>#</th><th>Item &amp; Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th>${colHead}${gstOn ? '<th class="r">GST</th>' : ""}<th class="r">Amount</th></tr></thead><tbody>${totals.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${descCell(l, false)}</td><td>${esc(l.hsn_sac)}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td>${lineColumns.map((c) => `<td class="r">${esc(l.colValues?.[c.key] ?? "")}</td>`).join("")}${gstOn ? `<td class="r">${l.gstRate || 0}%</td>` : ""}<td class="r">${money(l.amount)}</td></tr>`).join("")}</tbody></table>`;
  }

  const chargeRows = (totals.chargeBreakdown || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="r">+ ${money(c.amount)}</td></tr>`).join("");
  const taxRows = gstOn ? (supply.type === "inter"
    ? `<tr><td>IGST</td><td class="r">${money(totals.igst)}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${money(totals.cgst)}</td></tr><tr><td>SGST</td><td class="r">${money(totals.sgst)}</td></tr>`) : "";
  const otherRows = totals.otherTaxSummary.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${money(t.amount)}</td></tr>`).join("");

  // GST table: one row per GST rate
  const gs = gstOn ? gstSummaryByRate(totals) : null;
  const inter = supply.type === "inter";
  const gstTable = gs && gs.hasTax ? `<table class="gst"><thead><tr><th>GST rate</th><th class="r">Taxable value</th>${inter ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}<th class="r">Total tax</th></tr></thead><tbody>${gs.rows.map((r) => `<tr><td>${r.rate}%</td><td class="r">${money(r.taxable)}</td>${inter ? `<td class="r">${money(r.igst)}</td>` : `<td class="r">${money(r.cgst)}</td><td class="r">${money(r.sgst)}</td>`}<td class="r">${money(r.tax)}</td></tr>`).join("")}<tr class="b"><td>Total</td><td class="r">${money(gs.total.taxable)}</td>${inter ? `<td class="r">${money(gs.total.igst)}</td>` : `<td class="r">${money(gs.total.cgst)}</td><td class="r">${money(gs.total.sgst)}</td>`}<td class="r">${money(gs.total.tax)}</td></tr></tbody></table>` : "";

  const bankLines = bank ? [["Account name", bank.account_name], ["Bank", bank.bank_name], ["Account no.", bank.account_number], ["IFSC", bank.ifsc], ["Branch", bank.branch], ["UPI", bank.upi]].filter(([, v]) => v) : [];
  const bankHtml = bankLines.length ? `<div class="box"><b>Bank details</b><br/>${bankLines.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br/>")}</div>` : "";

  const customRows = headerFields.map((f) => `<div><b>${esc(f.label)}:</b> ${esc(f.value)}</div>`).join("");
  const meta = `<div><b>Date:</b> ${fmtDate(vdate)}</div>${dueDate ? `<div><b>Due date:</b> ${fmtDate(dueDate)}</div>` : ""}${poNumber ? `<div><b>PO No.:</b> ${esc(poNumber)}</div>` : ""}${gstOn && supply.known ? `<div><b>Place of supply:</b> ${esc(supply.partyState)}</div>` : ""}${salespersonName ? `<div><b>Salesperson:</b> ${esc(salespersonName)}</div>` : ""}${customRows}`;
  const billTo = `<b>Bill To</b><br/>${esc(party?.name)}<br/><span class="muted">${esc(addressOf(party))}</span>${party?.gstin ? `<br/>GSTIN: ${esc(party.gstin)}` : ""}${party?.mobile ? `<br/>${esc(party.mobile)}` : ""}`;
  const seller = `${business.logo ? `<img class="logo" src="${business.logo}"/><br/>` : ""}<h1>${esc(business.name)}</h1><div class="muted">${esc(addressOf(business))}</div><div class="muted">${business.gstin ? `GSTIN: ${esc(business.gstin)} ` : ""}${business.pan ? `PAN: ${esc(business.pan)}` : ""}</div><div class="muted">${[business.mobile, business.email].filter(Boolean).map(esc).join(" · ")}</div>`;
  const head = layout === "receipt"
    ? `<div class="center">${seller}<div class="ttl">${title}</div><div># ${esc(voucherNo)}</div></div><div class="blk">${meta}</div><div class="blk">${billTo}</div>`
    : `<div class="top"><div>${seller}</div><div style="text-align:right"><h1>${title}</h1><div># ${esc(voucherNo)}</div></div></div><div class="cols"><div>${billTo}</div><div>${meta}</div></div>`;

  const css = `@page{size:${P.page};margin:${P.margin}}
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:${P.font}px;color:#111;${P.width ? `width:${P.width};` : ""}}
  h1{font-size:${Math.round(P.font * 1.6)}px;margin:0} .top{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:8px}
  .logo{max-height:${layout === "full" ? 60 : 36}px;max-width:150px;margin-bottom:4px} .muted{color:#555} .cols{display:flex;gap:18px;margin:10px 0}.cols>div{flex:1}
  table{width:100%;border-collapse:collapse} th,td{padding:${layout === "full" ? "5px 7px" : "3px 4px"};border-bottom:1px solid #ddd;text-align:left;vertical-align:top} th{background:#f3f3f3;font-size:${Math.round(P.font * 0.92)}px}
  .r{text-align:right} .attr{color:#555;font-size:${Math.round(P.font * 0.9)}px} .tot{width:${layout === "receipt" ? "100%" : "48%"};margin-left:auto;margin-top:8px} .tot td{border:0;padding:2px 6px}
  .grand td{border-top:2px solid #111;font-weight:bold;font-size:${Math.round(P.font * 1.15)}px} .gst{margin-top:10px} .gst .b td{font-weight:bold;border-top:1px solid #111}
  .words{margin:8px 0;font-style:italic} .box{border:1px solid #ddd;padding:6px;margin-top:8px;white-space:pre-wrap} .center{text-align:center} .ttl{font-weight:bold;margin-top:4px}
  .blk{border-top:1px dashed #999;padding:5px 0;margin-top:5px} .it{border-bottom:1px dotted #aaa;padding:3px 0} .row{display:flex;justify-content:space-between}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName || `${title} ${voucherNo}`)}</title><style>${css}</style></head><body class="paper-${esc(paper)} layout-${layout}">
  ${head}${itemsHtml}
  <table class="tot"><tr><td>Sub Total</td><td class="r">${money(totals.grossSubtotal)}</td></tr>
    ${totals.discountTotal ? `<tr><td>Discount</td><td class="r">- ${money(totals.discountTotal)}</td></tr>` : ""}
    ${chargeRows}${taxRows}${otherRows}${totals.roundOff ? `<tr><td>Round off</td><td class="r">${money(totals.roundOff)}</td></tr>` : ""}
    <tr class="grand"><td>Total</td><td class="r">${money(totals.total)}</td></tr></table>
  ${gstTable}
  <div class="words"><b>Total in words:</b> ${esc(amountInWords(totals.total))}</div>
  ${bankHtml}${notes ? `<div class="box"><b>Notes</b><br/>${esc(notes)}</div>` : ""}${termsText ? `<div class="box"><b>Terms &amp; Conditions</b><br/>${esc(termsText)}</div>` : ""}
  </body></html>`;
}

export function printHtml(html, fileName) {
  // Browsers suggest the PDF's file name from the page title while printing, so set it for the moment of printing.
  const original = document.title;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  if (fileName) doc.title = fileName;
  let restored = false;
  const restore = () => { if (restored) return; restored = true; document.title = original; try { iframe.remove(); } catch (e) { /* ignore */ } };
  setTimeout(() => {
    try {
      if (fileName) document.title = fileName;
      window.addEventListener("afterprint", restore, { once: true });
      iframe.contentWindow.addEventListener("afterprint", restore, { once: true });
      setTimeout(restore, 120000);
      iframe.contentWindow.focus(); iframe.contentWindow.print();
    } catch (e) { restore(); }
  }, 400);
}

function SendDialog({ info, onClose }) {
  const [copied, setCopied] = useState(false);
  const digits = (info.party?.mobile || "").replace(/\D/g, "");
  const wa = `https://wa.me/${digits.length === 10 ? "91" + digits : digits}?text=${encodeURIComponent(info.text)}`;
  const mail = `mailto:${info.party?.email || ""}?subject=${encodeURIComponent(info.subject)}&body=${encodeURIComponent(info.text)}`;
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: info.subject, text: info.text }); } catch (e) { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(info.text); setCopied(true); } catch (e) { /* ignore */ } }
  };
  const first = info.mode === "share";
  const btn = "w-full text-left px-4 py-3 border border-gray-200 rounded-lg text-sm hover:border-black";
  return (
    <Modal title="Saved — send to customer" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-3">{info.subject}</p>
      <div className="space-y-2">
        {first && <button onClick={share} className={btn}>{navigator.share ? "Share…" : copied ? "Copied to clipboard ✓" : "Copy message to share"}</button>}
        <a href={wa} target="_blank" rel="noreferrer" className={btn + " block"}>WhatsApp {info.party?.mobile ? `(${info.party.mobile})` : ""}</a>
        <a href={mail} className={btn + " block"}>Email {info.party?.email ? `(${info.party.email})` : "(add customer email first)"}</a>
        <button onClick={() => printHtml(info.html, info.fileName)} className={btn}>Print / Save as PDF</button>
        {!first && <button onClick={share} className={btn}>{navigator.share ? "Share…" : copied ? "Copied ✓" : "Copy message"}</button>}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">The message carries the invoice number, amount and due date. To send the invoice itself, choose Print / Save as PDF and attach it.</p>
      <button onClick={onClose} className="w-full mt-3 bg-black text-white rounded py-2.5 text-sm font-medium">Done</button>
    </Modal>
  );
}

/* ---------- the invoice form ---------- */
export function InvoiceForm({ businessId, ledgers, items, vtype, business, initial, convertFrom, vouchers = [], allocations = [], lines: postingLines = [], onCancel, onSaved, showToast, reload, onOpenLightbox, goSettings }) {
  const isEdit = !!initial && !convertFrom;
  const sys = sysMap(ledgers);
  const settings = business?.settings || {};
  const fieldDefs = Array.isArray(settings.invoice_fields) ? settings.invoice_fields : [];
  const headerDefs = fieldDefs.filter((d) => d.scope !== "line");
  const lineDefs = fieldDefs.filter((d) => d.scope === "line");
  const keyRef = useRef(0);
  const blankLine = () => ({ key: ++keyRef.current, item_id: "", description: "", hsn_sac: "", qty: 1, rate: 0, gstRate: 0, otherTaxes: [], custom: {}, attrs: [] });
  const fromRow = (r) => ({
    key: ++keyRef.current, item_id: r.item_id || "", description: r.description || "", hsn_sac: r.hsn_sac || "", qty: Number(r.qty) || 0, rate: Number(r.rate) || 0, gstRate: Number(r.gst_rate) || 0, custom: r.extra?.custom || {}, attrs: r.extra?.attributes || [],
    otherTaxes: Array.isArray(r.extra?.other_taxes) && r.extra.other_taxes.length ? r.extra.other_taxes.map((t) => ({ name: t.name, rate: t.rate })) : (Number(r.other_tax_rate) > 0 ? [{ name: "Other tax", rate: Number(r.other_tax_rate) }] : []),
  });
  const v0 = initial?.voucher; const m0 = v0?.meta || {};
  const normTax = (t) => ({ id: t.id || null, name: t.name || "Other tax", type: t.type || "percent", value: Number(t.value ?? t.rate) || 0 });

  const [partyId, setPartyId] = useState(v0?.party_ledger_id || "");
  const [vdate, setVdate] = useState(isEdit ? v0.vdate : todayISO());
  const [voucherNo, setVoucherNo] = useState(isEdit ? v0.voucher_no : "");
  const [poNumber, setPoNumber] = useState(v0?.po_number || "");
  const [narration, setNarration] = useState(v0 ? v0.narration || "" : settings.default_notes || "");
  const [lineItems, setLineItems] = useState(initial?.items?.length ? initial.items.map(fromRow) : [blankLine()]);
  const [discountType, setDiscountType] = useState(m0.discount?.type || "percent");
  const [discountValue, setDiscountValue] = useState(m0.discount?.value || 0);
  const [adjustments, setAdjustments] = useState(() => m0.adjustments || (!initial ? (settings.adjustment_presets || []).filter((p) => p.autoApply).map((p) => ({ key: ++keyRef.current, name: p.name, kind: p.kind, mode: p.mode, value: p.value, gstRate: p.gstRate || 0 })) : []));
  const [extraTaxes, setExtraTaxes] = useState((m0.extra_taxes || []).map(normTax));
  const [masterTaxes, setMasterTaxes] = useState([]);
  const [terms, setTerms] = useState(m0.terms?.type || "receipt");
  const [customDays, setCustomDays] = useState(m0.terms?.days || 7);
  const [termsText, setTermsText] = useState(m0.terms_text ?? settings.default_terms ?? "");
  const [salespersonId, setSalespersonId] = useState(m0.salesperson_id || "");
  const [headerValues, setHeaderValues] = useState(() => {
    const saved = {}; (m0.custom_header || []).forEach((f) => { saved[f.key] = f.value; });
    const init = {}; headerDefs.forEach((d) => { if (d.type !== "calculated") init[d.key] = saved[d.key] ?? d.defaultValue ?? ""; });
    return init;
  });
  const [attachments, setAttachments] = useState(initial?.attachments || []);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [scan, setScan] = useState("");
  const [selected, setSelected] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkPick, setBulkPick] = useState({});
  const [saveMenu, setSaveMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [numberTouched, setNumberTouched] = useState(false);
  const [showBank, setShowBank] = useState(m0.show_bank !== false);
  const [payOn, setPayOn] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());
  const [payParts, setPayParts] = useState(() => [newPart("cash")]);
  const fileRef = useRef(null);
  const scanRef = useRef(null);

  useEffect(() => {
    if (isEdit || numberTouched) return;
    api.nextVoucherNumber(businessId, vtype, vtype === "proforma_invoice" ? "PF-" : "INV-", settings.numbering?.[vtype], vdate).then(setVoucherNo).catch(() => {});
  }, [businessId, vtype, isEdit, vdate, numberTouched]);
  useEffect(() => { api.fetchOtherTaxes(businessId).then(setMasterTaxes).catch(() => {}); }, [businessId]);

  const party = ledgers.find((l) => l.id === partyId);
  const supply = detectSupplyType(business, party);
  const gstOn = !!business?.gst_applicable;
  const termDays = terms === "receipt" ? 0 : terms === "custom" ? Number(customDays) || 0 : Number(terms);
  const dueDate = addDays(vdate, termDays);
  const cashLedgerId = sys.cash;
  const finalExisting = isEdit && vtype === "sales_invoice" && m0.status !== "draft";
  const canPayOnSave = vtype === "sales_invoice" && !finalExisting;
  const convertedInvoice = vtype === "proforma_invoice" && m0.converted_to ? vouchers.find((x) => x.id === m0.converted_to) : null;
  const locked = isEdit && !!convertedInvoice;

  const computeFor = (lines) => computeInvoiceTotals(lines.map((l) => ({ ...l, gstRate: gstOn ? l.gstRate : 0 })), {
    supplyType: supply.type, discountType, discountValue,
    extraDiscounts: adjustments.filter((a) => a.kind === "discount").map((a) => ({ name: a.name, mode: a.mode, value: Number(a.value) || 0 })),
    charges: adjustments.filter((a) => a.kind === "charge").map((a) => ({ name: a.name, mode: a.mode, value: Number(a.value) || 0, gstRate: gstOn ? Number(a.gstRate) || 0 : 0 })),
    extraTaxes,
  });
  const totals = useMemo(() => computeFor(lineItems), [lineItems, supply.type, gstOn, discountType, discountValue, adjustments, extraTaxes]);

  const numericCustom = (vals, defs) => { const o = {}; defs.forEach((d) => { if (d.type === "number") o[d.key] = Number(vals?.[d.key]) || 0; }); return o; };
  const lineCalcFor = (l) => computeCalculatedFields(lineDefs, { qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, amount: l.amount ?? 0, ...numericCustom(l.custom, lineDefs) });
  const headerCalc = useMemo(() => computeCalculatedFields(headerDefs, { gross: totals.grossSubtotal, taxable: totals.subtotal, tax: round2(totals.cgst + totals.sgst + totals.igst), total: totals.total, qty: totals.qtyTotal, ...numericCustom(headerValues, headerDefs) }),
    [totals, headerValues, fieldDefs]);

  const custBal = party ? ledgerBalanceOf(party, postingLines) : null;
  const bank = settings.invoice_bank || null;
  const bankConfigured = !!(bank && (bank.account_number || bank.upi || bank.account_name || bank.bank_name));
  const gstSum = useMemo(() => gstSummaryByRate(totals), [totals]);

  const setLine = (key, patch) => setLineItems((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const onRate = (key, raw) => setLine(key, { rate: raw === "" ? "" : parseFloat(raw), totalDraft: undefined });
  const onQty = (key, raw) => setLine(key, { qty: raw === "" ? "" : parseFloat(raw), totalDraft: undefined });
  // Typing a TOTAL works backwards: rate = total / quantity, so the two always stay in step.
  const onTotal = (key, raw) => setLineItems((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    if (raw === "") return { ...l, totalDraft: "", rate: 0 };
    const total = parseFloat(raw);
    if (Number.isNaN(total)) return l;
    const qty = Number(l.qty) || 0;
    if (!qty) return { ...l, totalDraft: raw, qty: 1, rate: total };
    return { ...l, totalDraft: raw, rate: rateFromTotal(total, qty) };
  }));
  const lineFromItem = (it) => ({ item_id: it.id, description: it.name, hsn_sac: it.hsn_sac || "", rate: Number(it.sale_rate) || 0, gstRate: Number(it.gst_rate) || 0, otherTaxes: Array.isArray(it.other_taxes) ? it.other_taxes : [], totalDraft: undefined,
    attrs: (Array.isArray(it.attributes) ? it.attributes : []).filter((a) => a.show && String(a.value ?? "") !== "").map((a) => ({ label: a.label, value: a.value })) });
  const pickItem = (key, itemId) => { const it = items.find((x) => x.id === itemId); setLine(key, it ? lineFromItem(it) : { item_id: "", description: "", attrs: [] }); };
  const addBlank = () => setLineItems((ls) => [...ls, blankLine()]);
  const addItemLine = (it, qty = 1) => setLineItems((ls) => {
    const existing = ls.find((l) => l.item_id === it.id);
    if (existing) return ls.map((l) => (l.key === existing.key ? { ...l, qty: (Number(l.qty) || 0) + qty, totalDraft: undefined } : l));
    const blank = ls.find((l) => !l.item_id && !l.description);
    const nl = { ...(blank || blankLine()), ...lineFromItem(it), qty };
    return blank ? ls.map((l) => (l.key === blank.key ? nl : l)) : [...ls, nl];
  });

  const onScan = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const it = items.find((x) => (x.rfid && x.rfid.toLowerCase() === code) || (x.item_code && x.item_code.toLowerCase() === code) || x.name.toLowerCase() === code);
    if (!it) showToast(`No item matches "${scan.trim()}" (RFID, item code or name).`);
    else addItemLine(it, 1);
    setScan("");
    scanRef.current?.focus();
  };

  const toggleSel = (key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const deleteSelected = () => { setLineItems((ls) => { const rest = ls.filter((l) => !selected.includes(l.key)); return rest.length ? rest : [blankLine()]; }); setSelected([]); setBulkOpen(false); };
  const applyGstSelected = () => {
    const v = window.prompt("Apply GST % to the selected rows:");
    if (v === null) return;
    const n = parseFloat(v);
    if (Number.isNaN(n) || n < 0) { showToast("Enter a valid percentage."); return; }
    setLineItems((ls) => ls.map((l) => (selected.includes(l.key) ? { ...l, gstRate: n } : l)));
    setBulkOpen(false);
  };
  const addBulk = () => {
    Object.entries(bulkPick).forEach(([id, qty]) => { const it = items.find((x) => x.id === id); if (it && Number(qty) > 0) addItemLine(it, Number(qty)); });
    setBulkPick({}); setBulkModal(false); setBulkOpen(false);
  };

  const taxLabel = (t) => (t.type === "fixed_invoice" ? `₹${t.value} per invoice` : t.type === "fixed_unit" ? `₹${t.value} per unit` : `${t.value}%`);
  const availableTaxes = masterTaxes.filter((t) => t.active && t.applies_to !== "purchase" && !extraTaxes.some((x) => x.id === t.id));
  const addMasterTax = (id) => { const t = masterTaxes.find((x) => x.id === id); if (t) setExtraTaxes((x) => [...x, normTax({ id: t.id, name: t.name, type: t.calc_type, value: t.value })]); };
  const otherAmount = (name) => totals.otherTaxSummary.find((t) => t.name === name)?.amount || 0;

  const addAdjustment = (choice) => {
    if (!choice) return;
    const preset = (settings.adjustment_presets || []).find((p) => p.id === choice);
    const base = preset ? { name: preset.name, kind: preset.kind, mode: preset.mode, value: preset.value, gstRate: preset.gstRate || 0 }
      : choice === "custom_discount" ? { name: "Discount", kind: "discount", mode: "fixed", value: 0, gstRate: 0 } : { name: "Charge", kind: "charge", mode: "fixed", value: 0, gstRate: 0 };
    setAdjustments((a) => [...a, { key: ++keyRef.current, ...base }]);
  };
  const setAdj = (key, patch) => setAdjustments((a) => a.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const adjAmount = (a) => { const v = Number(a.value) || 0; return a.mode === "percent" ? round2(((a.kind === "discount" ? totals.grossSubtotal : totals.subtotal - totals.chargesTotal) * v) / 100) : round2(v); };

  const addFiles = (fileList) => {
    const files = Array.from(fileList);
    let count = attachments.length + pendingFiles.length;
    const ok = [];
    for (const f of files) {
      if (count >= 10) { showToast("A maximum of 10 files can be attached."); break; }
      if (f.size > api.MAX_ATTACHMENT_BYTES) { showToast(`${f.name} is larger than 2 MB.`); continue; }
      ok.push(f); count++;
    }
    setPendingFiles((p) => [...p, ...ok]);
  };
  const openAttachment = async (a) => {
    try {
      const d = await api.fetchAttachmentData(a.id);
      if ((d.mime_type || "").startsWith("image/") && onOpenLightbox) onOpenLightbox(d.data);
      else { const link = document.createElement("a"); link.href = d.data; link.download = d.file_name; link.click(); }
    } catch (e) { showToast(e.message); }
  };
  const removeAttachment = async (a) => {
    if (!window.confirm(`Remove ${a.file_name}?`)) return;
    try { await api.deleteAttachment(a.id); setAttachments((x) => x.filter((y) => y.id !== a.id)); } catch (e) { showToast(e.message); }
  };

  const save = async (mode, after) => {
    setSaveMenu(false);
    if (locked) { showToast("This proforma has been converted to a tax invoice and can no longer be changed."); return; }
    if (!partyId) { showToast("Select a customer first."); return; }
    if (!voucherNo.trim()) { showToast("Enter an invoice number."); return; }
    const validLines = lineItems.filter((l) => (l.item_id || (l.description || "").trim()) && Number(l.qty) > 0);
    if (mode === "final" && !validLines.length) { showToast("Add at least one item with a quantity."); return; }
    const t = computeFor(validLines.length ? validLines : lineItems);
    const recordPayment = payOn && mode === "final" && canPayOnSave && partsTotal(payParts) > 0;
    if (recordPayment) {
      const problem = validateParts(payParts, cashLedgerId, t.total);
      if (problem) { showToast(problem); return; }
    }
    setSaving(true);
    try {
      let spName = "";
      if (salespersonId) { try { spName = (await api.fetchSalespersons(businessId)).find((s) => s.id === salespersonId)?.name || ""; } catch (e) { /* ignore */ } }
      const meta = { ...(v0?.meta || {}), status: mode, send_later: after === "later", discount: { type: discountType, value: Number(discountValue) || 0 }, adjustments, extra_taxes: extraTaxes,
        terms: { type: terms, days: termDays }, due_date: dueDate, terms_text: termsText, salesperson_id: salespersonId || null, salesperson_name: spName, place_of_supply: supply.known ? supply.partyState : null, show_bank: showBank,
        custom_header: headerDefs.map((d) => ({ key: d.key, label: d.label, type: d.type, print: d.showOnPrint !== false, value: d.type === "calculated" ? headerCalc[d.key] : headerValues[d.key] ?? "" })) };
      delete meta.converted_to; delete meta.converted_at;
      if (convertFrom) meta.converted_from = convertFrom.id;
      const voucher = { id: isEdit ? v0.id : undefined, business_id: businessId, vtype, voucher_no: voucherNo.trim(), vdate, party_ledger_id: partyId, main_ledger_id: sys.sales,
        po_number: poNumber, narration, supply_type: supply.type, subtotal: t.subtotal, cgst: t.cgst, sgst: t.sgst, igst: t.igst, other_tax: t.otherTax, round_off: t.roundOff, total: t.total, meta };
      const apiItems = t.lines.map((l, i) => ({ line_no: i + 1, item_id: l.item_id || null, description: l.description, hsn_sac: l.hsn_sac, qty: l.qty, rate: l.rate, amount: l.amount,
        gst_rate: gstOn ? l.gstRate : 0, other_tax_rate: (l.otherTaxes || []).reduce((s, x) => s + (Number(x.rate) || 0), 0), cgst_amt: l.cgstAmt, sgst_amt: l.sgstAmt, igst_amt: l.igstAmt, other_tax_amt: l.otherTaxAmt,
        extra: { discount: l.discountAmt, other_taxes: l.otherTaxBreakdown || [], custom: l.custom || {}, calculated: lineCalcFor(l), attributes: l.attrs || [] } }));
      // A proforma is NEVER posted to the books; only a final sales invoice posts ledger entries.
      const postLines = mode === "final" && vtype === "sales_invoice" ? buildSalesInvoiceLines({ partyLedgerId: partyId, salesLedgerId: sys.sales, gstLedgers: sys, invoiceTotals: t }) : [];
      const id = convertFrom && mode === "final" ? await api.convertProforma(convertFrom.id, voucher, apiItems, postLines) : await api.saveVoucher(voucher, apiItems, postLines);
      for (const f of pendingFiles) { try { await api.uploadAttachment(businessId, id, f); } catch (e) { showToast(`Invoice saved, but ${f.name} could not be uploaded: ${e.message}`); } }
      if (recordPayment) {
        try {
          const rno = await api.nextVoucherNumber(businessId, "receipt", "RCT-", settings.numbering?.receipt, payDate);
          const { receiptVoucher, lines } = buildReceiptForInvoice({ invoice: { id, party_ledger_id: partyId, voucher_no: voucherNo.trim() }, businessId, date: payDate, parts: payParts, cashLedgerId, voucherNo: rno });
          await api.recordInvoicePayment(id, receiptVoucher, lines);
        } catch (e) { showToast(`Invoice saved, but the payment could not be recorded: ${e.message} You can record it from the invoice.`); }
      }

      const title = vtype === "proforma_invoice" ? "Proforma invoice" : "Invoice";
      const printLines = t.lines.map((l) => ({ ...l, colValues: { ...(l.custom || {}), ...lineCalcFor(l) } }));
      const headerFields = meta.custom_header.filter((f) => f.print && f.value !== "" && f.value !== null && f.value !== undefined).map((f) => ({ label: f.label, value: f.value }));
      const lineColumns = lineDefs.filter((d) => d.showOnPrint !== false).map((d) => ({ key: d.key, label: d.label }));
      // NOTE: the customer's outstanding balance is deliberately NOT passed here: it is for on-screen viewing only.
      const fileName = safeFileName(voucherNo.trim(), party?.name);
      const html = invoiceHtml({ business, party, vtype, voucherNo: voucherNo.trim(), vdate, dueDate, poNumber, totals: { ...t, lines: printLines }, supply, notes: narration, termsText, headerFields, lineColumns, salespersonName: spName, gstOn, paper: settings.paper_size || "a4", fileName, bank: showBank && bankConfigured ? settings.invoice_bank : null });
      const text = `${title} ${voucherNo.trim()} dated ${fmtDate(vdate)} from ${business.name}: ${inr(t.total)}${termDays ? `, due by ${fmtDate(dueDate)}` : ", due on receipt"}. Thank you!`;
      if (mode === "draft") { showToast("Saved as draft"); onSaved(); }
      else if (after === "print") { printHtml(html, fileName); showToast(`${title} saved`); onSaved(); }
      else if (after === "send" || after === "share") { setDialog({ mode: after, party, html, fileName, text, subject: `${title} ${voucherNo.trim()} — ${inr(t.total)}` }); }
      else if (after === "later") { showToast(`${title} saved — marked to send later`); onSaved(); }
      else { showToast(`${title} saved`); onSaved(); }
    } catch (e) { showToast(e.message); }
    finally { setSaving(false); }
  };

  const th = "py-2 pr-2 text-xs font-medium text-gray-500 text-left";
  const title = vtype === "proforma_invoice" ? "Proforma Invoice" : "Tax Invoice";
  const money = (n) => "₹" + fmt(n);

  return (
    <div className="pb-24">
      <BackHeader title={isEdit ? `Edit ${title} ${v0.voucher_no}` : convertFrom ? "Convert to Tax Invoice" : `New ${title}`} onBack={onCancel} right={m0.status === "draft" ? <span className="text-xs bg-gray-100 px-2 py-1 rounded">Draft</span> : null} />
      {vtype === "proforma_invoice" && !locked && <p className="text-xs text-blue-700 bg-blue-50 rounded px-3 py-2 mb-3 max-w-5xl">A proforma invoice is only a quotation. It does <b>not</b> affect your accounts, sales, GST or reports until you convert it to a Tax Invoice.</p>}
      {locked && <p role="alert" className="text-sm text-green-800 bg-green-50 rounded px-3 py-2 mb-3 max-w-5xl">This proforma was converted to Tax Invoice <b>{convertedInvoice.voucher_no}</b>. It is locked so the sale can never be posted twice.</p>}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5 max-w-5xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Field label="Customer *"><PartyPicker kind="customer" ledgers={ledgers} value={partyId} onChange={setPartyId} businessId={businessId} reload={reload} showToast={showToast} /></Field>
            {party && custBal !== null && (
              <div aria-label="Customer outstanding" className="mt-1.5 text-xs bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                Outstanding: <b className="tabnum">{money(Math.abs(custBal))}</b> {custBal > 0.005 ? "to receive" : custBal < -0.005 ? "advance / credit" : "— nothing due"}
                <span className="text-gray-500"> · for your view only, never printed or shared{isEdit && finalExisting ? " (includes this invoice)" : ""}</span>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 self-end pb-2">
            {!gstOn ? <span className="text-amber-700">GST is switched off for this business, so no GST is charged. Turn it on under Business Profile.</span>
              : !partyId ? "Place of supply is detected from the customer's state."
              : supply.known ? <>Place of supply: <b>{supply.partyState}</b> → <b>{supply.type === "inter" ? "IGST" : "CGST + SGST"}</b></>
              : <span className="text-amber-700">This customer's state isn't set, so CGST + SGST is applied. Add the state or GSTIN under Ledgers to detect IGST automatically.</span>}
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Invoice No.">
            <input aria-label="Invoice number" className={inputCls} value={voucherNo} onChange={(e) => { setVoucherNo(e.target.value); setNumberTouched(true); }} />
            {!isEdit && numberTouched && <button type="button" onClick={() => setNumberTouched(false)} className="text-[11px] text-blue-700 mt-1">Use automatic number</button>}
            {vtype === "sales_invoice" && gstNumberProblem(voucherNo) && <p className="text-[11px] text-amber-700 mt-1">{gstNumberProblem(voucherNo)}</p>}
          </Field>
          <Field label="Invoice date"><input type="date" aria-label="Invoice date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Terms">
            <div className="flex gap-2">
              <select aria-label="Terms" className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value)}>
                <option value="receipt">Due on Receipt</option><option value="15">Net 15 Days</option><option value="30">Net 30 Days</option><option value="45">Net 45 Days</option><option value="custom">Custom</option>
              </select>
              {terms === "custom" && <input type="number" min="0" className={inputCls + " !w-20"} value={customDays} onChange={(e) => setCustomDays(e.target.value)} title="Days" />}
            </div>
          </Field>
          <Field label="Due date"><div className={inputCls + " bg-gray-50 text-gray-600"}>{fmtDate(dueDate)}</div></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Purchase Order No."><input className={inputCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></Field>
          <Field label="Salesperson"><SalespersonPicker businessId={businessId} value={salespersonId} onChange={setSalespersonId} showToast={showToast} /></Field>
        </div>
        {headerDefs.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-3">
            {headerDefs.map((d) => (
              <Field key={d.key} label={d.label}>
                {d.type === "calculated"
                  ? <div aria-label={d.label} className={inputCls + " bg-gray-50 text-gray-700"}>{headerCalc[d.key] ?? "—"}</div>
                  : <input aria-label={d.label} type={d.type === "number" ? "number" : "text"} className={inputCls} value={headerValues[d.key] ?? ""} onChange={(e) => setHeaderValues((v) => ({ ...v, [d.key]: e.target.value }))} />}
              </Field>
            ))}
          </div>
        )}

        <div className="border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 gap-2 flex-wrap">
            <span className="text-sm font-semibold">Item Table</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <ScanLine size={15} className="text-blue-700" />
                <input ref={scanRef} aria-label="Scan item" className="text-sm border border-gray-300 rounded px-2 py-1 w-52" placeholder="Scan Item (RFID / code), Enter" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} />
              </div>
              <div className="relative">
                <button type="button" onClick={() => setBulkOpen((o) => !o)} className="text-sm text-blue-700 font-medium flex items-center gap-1 px-2 py-1">Bulk Actions <ChevronDown size={13} /></button>
                {bulkOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 text-sm">
                    <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => { setBulkModal(true); setBulkOpen(false); }}>Add items in bulk</button>
                    <button disabled={!selected.length} className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:text-gray-300" onClick={applyGstSelected}>Apply GST % to selected</button>
                    <button disabled={!selected.length} className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:text-gray-300 text-red-600" onClick={deleteSelected}>Delete selected rows</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 760 + lineDefs.length * 110 }}>
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={th + " w-8 pl-3"}></th><th className={th + " w-[28%]"}>ITEM DETAILS</th><th className={th + " w-[10%]"}>HSN/SAC</th><th className={th + " w-[9%]"}>QUANTITY</th>
                  <th className={th + " w-[12%]"}>RATE</th>{lineDefs.map((d) => <th key={d.key} className={th}>{d.label.toUpperCase()}</th>)}{gstOn && <th className={th + " w-[8%]"}>GST %</th>}<th className={th + " w-[14%] text-right"}>TOTAL</th><th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {totals.lines.map((l, i) => {
                  const calc = lineDefs.some((d) => d.type === "calculated") ? lineCalcFor(l) : {};
                  return (
                    <tr key={l.key} className="border-b border-gray-100 align-top">
                      <td className="pl-3 pt-3"><input type="checkbox" aria-label={`Select row ${i + 1}`} checked={selected.includes(l.key)} onChange={() => toggleSel(l.key)} /></td>
                      <td className="py-1.5 pr-2">
                        <CreatablePicker options={items.map((it) => ({ id: it.id, label: it.name, sublabel: [it.group_name, it.item_code && `#${it.item_code}`].filter(Boolean).join(" · ") }))} value={l.item_id} onChange={(id) => pickItem(l.key, id)} placeholder="Type or click to select an item" />
                        {(l.attrs || []).length > 0 && <div aria-label={`Product details ${i + 1}`} className="text-[11px] text-gray-600 mt-0.5">{l.attrs.map((a) => `${a.label}: ${a.value}`).join(" · ")}</div>}
                        {(l.otherTaxBreakdown || []).length > 0 && <div className="text-[10px] text-gray-400 mt-0.5">+ {l.otherTaxBreakdown.map((t) => `${t.name} ${money(t.amount)}`).join(", ")}</div>}
                      </td>
                      <td className="py-1.5 pr-2"><input aria-label={`HSN ${i + 1}`} className={inputCls} value={l.hsn_sac} onChange={(e) => setLine(l.key, { hsn_sac: e.target.value })} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={`Quantity ${i + 1}`} type="number" className={inputCls + " text-right"} value={l.qty} onChange={(e) => onQty(l.key, e.target.value)} /></td>
                      <td className="py-1.5 pr-2"><input aria-label={`Rate ${i + 1}`} type="number" className={inputCls + " text-right"} value={l.rate === "" ? "" : rd4(l.rate)} onChange={(e) => onRate(l.key, e.target.value)} /></td>
                      {lineDefs.map((d) => (
                        <td key={d.key} className="py-1.5 pr-2">
                          {d.type === "calculated" ? <div className="pt-2 text-right tabnum text-gray-700">{calc[d.key] ?? "—"}</div>
                            : <input aria-label={`${d.label} ${i + 1}`} type={d.type === "number" ? "number" : "text"} className={inputCls + (d.type === "number" ? " text-right" : "")} value={l.custom?.[d.key] ?? ""} onChange={(e) => setLine(l.key, { custom: { ...(l.custom || {}), [d.key]: e.target.value } })} />}
                        </td>
                      ))}
                      {gstOn && <td className="py-1.5 pr-2"><input aria-label={`GST ${i + 1}`} type="number" className={inputCls + " text-right"} value={l.gstRate} onChange={(e) => setLine(l.key, { gstRate: parseFloat(e.target.value) || 0 })} /></td>}
                      <td className="py-1.5 pr-2"><input aria-label={`Total ${i + 1}`} type="number" className={inputCls + " text-right font-medium"} value={l.totalDraft ?? l.amount} onChange={(e) => onTotal(l.key, e.target.value)} onBlur={() => setLine(l.key, { totalDraft: undefined })} /></td>
                      <td className="pt-3"><button aria-label={`Delete row ${i + 1}`} onClick={() => setLineItems((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 flex gap-2 items-center flex-wrap">
            <button type="button" onClick={addBlank} className="text-sm bg-blue-50 text-blue-700 font-medium rounded px-3 py-1.5 flex items-center gap-1"><Plus size={14} /> Add New Row</button>
            <button type="button" onClick={() => setBulkModal(true)} className="text-sm bg-blue-50 text-blue-700 font-medium rounded px-3 py-1.5 flex items-center gap-1"><Plus size={14} /> Add Items in Bulk</button>
            <span className="text-[11px] text-gray-400">Type a Total to work out the Rate from the Quantity; change the Rate and the Total follows.</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-4">
            <Field label="Customer Notes"><textarea rows={3} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Thanks for your business." /></Field>
            <Field label="Terms & Conditions"><textarea rows={3} className={inputCls} value={termsText} onChange={(e) => setTermsText(e.target.value)} placeholder="Terms and conditions to print on the invoice" /></Field>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Attach files to this invoice</label>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sm border border-dashed border-gray-400 rounded px-3 py-2 flex items-center gap-1.5 hover:border-black"><Paperclip size={14} /> Upload File</button>
              <p className="text-[11px] text-gray-400 mt-1">Up to 10 files, 2 MB each.</p>
              <div className="mt-2 space-y-1">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-2 py-1">
                    <button type="button" onClick={() => openAttachment(a)} className="underline truncate text-left">{a.file_name}</button>
                    <button type="button" onClick={() => removeAttachment(a)} className="text-gray-400 hover:text-red-600 ml-2"><X size={14} /></button>
                  </div>
                ))}
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-yellow-50 rounded px-2 py-1">
                    <span className="truncate">{f.name} <span className="text-gray-400">(uploads on save)</span></span>
                    <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 ml-2"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
            {finalExisting && <PaymentsPanel invoice={v0} vouchers={vouchers} allocations={allocations} ledgers={ledgers} businessId={businessId} reload={reload} showToast={showToast} numbering={settings.numbering?.receipt} />}
            {canPayOnSave && (
              <div className="border border-gray-200 rounded-lg p-4">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={payOn} onChange={(e) => setPayOn(e.target.checked)} /> Payment received now</label>
                {!payOn && <p className="text-[11px] text-gray-400 mt-1">Tick this if the customer pays when the invoice is made (in Cash, Bank, or both). You can also record payments later from the invoice.</p>}
                {payOn && (
                  <div className="mt-3 space-y-3">
                    <Field label="Payment date"><input type="date" aria-label="Payment date" className={inputCls} value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
                    <PaymentPartsEditor parts={payParts} setParts={setPayParts} ledgers={ledgers} businessId={businessId} reload={reload} showToast={showToast} outstanding={totals.total} />
                    <p className="text-[11px] text-gray-400">Recorded as a receipt against this invoice when you use Save and Send / Print / Share / Send Later (not for drafts).</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2 self-start" aria-label="Invoice totals">
            <div className="flex justify-between"><span>Sub Total</span><span className="tabnum font-medium">{money(totals.grossSubtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>Discount</span>
              <div className="flex items-center gap-1">
                <input aria-label="Discount value" type="number" min="0" className="w-20 border border-gray-300 rounded px-2 py-1 text-right" value={discountValue} onChange={(e) => setDiscountValue(e.target.value === "" ? "" : parseFloat(e.target.value))} />
                <select aria-label="Discount type" className="border border-gray-300 rounded px-1 py-1" value={discountType} onChange={(e) => setDiscountType(e.target.value)}><option value="percent">%</option><option value="amount">₹</option></select>
              </div>
              <span className="tabnum w-24 text-right">{totals.discountTotal ? `- ${money(totals.discountTotal)}` : "—"}</span>
            </div>

            <div>
              <div className="flex justify-between items-center"><span>Additional charges &amp; discounts</span></div>
              {adjustments.map((a) => (
                <div key={a.key} className="grid grid-cols-12 gap-1 mt-1 items-center">
                  <input aria-label="Adjustment name" className="col-span-4 border border-gray-300 rounded px-2 py-1" value={a.name} onChange={(e) => setAdj(a.key, { name: e.target.value })} />
                  <select aria-label="Adjustment type" className="col-span-2 border border-gray-300 rounded px-1 py-1" value={a.mode} onChange={(e) => setAdj(a.key, { mode: e.target.value })}><option value="fixed">₹</option><option value="percent">%</option></select>
                  <input aria-label="Adjustment value" type="number" className="col-span-2 border border-gray-300 rounded px-2 py-1 text-right" value={a.value} onChange={(e) => setAdj(a.key, { value: e.target.value })} />
                  {gstOn && a.kind === "charge" ? <input aria-label="Adjustment GST" type="number" title="GST % on this charge" placeholder="GST%" className="col-span-2 border border-gray-300 rounded px-2 py-1 text-right" value={a.gstRate} onChange={(e) => setAdj(a.key, { gstRate: e.target.value })} /> : <span className="col-span-2 text-[10px] text-gray-400 text-center">{a.kind}</span>}
                  <button type="button" aria-label="Remove adjustment" onClick={() => setAdjustments((x) => x.filter((y) => y.key !== a.key))} className="col-span-1 text-gray-400 hover:text-red-600 flex justify-center"><X size={14} /></button>
                  <span className="col-span-12 text-right text-[11px] text-gray-500 tabnum">{a.kind === "discount" ? "−" : "+"} {money(adjAmount(a))}</span>
                </div>
              ))}
              <select aria-label="Add charge or discount" className="mt-1 w-full border border-dashed border-gray-300 rounded px-2 py-1 text-xs text-blue-700" value="" onChange={(e) => addAdjustment(e.target.value)}>
                <option value="">+ Add a charge or discount…</option>
                {(settings.adjustment_presets || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
                <option value="custom_charge">Other charge…</option><option value="custom_discount">Other discount…</option>
              </select>
            </div>
            {totals.chargesTotal > 0 && <div className="flex justify-between text-gray-500"><span>Charges added</span><span className="tabnum">+ {money(totals.chargesTotal)}</span></div>}
            {(totals.discountTotal > 0 || totals.chargesTotal > 0) && <div className="flex justify-between text-gray-500"><span>Taxable value</span><span className="tabnum">{money(totals.subtotal)}</span></div>}
            {gstOn && (supply.type === "inter"
              ? <div className="flex justify-between"><span>IGST</span><span className="tabnum">{money(totals.igst)}</span></div>
              : <><div className="flex justify-between"><span>CGST</span><span className="tabnum">{money(totals.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span className="tabnum">{money(totals.sgst)}</span></div></>)}
            <div>
              <div className="flex justify-between items-center"><span>Other Taxes</span>{goSettings && <button type="button" onClick={goSettings} className="text-xs text-blue-700 font-medium">Manage in Settings</button>}</div>
              <select aria-label="Add other tax" className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" value="" onChange={(e) => addMasterTax(e.target.value)}>
                <option value="">{masterTaxes.length === 0 ? "No taxes set up yet (add them in Settings)" : availableTaxes.length ? "Select a tax to add…" : "All taxes added"}</option>
                {availableTaxes.map((t) => <option key={t.id} value={t.id}>{t.name} — {taxLabel({ type: t.calc_type, value: t.value })}</option>)}
              </select>
              {extraTaxes.map((t, i) => (
                <div key={i} className="flex justify-between items-center mt-1 text-gray-700">
                  <span className="flex items-center gap-1">{t.name} <span className="text-[11px] text-gray-400">({taxLabel(t)})</span><button type="button" aria-label={`Remove tax ${t.name}`} onClick={() => setExtraTaxes((x) => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={13} /></button></span>
                  <span className="tabnum">{money(otherAmount(t.name))}</span>
                </div>
              ))}
              {totals.otherTaxSummary.filter((t) => !extraTaxes.some((x) => x.name === t.name)).map((t) => <div key={t.name} className="flex justify-between text-gray-600 mt-1"><span>{t.name}</span><span className="tabnum">{money(t.amount)}</span></div>)}
            </div>
            <div className="flex justify-between text-gray-400"><span>Round off</span><span className="tabnum">{money(totals.roundOff)}</span></div>
            <div className="flex justify-between font-semibold text-base border-t border-gray-300 pt-2"><span>Total (₹)</span><span className="tabnum" aria-label="Invoice total">{money(totals.total)}</span></div>
            <p className="text-[11px] text-gray-400">{amountInWords(totals.total)}</p>
            {gstOn && gstSum.hasTax && (
              <table aria-label="GST by rate" className="w-full text-xs mt-2 border-t border-gray-200">
                <thead><tr className="text-gray-500"><th className="text-left py-1 font-medium">GST rate</th><th className="text-right font-medium">Taxable</th>{supply.type === "inter" ? <th className="text-right font-medium">IGST</th> : <><th className="text-right font-medium">CGST</th><th className="text-right font-medium">SGST</th></>}<th className="text-right font-medium">Tax</th></tr></thead>
                <tbody>
                  {gstSum.rows.map((r) => <tr key={r.rate}><td className="py-0.5">{r.rate}%</td><td className="text-right tabnum">{money(r.taxable)}</td>{supply.type === "inter" ? <td className="text-right tabnum">{money(r.igst)}</td> : <><td className="text-right tabnum">{money(r.cgst)}</td><td className="text-right tabnum">{money(r.sgst)}</td></>}<td className="text-right tabnum">{money(r.tax)}</td></tr>)}
                  <tr className="font-semibold border-t border-gray-300"><td className="py-0.5">Total</td><td className="text-right tabnum">{money(gstSum.total.taxable)}</td>{supply.type === "inter" ? <td className="text-right tabnum">{money(gstSum.total.igst)}</td> : <><td className="text-right tabnum">{money(gstSum.total.cgst)}</td><td className="text-right tabnum">{money(gstSum.total.sgst)}</td></>}<td className="text-right tabnum">{money(gstSum.total.tax)}</td></tr>
                </tbody>
              </table>
            )}
            {bankConfigured && <label className="flex items-center gap-2 text-xs text-gray-600 pt-1"><input type="checkbox" aria-label="Print bank details" checked={showBank} onChange={(e) => setShowBank(e.target.checked)} /> Print bank details on this bill</label>}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 md:left-56 z-30 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2">
        {!locked && !convertFrom && <button disabled={saving} onClick={() => save("draft", null)} className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:border-black disabled:opacity-50">Save as Draft</button>}
        {!locked && (
          <div className="relative flex">
            <button disabled={saving} onClick={() => save("final", "send")} className="bg-blue-600 text-white rounded-l px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving…" : "Save and Send"}</button>
            <button disabled={saving} aria-label="More save options" onClick={() => setSaveMenu((o) => !o)} className="bg-blue-600 text-white rounded-r px-2 border-l border-blue-400 hover:bg-blue-700"><ChevronDown size={15} /></button>
            {saveMenu && (
              <div className="absolute bottom-full mb-1 left-0 w-52 bg-white border border-gray-200 rounded-lg shadow-lg text-sm z-40">
                <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "print")}>Save and Print</button>
                <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "share")}>Save and Share</button>
                <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "later")}>Save and Send Later</button>
              </div>
            )}
          </div>
        )}
        <button onClick={onCancel} className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:border-black">{locked ? "Back" : "Cancel"}</button>
        <div className="ml-auto text-right text-xs text-gray-500">Total Amount: <b className="text-sm text-black">{money(totals.total)}</b></div>
      </div>

      {bulkModal && (
        <Modal title="Add items in bulk" onClose={() => setBulkModal(false)}>
          {items.length === 0 ? <p className="text-sm text-gray-400">No products yet. Add some under Ledgers → Products &amp; Services.</p> : (
            <>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-sm border-b border-gray-100 py-1.5">
                    <input type="checkbox" checked={bulkPick[it.id] !== undefined} onChange={(e) => setBulkPick((p) => { const n = { ...p }; if (e.target.checked) n[it.id] = 1; else delete n[it.id]; return n; })} />
                    <span className="flex-1">{it.name} <span className="text-xs text-gray-400">{[it.group_name, it.item_code && `#${it.item_code}`].filter(Boolean).join(" · ")}</span></span>
                    {bulkPick[it.id] !== undefined && <input type="number" min="1" className="w-16 border border-gray-300 rounded px-2 py-1 text-right" value={bulkPick[it.id]} onChange={(e) => setBulkPick((p) => ({ ...p, [it.id]: e.target.value }))} />}
                  </label>
                ))}
              </div>
              <button onClick={addBulk} disabled={!Object.keys(bulkPick).length} className="w-full mt-3 bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-40">Add selected items</button>
            </>
          )}
        </Modal>
      )}
      {dialog && <SendDialog info={dialog} onClose={() => { setDialog(null); onSaved(); }} />}
    </div>
  );
}
