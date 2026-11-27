import React, { useState } from "react";
import { inputCls, Field, BackHeader } from "../../shared";
import { LEDGER_GROUPS, INDIAN_STATES, validateGstin } from "./calc";

/** A small note under a GSTIN box: valid (with the state it names) or what looks wrong. */
export function GstinHint({ value }) {
  const r = validateGstin(value);
  if (!String(value || "").trim() || r.empty) return null;
  return r.valid ? <p className="text-[11px] text-green-700 mt-1" aria-label="GSTIN check">✓ Valid GSTIN · {r.state}</p> : <p className="text-[11px] text-amber-700 mt-1" aria-label="GSTIN check">Check this GSTIN: {r.reason}</p>;
}

export function emptyLedger(kind) {
  return { id: null, kind, name: "", group_key: kind === "customer" ? "sundry_debtors" : kind === "vendor" ? "sundry_creditors" : "current_assets",
    opening_balance: 0, opening_side: "Dr", contact_person: "", mobile: "", email: "", gst_type: "unregistered", gstin: "", pan: "",
    msme: "", other_registrations: "", office_no: "", building_name: "", street_name: "", city: "", state: "", country: "India", pin_code: "",
    bank_details: { bank_name: "", account_number: "", ifsc: "" } };
}

/** Every field of a customer / vendor / other ledger. `set(key, value)` updates one field. */
export function LedgerFormBody({ l, set }) {
  const isParty = l.kind === "customer" || l.kind === "vendor";
  const states = l.state && !INDIAN_STATES.includes(l.state) ? [l.state, ...INDIAN_STATES] : INDIAN_STATES;
  return (
    <div className="space-y-4">
      <Field label="Name / Company name *"><input aria-label="Name" className={inputCls} value={l.name} onChange={(e) => set("name", e.target.value)} /></Field>
      {!isParty && (
        <Field label="Group">
          <select aria-label="Ledger group" className={inputCls} value={l.group_key} onChange={(e) => set("group_key", e.target.value)}>
            {LEDGER_GROUPS.filter((g) => !["sundry_debtors", "sundry_creditors"].includes(g.key)).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
        </Field>
      )}
      {isParty && (
        <>
          <Field label="Contact person name"><input aria-label="Contact person" className={inputCls} value={l.contact_person} onChange={(e) => set("contact_person", e.target.value)} /></Field>
          <Field label="Mobile (required, must be unique in this business)"><input aria-label="Mobile" className={inputCls} value={l.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
          <Field label="Email"><input aria-label="Email" className={inputCls} value={l.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GSTN status">
              <select aria-label="GST status" className={inputCls} value={l.gst_type} onChange={(e) => set("gst_type", e.target.value)}>
                <option value="unregistered">Unregistered</option><option value="registered">Registered</option><option value="consumer">Consumer</option>
              </select>
            </Field>
            <Field label="GSTIN"><input aria-label="GSTIN" className={inputCls} value={l.gstin} onChange={(e) => { const v = e.target.value.toUpperCase(); set("gstin", v); const r = validateGstin(v); if (r.valid) { if (!l.state) set("state", r.state); if (!l.pan) set("pan", r.pan); } }} /><GstinHint value={l.gstin} /></Field>
          </div>
          <Field label="PAN"><input aria-label="PAN" className={inputCls} value={l.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
          {l.kind === "vendor" && (
            <>
              <Field label="MSME / other registrations"><input aria-label="MSME or other registrations" className={inputCls} value={l.msme} onChange={(e) => set("msme", e.target.value)} /></Field>
              <div className="grid grid-cols-3 gap-2">
                <input aria-label="Bank name" placeholder="Bank name" className={inputCls} value={l.bank_details?.bank_name || ""} onChange={(e) => set("bank_details", { ...l.bank_details, bank_name: e.target.value })} />
                <input aria-label="Account number" placeholder="Account no." className={inputCls} value={l.bank_details?.account_number || ""} onChange={(e) => set("bank_details", { ...l.bank_details, account_number: e.target.value })} />
                <input aria-label="IFSC" placeholder="IFSC" className={inputCls} value={l.bank_details?.ifsc || ""} onChange={(e) => set("bank_details", { ...l.bank_details, ifsc: e.target.value })} />
              </div>
            </>
          )}
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-2">Address</p>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Office or flat no." placeholder="Office/Flat No." className={inputCls} value={l.office_no} onChange={(e) => set("office_no", e.target.value)} />
              <input aria-label="Building" placeholder="Building" className={inputCls} value={l.building_name} onChange={(e) => set("building_name", e.target.value)} />
              <input aria-label="Street" placeholder="Street" className={inputCls} value={l.street_name} onChange={(e) => set("street_name", e.target.value)} />
              <input aria-label="City" placeholder="City" className={inputCls} value={l.city} onChange={(e) => set("city", e.target.value)} />
              <select aria-label="State" className={inputCls} value={l.state} onChange={(e) => set("state", e.target.value)} title="The state decides IGST or CGST + SGST">
                <option value="">State…</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input aria-label="Pin code" placeholder="Pin code" className={inputCls} value={l.pin_code} onChange={(e) => set("pin_code", e.target.value)} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">The state (or the first two digits of the GSTIN) decides whether a bill gets IGST or CGST + SGST.</p>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opening balance"><input aria-label="Opening balance" type="number" className={inputCls} value={l.opening_balance} onChange={(e) => set("opening_balance", parseFloat(e.target.value) || 0)} /></Field>
        <Field label="Side"><select aria-label="Opening side" className={inputCls} value={l.opening_side} onChange={(e) => set("opening_side", e.target.value)}><option value="Dr">Dr</option><option value="Cr">Cr</option></select></Field>
      </div>
    </div>
  );
}

export function ledgerFormInvalid(l) {
  const isParty = l.kind === "customer" || l.kind === "vendor";
  return !String(l.name || "").trim() || (isParty && !String(l.mobile || "").trim());
}

export function LedgerForm({ existing, onCancel, onSave }) {
  const [l, setL] = useState(existing);
  const set = (k, v) => setL((p) => ({ ...p, [k]: v }));
  return (
    <div className="max-w-lg">
      <BackHeader title={existing.id ? "Edit ledger" : `New ${l.kind}`} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <LedgerFormBody l={l} set={set} />
        <button onClick={() => onSave(l)} disabled={ledgerFormInvalid(l)} className="w-full bg-black disabled:opacity-40 text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}
