import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, X, ChevronDown, Paperclip, ScanLine } from "lucide-react";
import { todayISO, inr, inputCls, Field, BackHeader } from "../../shared";
import * as api from "./data";
import { computeInvoiceTotals, buildSalesInvoiceLines, detectSupplyType, INDIAN_STATES, amountInWords } from "./calc";

const fmtDate = (s) => (s ? s.split("-").reverse().join("-") : "");
const addDays = (dateStr, n) => { const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sysMap = (ledgers) => { const m = {}; ledgers.filter((l) => l.system_key).forEach((l) => { m[l.system_key] = l.id; }); return m; };
const addressOf = (o) => [o?.office_no, o?.building_name, o?.street_name, o?.city, o?.state, o?.pin_code].filter(Boolean).join(", ");

/* ---------- a dropdown with search AND a "+ Create new" row ---------- */
export function CreatablePicker({ options, value, onChange, placeholder, createLabel, onCreate }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((o) => o.id === value);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = query.trim().toLowerCase();
  const matches = (q ? options.filter((o) => (o.label + " " + (o.sublabel || "")).toLowerCase().includes(q)) : options).slice(0, 30);
  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className={inputCls + " flex items-center justify-between"}>
          <span className="truncate">{selected.label}{selected.sublabel ? ` · ${selected.sublabel}` : ""}</span>
          <button type="button" onClick={() => { onChange(""); setQuery(""); }} className="text-gray-400 hover:text-black ml-2 shrink-0"><X size={15} /></button>
        </div>
      ) : (
        <input className={inputCls} placeholder={placeholder} value={query} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
      )}
      {open && !selected && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {matches.length === 0 && <p className="text-xs text-gray-400 px-3 py-3">No matches.</p>}
          {matches.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setQuery(""); setOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">
              <div className="font-medium">{o.label}</div>
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

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3"><h3 className="font-display text-lg">{title}</h3><button onClick={onClose} className="text-gray-400"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

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
export function invoiceHtml({ business, party, vtype, voucherNo, vdate, dueDate, poNumber, totals, supply, notes, termsText, custom, salespersonName, gstOn }) {
  const rows = totals.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.hsn_sac)}</td><td class="r">${l.qty}</td><td class="r">${inr(l.rate)}</td>${gstOn ? `<td class="r">${l.gstRate || 0}%</td>` : ""}<td class="r">${inr(l.amount)}</td></tr>`).join("");
  const taxRows = gstOn ? (supply.type === "inter"
    ? `<tr><td>IGST</td><td class="r">${inr(totals.igst)}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${inr(totals.cgst)}</td></tr><tr><td>SGST</td><td class="r">${inr(totals.sgst)}</td></tr>`) : "";
  const otherRows = totals.otherTaxSummary.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${inr(t.amount)}</td></tr>`).join("");
  const customRows = Object.entries(custom || {}).filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join("");
  const title = vtype === "proforma_invoice" ? "PROFORMA INVOICE" : "TAX INVOICE";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(voucherNo)}</title><style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
  h1{font-size:20px;margin:0} .top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:10px}
  .logo{max-height:60px;max-width:160px;margin-bottom:6px} .muted{color:#555} .cols{display:flex;gap:24px;margin:14px 0}.cols>div{flex:1}
  table{width:100%;border-collapse:collapse} th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top} th{background:#f3f3f3;font-size:11px}
  .r{text-align:right} .tot{width:46%;margin-left:auto;margin-top:10px} .tot td{border:0;padding:3px 8px} .grand td{border-top:2px solid #111;font-weight:bold;font-size:14px}
  .words{margin:10px 0;font-style:italic} .box{border:1px solid #ddd;padding:8px;margin-top:10px;white-space:pre-wrap}
  @media print{body{margin:10mm}}</style></head><body>
  <div class="top"><div>${business.logo ? `<img class="logo" src="${business.logo}"/><br/>` : ""}<h1>${esc(business.name)}</h1>
    <div class="muted">${esc(addressOf(business))}</div>
    <div class="muted">${business.gstin ? `GSTIN: ${esc(business.gstin)} ` : ""}${business.pan ? `PAN: ${esc(business.pan)}` : ""}</div>
    <div class="muted">${[business.mobile, business.email].filter(Boolean).map(esc).join(" · ")}</div></div>
    <div style="text-align:right"><h1>${title}</h1><div># ${esc(voucherNo)}</div></div></div>
  <div class="cols"><div><b>Bill To</b><br/>${esc(party?.name)}<br/><span class="muted">${esc(addressOf(party))}</span>${party?.gstin ? `<br/>GSTIN: ${esc(party.gstin)}` : ""}${party?.mobile ? `<br/>${esc(party.mobile)}` : ""}</div>
    <div><div><b>Date:</b> ${fmtDate(vdate)}</div>${dueDate ? `<div><b>Due date:</b> ${fmtDate(dueDate)}</div>` : ""}${poNumber ? `<div><b>PO No.:</b> ${esc(poNumber)}</div>` : ""}
    ${gstOn && supply.known ? `<div><b>Place of supply:</b> ${esc(supply.partyState)}</div>` : ""}${salespersonName ? `<div><b>Salesperson:</b> ${esc(salespersonName)}</div>` : ""}${customRows}</div></div>
  <table><thead><tr><th>#</th><th>Item &amp; Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th>${gstOn ? '<th class="r">GST</th>' : ""}<th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot"><tr><td>Sub Total</td><td class="r">${inr(totals.grossSubtotal)}</td></tr>
    ${totals.discountTotal ? `<tr><td>Discount</td><td class="r">- ${inr(totals.discountTotal)}</td></tr>` : ""}
    ${taxRows}${otherRows}${totals.roundOff ? `<tr><td>Round off</td><td class="r">${inr(totals.roundOff)}</td></tr>` : ""}
    <tr class="grand"><td>Total</td><td class="r">${inr(totals.total)}</td></tr></table>
  <div class="words"><b>Total in words:</b> ${esc(amountInWords(totals.total))}</div>
  ${notes ? `<div class="box"><b>Notes</b>\n${esc(notes)}</div>` : ""}${termsText ? `<div class="box"><b>Terms &amp; Conditions</b>\n${esc(termsText)}</div>` : ""}
  </body></html>`;
}

export function printHtml(html) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } finally { setTimeout(() => iframe.remove(), 3000); } }, 400);
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
        <button onClick={() => printHtml(info.html)} className={btn}>Print / Save as PDF</button>
        {!first && <button onClick={share} className={btn}>{navigator.share ? "Share…" : copied ? "Copied ✓" : "Copy message"}</button>}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">The message carries the invoice number, amount and due date. To send the invoice itself, choose Print / Save as PDF and attach it.</p>
      <button onClick={onClose} className="w-full mt-3 bg-black text-white rounded py-2.5 text-sm font-medium">Done</button>
    </Modal>
  );
}

/* ---------- the invoice form ---------- */
export function InvoiceForm({ businessId, ledgers, items, vtype, business, initial, convertFrom, onCancel, onSaved, showToast, reload, onOpenLightbox }) {
  const isEdit = !!initial && !convertFrom;
  const sys = sysMap(ledgers);
  const customFields = Array.isArray(business?.settings?.custom_invoice_fields) ? business.settings.custom_invoice_fields : [];
  const keyRef = useRef(0);
  const blankLine = () => ({ key: ++keyRef.current, item_id: "", description: "", hsn_sac: "", qty: 1, rate: 0, gstRate: 0, otherTaxes: [] });
  const fromRow = (r) => ({
    key: ++keyRef.current, item_id: r.item_id || "", description: r.description || "", hsn_sac: r.hsn_sac || "", qty: Number(r.qty) || 0, rate: Number(r.rate) || 0, gstRate: Number(r.gst_rate) || 0,
    otherTaxes: Array.isArray(r.extra?.other_taxes) && r.extra.other_taxes.length ? r.extra.other_taxes.map((t) => ({ name: t.name, rate: t.rate })) : (Number(r.other_tax_rate) > 0 ? [{ name: "Other tax", rate: Number(r.other_tax_rate) }] : []),
  });
  const v0 = initial?.voucher; const m0 = v0?.meta || {};

  const [partyId, setPartyId] = useState(v0?.party_ledger_id || "");
  const [vdate, setVdate] = useState(isEdit ? v0.vdate : todayISO());
  const [voucherNo, setVoucherNo] = useState(isEdit ? v0.voucher_no : "");
  const [poNumber, setPoNumber] = useState(v0?.po_number || "");
  const [narration, setNarration] = useState(v0?.narration || "");
  const [lineItems, setLineItems] = useState(initial?.items?.length ? initial.items.map(fromRow) : [blankLine()]);
  const [discountType, setDiscountType] = useState(m0.discount?.type || "percent");
  const [discountValue, setDiscountValue] = useState(m0.discount?.value || 0);
  const [extraTaxes, setExtraTaxes] = useState(m0.extra_taxes || []);
  const [terms, setTerms] = useState(m0.terms?.type || "receipt");
  const [customDays, setCustomDays] = useState(m0.terms?.days || 7);
  const [termsText, setTermsText] = useState(m0.terms_text ?? business?.settings?.default_terms ?? "");
  const [salespersonId, setSalespersonId] = useState(m0.salesperson_id || "");
  const [customValues, setCustomValues] = useState(m0.custom || {});
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
  const fileRef = useRef(null);
  const scanRef = useRef(null);

  useEffect(() => { if (!isEdit) api.nextVoucherNumber(businessId, vtype, vtype === "proforma_invoice" ? "PF-" : "INV-").then(setVoucherNo); }, [businessId, vtype, isEdit]);

  const party = ledgers.find((l) => l.id === partyId);
  const supply = detectSupplyType(business, party);
  const gstOn = !!business?.gst_applicable;
  const termDays = terms === "receipt" ? 0 : terms === "custom" ? Number(customDays) || 0 : Number(terms);
  const dueDate = addDays(vdate, termDays);

  const computeFor = (lines) => computeInvoiceTotals(lines.map((l) => ({ ...l, gstRate: gstOn ? l.gstRate : 0 })), { supplyType: supply.type, discountType, discountValue, extraTaxes });
  const totals = useMemo(() => computeFor(lineItems), [lineItems, supply.type, gstOn, discountType, discountValue, extraTaxes]);

  const setLine = (key, patch) => setLineItems((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineFromItem = (it) => ({ item_id: it.id, description: it.name, hsn_sac: it.hsn_sac || "", rate: Number(it.sale_rate) || 0, gstRate: Number(it.gst_rate) || 0, otherTaxes: Array.isArray(it.other_taxes) ? it.other_taxes : [] });
  const pickItem = (key, itemId) => { const it = items.find((x) => x.id === itemId); setLine(key, it ? lineFromItem(it) : { item_id: "", description: "" }); };
  const addBlank = () => setLineItems((ls) => [...ls, blankLine()]);
  const addItemLine = (it, qty = 1) => setLineItems((ls) => {
    const existing = ls.find((l) => l.item_id === it.id);
    if (existing) return ls.map((l) => (l.key === existing.key ? { ...l, qty: (Number(l.qty) || 0) + qty } : l));
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
    if (!partyId) { showToast("Select a customer first."); return; }
    if (!voucherNo.trim()) { showToast("Enter an invoice number."); return; }
    const validLines = lineItems.filter((l) => (l.item_id || (l.description || "").trim()) && Number(l.qty) > 0);
    if (mode === "final" && !validLines.length) { showToast("Add at least one item with a quantity."); return; }
    const t = computeFor(validLines.length ? validLines : lineItems);
    setSaving(true);
    try {
      let spName = "";
      if (salespersonId) { try { spName = (await api.fetchSalespersons(businessId)).find((s) => s.id === salespersonId)?.name || ""; } catch (e) { /* ignore */ } }
      const meta = { ...(v0?.meta || {}), status: mode, send_later: after === "later", discount: { type: discountType, value: Number(discountValue) || 0 }, extra_taxes: extraTaxes,
        terms: { type: terms, days: termDays }, due_date: dueDate, terms_text: termsText, salesperson_id: salespersonId || null, salesperson_name: spName, custom: customValues, place_of_supply: supply.known ? supply.partyState : null };
      if (convertFrom) meta.converted_from = convertFrom.id;
      delete meta.converted_to;
      const voucher = { id: isEdit ? v0.id : undefined, business_id: businessId, vtype, voucher_no: voucherNo.trim(), vdate, party_ledger_id: partyId, main_ledger_id: sys.sales,
        po_number: poNumber, narration, supply_type: supply.type, subtotal: t.subtotal, cgst: t.cgst, sgst: t.sgst, igst: t.igst, other_tax: t.otherTax, round_off: t.roundOff, total: t.total, meta };
      const apiItems = t.lines.map((l, i) => ({ line_no: i + 1, item_id: l.item_id || null, description: l.description, hsn_sac: l.hsn_sac, qty: l.qty, rate: l.rate, amount: l.amount,
        gst_rate: gstOn ? l.gstRate : 0, other_tax_rate: (l.otherTaxes || []).reduce((s, x) => s + (Number(x.rate) || 0), 0), cgst_amt: l.cgstAmt, sgst_amt: l.sgstAmt, igst_amt: l.igstAmt, other_tax_amt: l.otherTaxAmt,
        extra: { discount: l.discountAmt, other_taxes: l.otherTaxBreakdown || [] } }));
      const postLines = mode === "final" && vtype === "sales_invoice" ? buildSalesInvoiceLines({ partyLedgerId: partyId, salesLedgerId: sys.sales, gstLedgers: sys, invoiceTotals: t }) : [];
      const id = await api.saveVoucher(voucher, apiItems, postLines);
      for (const f of pendingFiles) { try { await api.uploadAttachment(businessId, id, f); } catch (e) { showToast(`Invoice saved, but ${f.name} could not be uploaded: ${e.message}`); } }
      if (convertFrom) { try { await api.updateVoucherMeta(convertFrom.id, { ...(convertFrom.meta || {}), converted_to: id }); } catch (e) { /* ignore */ } }

      const title = vtype === "proforma_invoice" ? "Proforma invoice" : "Invoice";
      const html = invoiceHtml({ business, party, vtype, voucherNo: voucherNo.trim(), vdate, dueDate, poNumber, totals: t, supply, notes: narration, termsText, custom: customValues, salespersonName: spName, gstOn });
      const text = `${title} ${voucherNo.trim()} dated ${fmtDate(vdate)} from ${business.name}: ${inr(t.total)}${termDays ? `, due by ${fmtDate(dueDate)}` : ", due on receipt"}. Thank you!`;
      if (mode === "draft") { showToast("Saved as draft"); onSaved(); }
      else if (after === "print") { printHtml(html); showToast(`${title} saved`); onSaved(); }
      else if (after === "send" || after === "share") { setDialog({ mode: after, party, html, text, subject: `${title} ${voucherNo.trim()} — ${inr(t.total)}` }); }
      else if (after === "later") { showToast(`${title} saved — marked to send later`); onSaved(); }
      else { showToast(`${title} saved`); onSaved(); }
    } catch (e) { showToast(e.message); }
    finally { setSaving(false); }
  };

  const th = "py-2 pr-2 text-xs font-medium text-gray-500 text-left";
  const title = vtype === "proforma_invoice" ? "Proforma Invoice" : "Tax Invoice";

  return (
    <div className="pb-24">
      <BackHeader title={isEdit ? `Edit ${title} ${v0.voucher_no}` : convertFrom ? "Convert to Tax Invoice" : `New ${title}`} onBack={onCancel} right={m0.status === "draft" ? <span className="text-xs bg-gray-100 px-2 py-1 rounded">Draft</span> : null} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5 max-w-5xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Customer *"><PartyPicker kind="customer" ledgers={ledgers} value={partyId} onChange={setPartyId} businessId={businessId} reload={reload} showToast={showToast} /></Field>
          <div className="text-xs text-gray-500 self-end pb-2">
            {!gstOn ? <span className="text-amber-700">GST is switched off for this business, so no GST is charged. Turn it on under Business Profile.</span>
              : !partyId ? "Place of supply is detected from the customer's state."
              : supply.known ? <>Place of supply: <b>{supply.partyState}</b> → <b>{supply.type === "inter" ? "IGST" : "CGST + SGST"}</b></>
              : <span className="text-amber-700">This customer's state isn't set, so CGST + SGST is applied. Add the state or GSTIN under Ledgers to detect IGST automatically.</span>}
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Invoice No."><input className={inputCls} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} /></Field>
          <Field label="Invoice date"><input type="date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Terms">
            <div className="flex gap-2">
              <select className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value)}>
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
        {customFields.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-3">
            {customFields.map((label) => <Field key={label} label={label}><input className={inputCls} value={customValues[label] || ""} onChange={(e) => setCustomValues((v) => ({ ...v, [label]: e.target.value }))} /></Field>)}
          </div>
        )}

        <div className="border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 gap-2 flex-wrap">
            <span className="text-sm font-semibold">Item Table</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <ScanLine size={15} className="text-blue-700" />
                <input ref={scanRef} className="text-sm border border-gray-300 rounded px-2 py-1 w-52" placeholder="Scan Item (RFID / code), Enter" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} />
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
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={th + " w-8 pl-3"}></th><th className={th + " w-[30%]"}>ITEM DETAILS</th><th className={th + " w-[11%]"}>HSN/SAC</th><th className={th + " w-[9%]"}>QUANTITY</th>
                  <th className={th + " w-[12%]"}>RATE</th>{gstOn && <th className={th + " w-[8%]"}>GST %</th>}<th className={th + " w-[14%] text-right"}>TOTAL</th><th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {totals.lines.map((l) => (
                  <tr key={l.key} className="border-b border-gray-100 align-top">
                    <td className="pl-3 pt-3"><input type="checkbox" checked={selected.includes(l.key)} onChange={() => toggleSel(l.key)} /></td>
                    <td className="py-1.5 pr-2">
                      <CreatablePicker options={items.map((it) => ({ id: it.id, label: it.name, sublabel: [it.group_name, it.item_code && `#${it.item_code}`].filter(Boolean).join(" · ") }))} value={l.item_id} onChange={(id) => pickItem(l.key, id)} placeholder="Type or click to select an item" />
                      {(l.otherTaxBreakdown || []).length > 0 && <div className="text-[10px] text-gray-400 mt-0.5">+ {l.otherTaxBreakdown.map((t) => `${t.name} ${inr(t.amount)}`).join(", ")}</div>}
                    </td>
                    <td className="py-1.5 pr-2"><input className={inputCls} value={l.hsn_sac} onChange={(e) => setLine(l.key, { hsn_sac: e.target.value })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" className={inputCls + " text-right"} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value === "" ? "" : parseFloat(e.target.value) })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" className={inputCls + " text-right"} value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value === "" ? "" : parseFloat(e.target.value) })} /></td>
                    {gstOn && <td className="py-1.5 pr-2"><input type="number" className={inputCls + " text-right"} value={l.gstRate} onChange={(e) => setLine(l.key, { gstRate: parseFloat(e.target.value) || 0 })} /></td>}
                    <td className="py-1.5 pr-2 pt-3 text-right tabnum font-medium">{inr(l.amount)}</td>
                    <td className="pt-3"><button onClick={() => setLineItems((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 flex gap-2">
            <button type="button" onClick={addBlank} className="text-sm bg-blue-50 text-blue-700 font-medium rounded px-3 py-1.5 flex items-center gap-1"><Plus size={14} /> Add New Row</button>
            <button type="button" onClick={() => setBulkModal(true)} className="text-sm bg-blue-50 text-blue-700 font-medium rounded px-3 py-1.5 flex items-center gap-1"><Plus size={14} /> Add Items in Bulk</button>
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
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2 self-start">
            <div className="flex justify-between"><span>Sub Total</span><span className="tabnum font-medium">{inr(totals.grossSubtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>Discount</span>
              <div className="flex items-center gap-1">
                <input type="number" min="0" className="w-20 border border-gray-300 rounded px-2 py-1 text-right" value={discountValue} onChange={(e) => setDiscountValue(e.target.value === "" ? "" : parseFloat(e.target.value))} />
                <select className="border border-gray-300 rounded px-1 py-1" value={discountType} onChange={(e) => setDiscountType(e.target.value)}><option value="percent">%</option><option value="amount">₹</option></select>
              </div>
              <span className="tabnum w-24 text-right">{totals.discountTotal ? `- ${inr(totals.discountTotal)}` : "—"}</span>
            </div>
            {totals.discountTotal > 0 && <div className="flex justify-between text-gray-500"><span>Taxable value</span><span className="tabnum">{inr(totals.subtotal)}</span></div>}
            {gstOn && (supply.type === "inter"
              ? <div className="flex justify-between"><span>IGST</span><span className="tabnum">{inr(totals.igst)}</span></div>
              : <><div className="flex justify-between"><span>CGST</span><span className="tabnum">{inr(totals.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span className="tabnum">{inr(totals.sgst)}</span></div></>)}
            <div>
              <div className="flex justify-between items-center"><span>Other Taxes</span><button type="button" onClick={() => setExtraTaxes((x) => [...x, { name: "", rate: 0 }])} className="text-xs text-blue-700 font-medium">+ Add tax</button></div>
              {extraTaxes.map((t, i) => (
                <div key={i} className="flex gap-1 mt-1 items-center">
                  <input className="flex-1 border border-gray-300 rounded px-2 py-1" placeholder="Name (e.g. TCS)" value={t.name} onChange={(e) => setExtraTaxes((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input type="number" className="w-16 border border-gray-300 rounded px-2 py-1 text-right" placeholder="%" value={t.rate} onChange={(e) => setExtraTaxes((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} />
                  <button type="button" onClick={() => setExtraTaxes((x) => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={14} /></button>
                </div>
              ))}
              {totals.otherTaxSummary.map((t) => <div key={t.name} className="flex justify-between text-gray-600"><span>{t.name}</span><span className="tabnum">{inr(t.amount)}</span></div>)}
            </div>
            <div className="flex justify-between text-gray-400"><span>Round off</span><span className="tabnum">{inr(totals.roundOff)}</span></div>
            <div className="flex justify-between font-semibold text-base border-t border-gray-300 pt-2"><span>Total (₹)</span><span className="tabnum">{inr(totals.total)}</span></div>
            <p className="text-[11px] text-gray-400">{amountInWords(totals.total)}</p>
          </div>
        </div>
      </div>

      <div className="fixed bottom-14 md:bottom-0 left-0 right-0 md:left-56 z-30 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2">
        <button disabled={saving} onClick={() => save("draft", null)} className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:border-black disabled:opacity-50">Save as Draft</button>
        <div className="relative flex">
          <button disabled={saving} onClick={() => save("final", "send")} className="bg-blue-600 text-white rounded-l px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving…" : "Save and Send"}</button>
          <button disabled={saving} onClick={() => setSaveMenu((o) => !o)} className="bg-blue-600 text-white rounded-r px-2 border-l border-blue-400 hover:bg-blue-700"><ChevronDown size={15} /></button>
          {saveMenu && (
            <div className="absolute bottom-full mb-1 left-0 w-52 bg-white border border-gray-200 rounded-lg shadow-lg text-sm z-40">
              <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "print")}>Save and Print</button>
              <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "share")}>Save and Share</button>
              <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => save("final", "later")}>Save and Send Later</button>
            </div>
          )}
        </div>
        <button onClick={onCancel} className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:border-black">Cancel</button>
        <div className="ml-auto text-right text-xs text-gray-500">Total Amount: <b className="text-sm text-black">{inr(totals.total)}</b></div>
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
