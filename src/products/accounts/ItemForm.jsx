import React, { useState, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { inputCls, Field, BackHeader, PhotoPicker } from "../../shared";
import { slugKey } from "./calc";

export function emptyItem() {
  return { id: null, item_type: "product", name: "", item_code: "", unit: "", hsn_sac: "", affects_inventory: false, gst_rate: 0, other_taxes: [], attributes: [],
    opening_qty: 0, opening_amount: 0, group_name: "", rfid: "", sale_rate: "", purchase_rate: "", image: "" };
}

export function ItemForm({ existing, onCancel, onSave, groups = [], attrNames = [] }) {
  const [it, setIt] = useState({ ...existing, other_taxes: Array.isArray(existing.other_taxes) ? existing.other_taxes : [], attributes: Array.isArray(existing.attributes) ? existing.attributes : [] });
  const [newGroup, setNewGroup] = useState(false);
  const [scanning, setScanning] = useState(false);
  const rfidRef = useRef(null);
  const set = (k, v) => setIt((p) => ({ ...p, [k]: v }));
  const num = (v) => (v === "" || v === null || v === undefined ? "" : v);
  const setTax = (i, patch) => set("other_taxes", it.other_taxes.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setAttr = (i, patch) => set("attributes", it.attributes.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const startScan = () => { setScanning(true); setTimeout(() => rfidRef.current?.focus(), 50); };

  const submit = () => {
    const taxes = it.other_taxes.filter((t) => (t.name || "").trim() || Number(t.rate) > 0).map((t) => ({ name: (t.name || "").trim() || "Other tax", rate: Number(t.rate) || 0 }));
    const attributes = it.attributes.filter((a) => (a.label || "").trim()).map((a) => ({ key: slugKey(a.label), label: a.label.trim(), value: a.value ?? "", show: !!a.show }));
    onSave({ ...it, other_taxes: taxes, other_tax_rate: taxes.reduce((s, t) => s + t.rate, 0), attributes });
  };

  return (
    <div className="max-w-lg">
      <BackHeader title={existing.id ? "Edit item" : "New product / service"} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <PhotoPicker label="Image" value={it.image} onChange={(v) => set("image", v)} />

        <Field label="This is a">
          <div className="flex gap-2">
            {["product", "service"].map((t) => (
              <button key={t} type="button" aria-pressed={it.item_type === t} onClick={() => set("item_type", t)}
                className={`flex-1 py-2 rounded border text-sm font-medium capitalize ${it.item_type === t ? "bg-black text-white border-black" : "bg-white text-gray-600 border-gray-300 hover:border-black"}`}>{t}</button>
            ))}
          </div>
        </Field>

        <Field label="Name *"><input aria-label="Item name" className={inputCls} value={it.name} onChange={(e) => set("name", e.target.value)} /></Field>

        <Field label="Group (e.g. Necklace, Bracelet)">
          {!newGroup ? (
            <div className="flex gap-2">
              <select aria-label="Item group" className={inputCls} value={it.group_name || ""} onChange={(e) => set("group_name", e.target.value)}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <button type="button" onClick={() => setNewGroup(true)} className="text-xs underline whitespace-nowrap">+ New group</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input autoFocus aria-label="New group name" className={inputCls} placeholder="New group name" value={it.group_name || ""} onChange={(e) => set("group_name", e.target.value)} />
              <button type="button" onClick={() => setNewGroup(false)} className="text-xs underline whitespace-nowrap">Pick existing</button>
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Item number / code"><input className={inputCls} value={it.item_code || ""} onChange={(e) => set("item_code", e.target.value)} /></Field>
          <Field label="Unit"><input className={inputCls} value={it.unit || ""} onChange={(e) => set("unit", e.target.value)} placeholder="pcs, kg, gm, hr…" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HSN/SAC"><input className={inputCls} value={it.hsn_sac || ""} onChange={(e) => set("hsn_sac", e.target.value)} /></Field>
          <Field label="GST %"><input type="number" aria-label="GST percent" className={inputCls} value={it.gst_rate} onChange={(e) => set("gst_rate", parseFloat(e.target.value) || 0)} /></Field>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Additional details</label>
          <p className="text-[11px] text-gray-400 mb-2">Anything specific to this product, such as Unique Product ID, Carat, Purity or Weight. Tick <b>Show on invoice</b> for the ones that should appear on the bill.</p>
          <datalist id="attr-names">{attrNames.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="space-y-2">
            {it.attributes.map((a, i) => (
              <div key={i} className="border border-gray-200 rounded p-2 space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <input list="attr-names" aria-label={`Detail name ${i + 1}`} className={inputCls} placeholder="Field name (e.g. Carat)" value={a.label} onChange={(e) => setAttr(i, { label: e.target.value })} />
                  <input aria-label={`Detail value ${i + 1}`} className={inputCls} placeholder="Value (e.g. 22)" value={a.value ?? ""} onChange={(e) => setAttr(i, { value: e.target.value })} />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`Show detail ${i + 1} on invoice`} checked={!!a.show} onChange={(e) => setAttr(i, { show: e.target.checked })} /> Show on invoice</label>
                  <button type="button" aria-label={`Remove detail ${i + 1}`} onClick={() => set("attributes", it.attributes.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => set("attributes", [...it.attributes, { label: "", value: "", show: true }])} className="mt-2 text-xs underline flex items-center gap-1"><Plus size={12} /> Add detail</button>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Other taxes on this product (optional)</label>
          {it.other_taxes.length === 0 && <p className="text-xs text-gray-400 mb-2">None added.</p>}
          <div className="space-y-2">
            {it.other_taxes.map((t, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input aria-label={`Tax name ${i + 1}`} className={inputCls} placeholder="Tax name (e.g. Cess)" value={t.name} onChange={(e) => setTax(i, { name: e.target.value })} />
                <input aria-label={`Tax rate ${i + 1}`} type="number" className={inputCls + " !w-24"} placeholder="%" value={t.rate} onChange={(e) => setTax(i, { rate: e.target.value })} />
                <button type="button" aria-label={`Remove tax ${i + 1}`} onClick={() => set("other_taxes", it.other_taxes.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => set("other_taxes", [...it.other_taxes, { name: "", rate: 0 }])} className="mt-2 text-xs underline flex items-center gap-1"><Plus size={12} /> Add tax</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sale rate"><input type="number" aria-label="Sale rate" className={inputCls} value={num(it.sale_rate)} onChange={(e) => set("sale_rate", e.target.value === "" ? "" : parseFloat(e.target.value))} /></Field>
          <Field label="Purchase rate"><input type="number" aria-label="Purchase rate" className={inputCls} value={num(it.purchase_rate)} onChange={(e) => set("purchase_rate", e.target.value === "" ? "" : parseFloat(e.target.value))} /></Field>
        </div>

        <div className="flex items-center gap-2"><input type="checkbox" id="affinv" checked={it.affects_inventory} onChange={(e) => set("affects_inventory", e.target.checked)} /><label htmlFor="affinv" className="text-sm">Affects inventory</label></div>
        {it.affects_inventory && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening quantity"><input type="number" className={inputCls} value={it.opening_qty} onChange={(e) => set("opening_qty", parseFloat(e.target.value) || 0)} /></Field>
            <Field label="Opening value (₹)"><input type="number" className={inputCls} value={it.opening_amount} onChange={(e) => set("opening_amount", parseFloat(e.target.value) || 0)} /></Field>
          </div>
        )}

        <Field label="RFID tag (optional)">
          <div className="flex gap-2">
            <input ref={rfidRef} aria-label="RFID tag" className={inputCls} value={it.rfid || ""} onChange={(e) => set("rfid", e.target.value)} onBlur={() => setScanning(false)} placeholder={scanning ? "Ready — scan the tag now…" : "Tag ID"} />
            <button type="button" onClick={startScan} className="text-xs font-medium px-3 border border-black rounded whitespace-nowrap hover:bg-black hover:text-white">Scan RFID</button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Works with USB / keyboard-type RFID readers: tap Scan, then scan the tag and its ID is typed in. Other reader types need separate hardware integration.</p>
        </Field>

        <button onClick={submit} disabled={!it.name.trim()} className="w-full bg-black disabled:opacity-40 text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}
