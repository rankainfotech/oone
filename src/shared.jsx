import React, { useState, useRef, useEffect } from "react";
import { Camera, ImagePlus, X, ArrowLeft } from "lucide-react";

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const inr = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return (neg ? "-₹" : "₹") + s;
};

export const inputCls = "w-full font-body text-sm bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black transition-shadow";

export function Field({ label, children }) {
  return <div><label className="text-xs font-medium text-gray-500 font-body block mb-1.5">{label}</label>{children}</div>;
}

export function BackHeader({ title, onBack, right }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <button onClick={onBack} className="text-gray-500 hover:text-black"><ArrowLeft size={18} /></button>
      <h2 className="font-display text-xl flex-1">{title}</h2>
      {right}
    </div>
  );
}

function compressImage(file, maxW = 480, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PhotoPicker({ value, onChange, label }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try { onChange(await compressImage(f)); } finally { setBusy(false); e.target.value = ""; }
  };
  return (
    <div>
      {label && <label className="text-xs font-medium text-gray-500 font-body block mb-1.5">{label}</label>}
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-md overflow-hidden bg-gray-100 border border-gray-300 flex items-center justify-center shrink-0">
          {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-gray-400" />}
        </div>
        <button type="button" onClick={() => camRef.current?.click()} className="text-xs font-body font-medium px-2.5 py-1.5 rounded border border-black flex items-center gap-1.5 hover:bg-black hover:text-white">
          <Camera size={13} /> {busy ? "…" : "Camera"}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-body font-medium px-2.5 py-1.5 rounded border border-gray-300 text-gray-600 hover:border-black">Upload</button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

export function Lightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out">
      <img src={url} className="max-h-[90vh] max-w-[90vw] rounded shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={26} /></button>
    </div>
  );
}

/** Type-to-search picker over any list of {id,label,sublabel} */
export function SearchPicker({ options, value, onChange, placeholder = "Type to search…" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onClickOutside(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q.length === 0 ? options.slice(0, 30) : options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel || "").toLowerCase().includes(q)).slice(0, 30);

  return (
    <div ref={wrapRef} className="relative">
      {selected ? (
        <div className={inputCls + " flex items-center justify-between"}>
          <span>{selected.label}{selected.sublabel ? ` · ${selected.sublabel}` : ""}</span>
          <button type="button" onClick={() => { onChange(""); setQuery(""); }} className="text-gray-400 hover:text-black ml-2 shrink-0"><X size={15} /></button>
        </div>
      ) : (
        <input className={inputCls} placeholder={placeholder} value={query} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
      )}
      {open && !selected && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {matches.length === 0 ? <p className="text-xs text-gray-400 font-body px-3 py-3">No matches.</p> : matches.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setQuery(""); setOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm font-body hover:bg-gray-50 border-b border-gray-100 last:border-0">
              <div className="font-medium">{o.label}</div>
              {o.sublabel && <div className="text-xs text-gray-400">{o.sublabel}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
