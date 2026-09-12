import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LayoutDashboard, Users, HandCoins, Wallet, FileBarChart2, UserCog,
  Camera, Plus, ArrowLeft, LogOut, Search, X, ChevronRight,
  ImagePlus, CalendarRange, ShieldCheck, Pencil, ShieldAlert, Ban, CheckCircle2,
  Trash2, Landmark, MessageCircle, Download, AlertTriangle, KeyRound, Building2
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { LOGO_DATA_URI } from "./logo";
import * as XLSX from "xlsx";

/* ---------------- Theme: white & grey, black text ---------------- */
const FONT_STYLE = `
  :root{
    --ink:#111114; --ink-soft:#5B5F66;
    --paper:#FFFFFF; --paper-dim:#F3F4F6;
    --brass:#52555C; --brass-dark:#2E3036;
    --green:#1F7A4D; --green-dark:#15613C;
    --red:#B3261E;
    --amber:#8A5A00;
    --line:#E4E5E8;
  }
  .font-display{ font-family:'Fraunces', Georgia, serif; }
  .font-body{ font-family:'Inter', system-ui, sans-serif; }
  .tabnum{ font-variant-numeric: tabular-nums; }
  .ledger-rule{ border-bottom: 1px solid var(--line); }
  .ledger-total{ border-bottom: 3px double var(--ink); }
`;

const inr = (n) => {
  const v = Math.round((n || 0) * 100) / 100;
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return (neg ? "-₹" : "₹") + s;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const digitsOnly = (s) => (s || "").replace(/\D/g, "");
const waLink = (mobile, message) => {
  const d = digitsOnly(mobile);
  const withCountry = d.length === 10 ? "91" + d : d;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
};

function fyRange(ref = new Date()) {
  const y = ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1;
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}
function interestForPeriod(principal, ratePA, days, type) {
  if (principal <= 0 || days <= 0) return 0;
  if (type === "compound") {
    const months = days / 30;
    return principal * (Math.pow(1 + ratePA / 1200, months) - 1);
  }
  return (principal * ratePA * days) / 100 / 365;
}

// Simulate an item's payoff history; also tags each receipt with shortfall/excess
function computeItemState(item, itemReceipts, asOfISO) {
  const sorted = [...itemReceipts].sort((a, b) => (a.date < b.date ? -1 : 1));
  let balance = item.principal;
  let unpaidInterest = 0;
  let lastDate = item.date;
  const receiptTags = [];

  for (const r of sorted) {
    if (r.date > asOfISO) continue;
    const days = daysBetween(lastDate, r.date);
    const accrued = interestForPeriod(balance, item.rate, days, item.interestType);
    unpaidInterest += accrued;
    const dueBeforePayment = unpaidInterest;
    const diff = (r.interestPaid || 0) - dueBeforePayment;
    receiptTags.push({ receiptId: r.id, shortfall: diff < -1 ? -diff : 0, excess: diff > 1 ? diff : 0 });
    unpaidInterest -= r.interestPaid || 0;
    balance -= r.principalPaid || 0;
    lastDate = r.date;
  }
  const tailDays = daysBetween(lastDate, asOfISO);
  if (tailDays > 0 && balance > 0.005) {
    unpaidInterest += interestForPeriod(balance, item.rate, tailDays, item.interestType);
  }
  return {
    balance: Math.max(0, balance),
    unpaidInterest: Math.max(0, unpaidInterest),
    lastActivity: lastDate,
    isClosed: balance <= 0.5,
    receiptTags,
  };
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

/* ---------------- Small shared UI ---------------- */
function Field({ label, children }) {
  return <div><label className="text-xs font-medium text-[var(--ink-soft)] font-body block mb-1.5">{label}</label>{children}</div>;
}
const inputCls = "w-full font-body text-sm bg-white border border-[var(--line)] rounded px-3 py-2 text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/25 focus:border-[var(--ink)] transition-shadow";

function LightboxContext(url, setUrl) {
  return { open: (u) => setUrl(u) };
}
function Lightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out">
      <img src={url} className="max-h-[90vh] max-w-[90vw] rounded shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={26} /></button>
    </div>
  );
}
function Thumb({ src, size = "w-14 h-14", onOpen, placeholder }) {
  return (
    <button type="button" onClick={() => src && onOpen(src)} className={`${size} rounded-md overflow-hidden bg-[var(--paper-dim)] border border-[var(--line)] flex items-center justify-center shrink-0 ${src ? "cursor-zoom-in" : ""}`}>
      {src ? <img src={src} className="w-full h-full object-cover" /> : (placeholder || <ImagePlus size={18} className="text-[var(--ink-soft)] opacity-40" />)}
    </button>
  );
}

function PhotoPicker({ value, onChange, label }) {
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
      <label className="text-xs font-medium text-[var(--ink-soft)] font-body block mb-1.5">{label}</label>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-md overflow-hidden bg-[var(--paper-dim)] border border-[var(--line)] flex items-center justify-center shrink-0">
          {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <ImagePlus size={20} className="text-[var(--ink-soft)] opacity-40" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => camRef.current?.click()} className="text-xs font-body font-medium px-3 py-1.5 rounded border border-[var(--ink)] flex items-center gap-1.5 hover:bg-[var(--ink)] hover:text-white transition-colors">
            <Camera size={13} /> {busy ? "Processing…" : "Camera"}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-body font-medium px-3 py-1.5 rounded border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink)] transition-colors">
            Upload file
          </button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

/* ---------------- Data layer (Supabase) ---------------- */
const mapCustomer = (r) => ({
  id: r.id, name: r.name, photo: r.photo, mobile: r.mobile, dob: r.dob, rate: r.rate, interestType: r.interest_type,
  govtIdNumber: r.govt_id_number, govtIdPhoto: r.govt_id_photo,
  flatNo: r.flat_no, buildingName: r.building_name, roadName: r.road_name, area: r.area,
  city: r.city, state: r.state, country: r.country, pinCode: r.pin_code, addressLegacy: r.address,
});
const mapItem = (r) => ({ id: r.id, customerId: r.customer_id, date: r.date, principal: Number(r.principal), description: r.description, photo: r.photo, rate: Number(r.rate), interestType: r.interest_type, paymentMode: r.payment_mode, bankAccountId: r.bank_account_id });
const mapReceipt = (r) => ({ id: r.id, itemId: r.item_id, customerId: r.customer_id, date: r.date, principalPaid: Number(r.principal_paid), interestPaid: Number(r.interest_paid), paymentMode: r.payment_mode, bankAccountId: r.bank_account_id });
const mapBank = (r) => ({ id: r.id, bankName: r.bank_name, accountNumber: r.account_number, ifsc: r.ifsc, branch: r.branch });
const mapTenant = (r) => ({
  id: r.id, businessName: r.business_name, status: r.status, isPaid: r.is_paid,
  email: r.email, contactNo: r.contact_no, pan: r.pan, gstn: r.gstn,
  officeNo: r.office_no, buildingName: r.building_name, roadName: r.road_name, area: r.area,
  city: r.city, state: r.state, country: r.country, pinCode: r.pin_code,
});

function addressString(o) {
  return [o.flatNo, o.buildingName, o.roadName, o.area, o.city, o.state, o.country, o.pinCode].filter(Boolean).join(", ");
}

async function fetchCustomers() { const { data, error } = await supabase.from("customers").select("*").order("name"); if (error) throw error; return data.map(mapCustomer); }
async function fetchItems() { const { data, error } = await supabase.from("items").select("*"); if (error) throw error; return data.map(mapItem); }
async function fetchReceipts() { const { data, error } = await supabase.from("receipts").select("*"); if (error) throw error; return data.map(mapReceipt); }
async function fetchBankAccounts() { const { data, error } = await supabase.from("bank_accounts").select("*").order("bank_name"); if (error) throw error; return data.map(mapBank); }

async function findCustomerByMobile(mobile, excludeId) {
  const { data, error } = await supabase.from("customers").select("id,name,mobile").eq("mobile", mobile);
  if (error) throw error;
  return data.find((r) => r.id !== excludeId) || null;
}

async function upsertCustomer(c) {
  const row = {
    name: c.name, photo: c.photo, mobile: c.mobile, dob: c.dob || null, rate: c.rate, interest_type: c.interestType,
    govt_id_number: c.govtIdNumber || null, govt_id_photo: c.govtIdPhoto || null,
    flat_no: c.flatNo || null, building_name: c.buildingName || null, road_name: c.roadName || null, area: c.area || null,
    city: c.city || null, state: c.state || null, country: c.country || null, pin_code: c.pinCode || null,
    address: addressString(c),
  };
  if (c.id) { const { error } = await supabase.from("customers").update(row).eq("id", c.id); if (error) throw error; return c.id; }
  const { data, error } = await supabase.from("customers").insert(row).select().single();
  if (error) throw error; return data.id;
}
async function deleteCustomerSafely(id) {
  const { data, error } = await supabase.from("items").select("id").eq("customer_id", id).limit(1);
  if (error) throw error;
  if (data.length > 0) return { blocked: true };
  const { error: delErr } = await supabase.from("customers").delete().eq("id", id);
  if (delErr) throw delErr;
  return { blocked: false };
}

async function insertItem(item) {
  const row = { customer_id: item.customerId, date: item.date, principal: item.principal, description: item.description, photo: item.photo, rate: item.rate, interest_type: item.interestType, payment_mode: item.paymentMode || "cash", bank_account_id: item.bankAccountId || null };
  const { error } = await supabase.from("items").insert(row);
  if (error) throw error;
}
async function updateItemRow(id, item) {
  const row = { date: item.date, principal: item.principal, description: item.description, photo: item.photo, rate: item.rate, interest_type: item.interestType, payment_mode: item.paymentMode || "cash", bank_account_id: item.bankAccountId || null };
  const { error } = await supabase.from("items").update(row).eq("id", id);
  if (error) throw error;
}
async function deleteItemSafely(id) {
  const { data, error } = await supabase.from("receipts").select("id").eq("item_id", id).limit(1);
  if (error) throw error;
  if (data.length > 0) return { blocked: true };
  const { error: delErr } = await supabase.from("items").delete().eq("id", id);
  if (delErr) throw delErr;
  return { blocked: false };
}

async function insertReceipt(r) {
  const row = { item_id: r.itemId, customer_id: r.customerId, date: r.date, principal_paid: r.principalPaid, interest_paid: r.interestPaid, payment_mode: r.paymentMode || "cash", bank_account_id: r.bankAccountId || null };
  const { error } = await supabase.from("receipts").insert(row);
  if (error) throw error;
}
async function updateReceiptRow(id, r) {
  const row = { date: r.date, principal_paid: r.principalPaid, interest_paid: r.interestPaid, payment_mode: r.paymentMode || "cash", bank_account_id: r.bankAccountId || null };
  const { error } = await supabase.from("receipts").update(row).eq("id", id);
  if (error) throw error;
}
async function deleteReceiptRow(id) { const { error } = await supabase.from("receipts").delete().eq("id", id); if (error) throw error; }

async function upsertBankAccount(b) {
  const row = { bank_name: b.bankName, account_number: b.accountNumber, ifsc: b.ifsc, branch: b.branch };
  if (b.id) { const { error } = await supabase.from("bank_accounts").update(row).eq("id", b.id); if (error) throw error; return b.id; }
  const { data, error } = await supabase.from("bank_accounts").insert(row).select().single();
  if (error) throw error; return data.id;
}
async function deleteBankAccount(id) { const { error } = await supabase.from("bank_accounts").delete().eq("id", id); if (error) throw error; }

async function updateTenantRow(id, t) {
  const row = {
    business_name: t.businessName, email: t.email, contact_no: t.contactNo, pan: t.pan, gstn: t.gstn,
    office_no: t.officeNo, building_name: t.buildingName, road_name: t.roadName, area: t.area,
    city: t.city, state: t.state, country: t.country, pin_code: t.pinCode,
  };
  const { error } = await supabase.from("tenants").update(row).eq("id", id);
  if (error) throw error;
}

function exportExcelBackup(tenant, customers, items, receipts, bankAccounts) {
  const wb = XLSX.utils.book_new();
  const custSheet = customers.map((c) => ({
    Name: c.name, Mobile: c.mobile, DOB: c.dob, "Rate % p.a.": c.rate, "Interest Type": c.interestType,
    "Govt ID Number": c.govtIdNumber, Address: addressString(c),
  }));
  const itemSheet = items.map((i) => {
    const cust = customers.find((c) => c.id === i.customerId);
    return { Date: i.date, Customer: cust?.name || "", "Principal Lent": i.principal, Description: i.description, "Rate % p.a.": i.rate, "Interest Type": i.interestType, Mode: i.paymentMode };
  });
  const receiptSheet = receipts.map((r) => {
    const cust = customers.find((c) => c.id === r.customerId);
    return { Date: r.date, Customer: cust?.name || "", "Principal Received": r.principalPaid, "Interest Received": r.interestPaid, Mode: r.paymentMode };
  });
  const bankSheet = bankAccounts.map((b) => ({ "Bank Name": b.bankName, "Account Number": b.accountNumber, IFSC: b.ifsc, Branch: b.branch }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custSheet), "Customers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemSheet), "Loans");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receiptSheet), "Receipts");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankSheet), "Bank Accounts");
  const safeName = (tenant?.businessName || "OONE").replace(/[^a-z0-9]+/gi, "_");
  XLSX.writeFile(wb, `${safeName}_backup_${todayISO()}.xlsx`);
}

/* ================= APP ================= */
export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [editCustomer, setEditCustomer] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editReceipt, setEditReceipt] = useState(null);
  const [toast, setToast] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); setTenant(null); return; }
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("*, tenants(*)").eq("id", session.user.id).single();
      if (prof) { setProfile(prof); setTenant(mapTenant(prof.tenants)); }
      await loadAll();
    })();
  }, [session]);

  const loadAll = async () => {
    const [c, i, r, b] = await Promise.all([fetchCustomers(), fetchItems(), fetchReceipts(), fetchBankAccounts()]);
    setCustomers(c); setItems(i); setReceipts(r); setBankAccounts(b);
  };
  const reloadTenant = async () => {
    const { data } = await supabase.from("tenants").select("*").eq("id", tenant.id).single();
    if (data) setTenant(mapTenant(data));
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };
  const openLedger = (id) => { setSelectedCustomerId(id); setScreen("ledger"); };

  if (session === undefined) return <div className="min-h-screen flex items-center justify-center font-body text-[var(--ink-soft)]"><style>{FONT_STYLE}</style>Loading…</div>;
  if (recoveryMode) return <><style>{FONT_STYLE}</style><ResetPasswordScreen onDone={() => setRecoveryMode(false)} /></>;
  if (!session) return <><style>{FONT_STYLE}</style><AuthScreen /></>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center font-body text-[var(--ink-soft)]"><style>{FONT_STYLE}</style>Setting up your account…</div>;

  if (tenant?.status === "suspended" && !profile.is_super_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center font-body text-center px-6 bg-white">
        <style>{FONT_STYLE}</style>
        <div>
          <Ban size={32} className="mx-auto mb-3 text-[var(--red)]" />
          <h1 className="font-display text-xl mb-2 text-[var(--ink)]">This account is suspended</h1>
          <p className="text-sm text-[var(--ink-soft)] max-w-sm">Contact the platform administrator to restore access.</p>
          <button onClick={() => supabase.auth.signOut()} className="mt-5 text-xs font-body underline text-[var(--ink-soft)]">Log out</button>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "customers", label: "Customers", icon: Users },
    { id: "payment", label: "Payment", icon: HandCoins },
    { id: "receipt", label: "Receipt", icon: Wallet },
    { id: "reports", label: "Reports", icon: FileBarChart2 },
    { id: "profile", label: "My Profile", icon: UserCog },
  ];
  if (profile.is_super_admin) navItems.push({ id: "admin", label: "Admin", icon: ShieldAlert });

  return (
    <div className="min-h-screen font-body bg-white text-[var(--ink)]">
      <style>{FONT_STYLE}</style>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[var(--ink)] text-white text-sm px-4 py-2 rounded-full shadow-lg font-body">{toast}</div>}

      <Sidebar navItems={navItems} screen={screen} setScreen={setScreen} onLogout={() => supabase.auth.signOut()} />

      <div className="pl-16 md:pl-56">
        <TopBar businessName={tenant?.businessName} screen={screen} navItems={navItems} />
        <main className="max-w-6xl mx-auto px-4 pb-16 pt-5">
          {screen === "dashboard" && (
            <Dashboard customers={customers} items={items} receipts={receipts} openLedger={openLedger} onOpenLightbox={setLightboxUrl} />
          )}
          {screen === "customers" && (
            <CustomersScreen customers={customers} items={items}
              onAdd={() => { setEditCustomer(null); setScreen("customerForm"); }}
              onEdit={(c) => { setEditCustomer(c); setScreen("customerForm"); }}
              onOpenLedger={openLedger}
              onDelete={async (c) => {
                if (!window.confirm(`Delete ${c.name}? This cannot be undone.`)) return;
                const res = await deleteCustomerSafely(c.id);
                if (res.blocked) { showToast("There are transactions in the ledger selected. Delete those first."); return; }
                await loadAll(); showToast("Customer deleted");
              }} />
          )}
          {screen === "customerForm" && (
            <CustomerForm existing={editCustomer} onCancel={() => setScreen("customers")} onOpenLightbox={setLightboxUrl}
              onSaved={async (c) => { await upsertCustomer(c); await loadAll(); showToast("Customer saved"); setScreen("customers"); }} />
          )}
          {screen === "payment" && (
            <PaymentEntry customers={customers} bankAccounts={bankAccounts} existing={editItem}
              onSaveCustomer={async (c) => { const id = await upsertCustomer(c); await loadAll(); return id; }}
              onSave={async (item) => {
                if (editItem) await updateItemRow(editItem.id, item); else await insertItem(item);
                await loadAll(); showToast(editItem ? "Loan updated" : "Payment (loan) recorded");
                setEditItem(null); setScreen(editItem ? "ledger" : "dashboard");
              }} />
          )}
          {screen === "receipt" && (
            <ReceiptEntry customers={customers} items={items} receipts={receipts} bankAccounts={bankAccounts} existing={editReceipt}
              onSave={async (r) => {
                if (editReceipt) await updateReceiptRow(editReceipt.id, r); else await insertReceipt(r);
                await loadAll(); showToast(editReceipt ? "Receipt updated" : "Receipt recorded");
                setEditReceipt(null); setScreen(editReceipt ? "ledger" : "dashboard");
              }} />
          )}
          {screen === "ledger" && (
            <LedgerScreen customers={customers} items={items} receipts={receipts}
              selectedCustomerId={selectedCustomerId} setSelectedCustomerId={setSelectedCustomerId}
              onOpenLightbox={setLightboxUrl}
              onEditItem={(it) => { setEditItem(it); setScreen("payment"); }}
              onDeleteItem={async (it) => {
                if (!window.confirm("Delete this loan entry? This cannot be undone.")) return;
                const res = await deleteItemSafely(it.id);
                if (res.blocked) { showToast("There are receipts recorded against this item. Delete those first."); return; }
                await loadAll(); showToast("Loan entry deleted");
              }}
              onEditReceipt={(r) => { setEditReceipt(r); setScreen("receipt"); }}
              onDeleteReceipt={async (r) => {
                if (!window.confirm("Delete this receipt entry? This cannot be undone.")) return;
                await deleteReceiptRow(r.id); await loadAll(); showToast("Receipt deleted");
              }} />
          )}
          {screen === "reports" && <ReportsScreen customers={customers} items={items} receipts={receipts} openLedger={openLedger} />}
          {screen === "profile" && (
            <ProfileScreen tenant={tenant} bankAccounts={bankAccounts} customers={customers} items={items} receipts={receipts}
              onSaveTenant={async (t) => { await updateTenantRow(tenant.id, t); await reloadTenant(); showToast("Company profile saved"); }}
              onAddBank={async (b) => { await upsertBankAccount(b); await loadAll(); showToast("Bank account saved"); }}
              onDeleteBank={async (id) => { await deleteBankAccount(id); await loadAll(); showToast("Bank account removed"); }} />
          )}
          {screen === "admin" && profile.is_super_admin && <AdminScreen />}
        </main>
      </div>
    </div>
  );
}

/* ---------------- Auth ---------------- */
function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState(""); const [fullName, setFullName] = useState("");
  const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState(false);
  const [showForgotPw, setShowForgotPw] = useState(false);
  const [showForgotId, setShowForgotId] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  const signup = async () => {
    setErr(""); setInfo("");
    if (!email || password.length < 6 || !businessName.trim()) { setErr("Fill in your business name, email, and a password of 6+ characters."); return; }
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { business_name: businessName.trim(), full_name: fullName.trim() } } });
    setBusy(false);
    if (error) setErr(error.message);
    else setInfo("Account created. If email confirmation is on, check your inbox — otherwise you're logged in already.");
  };
  const login = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };
  const sendReset = async () => {
    setErr(""); setInfo("");
    if (!forgotEmail) { setErr("Enter the email you signed up with."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, { redirectTo: window.location.origin });
    if (error) setErr(error.message);
    else setInfo("If that email has an account, a password reset link has been sent.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={LOGO_DATA_URI} alt="OONE" className="h-14 mx-auto mb-4 object-contain" />
          <p className="text-[var(--ink-soft)] text-sm font-body">Mortgage &amp; interest ledger for your business.</p>
        </div>
        <div className="bg-white border border-[var(--line)] rounded-xl p-6 shadow-sm">
          {showForgotPw ? (
            <>
              <button onClick={() => { setShowForgotPw(false); setErr(""); setInfo(""); }} className="text-xs text-[var(--ink-soft)] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back</button>
              <h2 className="font-display text-lg mb-1">Reset your password</h2>
              <p className="text-xs text-[var(--ink-soft)] mb-4 font-body">We'll email you a link to set a new password.</p>
              <Field label="Your email"><input type="email" className={inputCls} value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} /></Field>
              {err && <p className="text-[var(--red)] text-xs mt-3 font-body">{err}</p>}
              {info && <p className="text-[var(--green-dark)] text-xs mt-3 font-body">{info}</p>}
              <button onClick={sendReset} className="w-full mt-5 bg-[var(--ink)] text-white rounded py-2.5 font-body font-medium text-sm hover:opacity-90">Send reset link</button>
            </>
          ) : showForgotId ? (
            <>
              <button onClick={() => setShowForgotId(false)} className="text-xs text-[var(--ink-soft)] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back</button>
              <h2 className="font-display text-lg mb-2">Forgot your login ID?</h2>
              <p className="text-sm text-[var(--ink-soft)] font-body">Your login ID is simply the email address you used when you signed up your business. Check the inbox you'd expect — if you're not sure which one, try each of your usual email addresses on the login screen.</p>
            </>
          ) : (
            <>
              <div className="flex gap-4 mb-4 text-sm font-body">
                <button onClick={() => setMode("login")} className={mode === "login" ? "font-semibold border-b-2 border-[var(--ink)]" : "text-[var(--ink-soft)]"}>Log in</button>
                <button onClick={() => setMode("signup")} className={mode === "signup" ? "font-semibold border-b-2 border-[var(--ink)]" : "text-[var(--ink-soft)]"}>New business — Sign up</button>
              </div>
              <div className="space-y-3">
                {mode === "signup" && (
                  <>
                    <Field label="Your business name"><input className={inputCls} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Sharma Finance" /></Field>
                    <Field label="Your name"><input className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} /></Field>
                  </>
                )}
                <Field label="Email"><input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></Field>
                <Field label="Password"><input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (mode === "login" ? login() : signup())} /></Field>
              </div>
              {mode === "login" && (
                <div className="flex justify-between mt-2 text-xs font-body text-[var(--ink-soft)]">
                  <button onClick={() => setShowForgotId(true)} className="underline hover:text-[var(--ink)]">Forgot login ID?</button>
                  <button onClick={() => { setShowForgotPw(true); setForgotEmail(email); }} className="underline hover:text-[var(--ink)]">Forgot password?</button>
                </div>
              )}
              {err && <p className="text-[var(--red)] text-xs mt-3 font-body">{err}</p>}
              {info && <p className="text-[var(--green-dark)] text-xs mt-3 font-body">{info}</p>}
              <button disabled={busy} onClick={mode === "login" ? login : signup}
                className="w-full mt-5 bg-[var(--ink)] text-white rounded py-2.5 font-body font-medium text-sm hover:opacity-90 disabled:opacity-50">
                {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create business account"}
              </button>
            </>
          )}
        </div>
        <p className="text-center text-[var(--ink-soft)] text-xs mt-5 font-body flex items-center justify-center gap-1">
          <ShieldCheck size={12} /> Each business's data is kept private and separate
        </p>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ onDone }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr("");
    if (pw.length < 6 || pw !== pw2) { setErr("Passwords must match and be at least 6 characters."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="w-full max-w-sm bg-white border border-[var(--line)] rounded-xl p-6 shadow-sm">
        <h2 className="font-display text-lg mb-1">Set a new password</h2>
        <div className="space-y-3 mt-3">
          <Field label="New password"><input type="password" className={inputCls} value={pw} onChange={e => setPw(e.target.value)} /></Field>
          <Field label="Confirm new password"><input type="password" className={inputCls} value={pw2} onChange={e => setPw2(e.target.value)} /></Field>
        </div>
        {err && <p className="text-[var(--red)] text-xs mt-3 font-body">{err}</p>}
        <button disabled={busy} onClick={save} className="w-full mt-5 bg-[var(--ink)] text-white rounded py-2.5 font-body font-medium text-sm">{busy ? "Saving…" : "Save password"}</button>
      </div>
    </div>
  );
}

/* ---------------- Sidebar & top bar ---------------- */
function Sidebar({ navItems, screen, setScreen, onLogout }) {
  return (
    <div className="fixed left-0 top-0 bottom-0 z-40 w-16 md:w-56 bg-white border-r border-[var(--line)] flex flex-col">
      <div className="h-16 flex items-center justify-center md:justify-start md:px-5 border-b border-[var(--line)]">
        <img src={LOGO_DATA_URI} alt="OONE" className="h-7 object-contain" />
      </div>
      <nav className="flex-1 py-3">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setScreen(id)}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm font-body transition-colors ${screen === id ? "bg-[var(--paper-dim)] text-[var(--ink)] font-medium border-r-2 border-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--paper-dim)]"}`}>
            <Icon size={18} className="shrink-0" />
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </nav>
      <button onClick={onLogout} className="flex items-center gap-3 px-5 py-4 text-sm font-body text-[var(--ink-soft)] hover:text-[var(--ink)] border-t border-[var(--line)]">
        <LogOut size={18} className="shrink-0" /><span className="hidden md:inline">Log out</span>
      </button>
    </div>
  );
}
function TopBar({ businessName, screen, navItems }) {
  const label = navItems.find((n) => n.id === screen)?.label || "";
  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[var(--line)] h-14 flex items-center px-4">
      <span className="font-display text-lg truncate">{businessName || "OONE"}</span>
      <span className="text-[var(--ink-soft)] text-sm ml-2 font-body hidden sm:inline">· {label}</span>
    </div>
  );
}

/* ---------------- Period picker ---------------- */
function usePeriod() {
  const fy = fyRange();
  const [start, setStart] = useState(fy.start);
  const [end, setEnd] = useState(fy.end);
  const [preset, setPreset] = useState("fy");
  const applyPreset = (p) => {
    setPreset(p);
    const now = new Date();
    if (p === "fy") { const f = fyRange(now); setStart(f.start); setEnd(f.end); }
    else if (p === "lastfy") { const f = fyRange(new Date(now.getFullYear() - 1, now.getMonth(), 1)); setStart(f.start); setEnd(f.end); }
    else if (p === "30d") { setEnd(todayISO()); setStart(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); }
    else if (p === "ytd") { setStart(`${now.getFullYear()}-01-01`); setEnd(todayISO()); }
  };
  return { start, end, setStart, setEnd, preset, applyPreset };
}
function PeriodBar({ period }) {
  const { start, end, setStart, setEnd, preset, applyPreset } = period;
  const presets = [["fy", "This FY"], ["lastfy", "Last FY"], ["30d", "30 days"], ["ytd", "Cal. YTD"]];
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <CalendarRange size={16} className="text-[var(--ink-soft)]" />
      {presets.map(([id, label]) => (
        <button key={id} onClick={() => applyPreset(id)} className={`text-xs font-body px-2.5 py-1 rounded-full border ${preset === id ? "bg-[var(--ink)] text-white border-[var(--ink)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>{label}</button>
      ))}
      <div className="flex items-center gap-1.5 ml-1">
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls + " !w-auto text-xs py-1"} />
        <span className="text-[var(--ink-soft)] text-xs">to</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls + " !w-auto text-xs py-1"} />
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ customers, items, receipts, openLedger, onOpenLightbox }) {
  const period = usePeriod();
  const { start, end } = period;
  const custName = (id) => customers.find((c) => c.id === id)?.name || "Unknown";
  const custMobile = (id) => customers.find((c) => c.id === id)?.mobile || "";

  const stats = useMemo(() => {
    let totalLentInPeriod = 0, outstandingPrincipal = 0, cashBalance = 0, bankBalance = 0;
    const dueByCustomer = {};
    let interestReceivedInPeriod = 0;
    const upcomingByCustomer = {};

    for (const item of items) {
      const itemReceipts = receipts.filter((r) => r.itemId === item.id);
      if (item.date >= start && item.date <= end) totalLentInPeriod += item.principal;
      const state = computeItemState(item, itemReceipts, end);
      outstandingPrincipal += state.balance;
      if (!state.isClosed && state.unpaidInterest > 1) {
        dueByCustomer[item.customerId] = (dueByCustomer[item.customerId] || 0) + state.unpaidInterest;
      }
      if (!state.isClosed) {
        const daysSince = daysBetween(state.lastActivity, todayISO());
        if (daysSince >= 150 && daysSince < 180) {
          upcomingByCustomer[item.customerId] = Math.max(upcomingByCustomer[item.customerId] || 0, daysSince);
        }
      }
      interestReceivedInPeriod += itemReceipts.filter((r) => r.date >= start && r.date <= end).reduce((s, r) => s + (r.interestPaid || 0), 0);

      if (item.date <= end) {
        if (item.paymentMode === "bank") bankBalance -= item.principal; else cashBalance -= item.principal;
      }
      itemReceipts.filter((r) => r.date <= end).forEach((r) => {
        const amt = (r.principalPaid || 0) + (r.interestPaid || 0);
        if (r.paymentMode === "bank") bankBalance += amt; else cashBalance += amt;
      });
    }

    const dueList = Object.entries(dueByCustomer).map(([customerId, due]) => ({ customerId, due })).sort((a, b) => b.due - a.due);
    const upcomingList = Object.entries(upcomingByCustomer).map(([customerId, days]) => ({ customerId, days })).sort((a, b) => b.days - a.days);

    return { totalLentInPeriod, outstandingPrincipal, interestDue: dueList.reduce((s, d) => s + d.due, 0), interestReceivedInPeriod, cashBalance, bankBalance, dueList: dueList.slice(0, 8), upcomingList: upcomingList.slice(0, 8) };
  }, [items, receipts, start, end]);

  const cards = [
    { label: "Lent this period", value: stats.totalLentInPeriod, color: "var(--ink)" },
    { label: "Outstanding principal", value: stats.outstandingPrincipal, color: "var(--brass-dark)" },
    { label: "Interest due", value: stats.interestDue, color: "var(--red)" },
    { label: "Interest received", value: stats.interestReceivedInPeriod, color: "var(--green-dark)" },
    { label: "Cash balance", value: stats.cashBalance, color: "var(--ink)" },
    { label: "Bank balance", value: stats.bankBalance, color: "var(--ink)" },
  ];

  return (
    <div>
      <PeriodBar period={period} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg p-4 border border-[var(--line)]">
            <div className="text-[11px] font-body text-[var(--ink-soft)] mb-1.5">{c.label}</div>
            <div className="font-display text-2xl tabnum ledger-total pb-1.5 inline-block" style={{ color: c.color }}>{inr(c.value)}</div>
          </div>
        ))}
      </div>

      <h3 className="font-display text-lg mb-3">Interest due, highest first</h3>
      {stats.dueList.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)] font-body py-6 text-center border border-dashed border-[var(--line)] rounded-lg mb-8">Nothing outstanding — every account is settled.</p>
      ) : (
        <div className="space-y-2 mb-8">
          {stats.dueList.map(({ customerId, due }) => (
            <div key={customerId} className="flex items-center justify-between bg-white hover:bg-[var(--paper-dim)] transition-colors rounded-lg px-4 py-3 border-l-4 border-[var(--red)]">
              <button onClick={() => openLedger(customerId)} className="text-left flex-1 min-w-0">
                <div className="font-body text-sm font-medium truncate">{custName(customerId)}</div>
              </button>
              <div className="flex items-center gap-3 shrink-0">
                <div className="font-display tabnum text-[var(--red)]">{inr(due)}</div>
                <a href={waLink(custMobile(customerId), `Hi ${custName(customerId)}, a friendly reminder that ${inr(due)} interest is due. Please arrange payment at your earliest convenience.`)}
                  target="_blank" rel="noreferrer" title="Send WhatsApp reminder" className="text-[var(--green-dark)] hover:opacity-70"><MessageCircle size={17} /></a>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="font-display text-lg mb-3">Upcoming interest due (approaching 6 months unpaid)</h3>
      {stats.upcomingList.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)] font-body py-6 text-center border border-dashed border-[var(--line)] rounded-lg">No accounts approaching the 6-month mark right now.</p>
      ) : (
        <div className="space-y-2">
          {stats.upcomingList.map(({ customerId, days }) => (
            <div key={customerId} className="flex items-center justify-between bg-white hover:bg-[var(--paper-dim)] transition-colors rounded-lg px-4 py-3 border-l-4 border-[var(--amber)]">
              <button onClick={() => openLedger(customerId)} className="text-left flex-1 min-w-0">
                <div className="font-body text-sm font-medium truncate">{custName(customerId)}</div>
                <div className="text-xs text-[var(--ink-soft)] font-body">{Math.floor(days)} days since last payment</div>
              </button>
              <a href={waLink(custMobile(customerId), `Hi ${custName(customerId)}, it's been a while since your last payment. Please get in touch when convenient.`)}
                target="_blank" rel="noreferrer" title="Send WhatsApp reminder" className="text-[var(--green-dark)] hover:opacity-70 shrink-0"><MessageCircle size={17} /></a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Customers ---------------- */
function CustomersScreen({ customers, items, onAdd, onEdit, onOpenLedger, onDelete }) {
  const [q, setQ] = useState("");
  const filtered = customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.mobile || "").includes(q));
  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or mobile" className={inputCls + " pl-9"} />
        </div>
        <button onClick={onAdd} className="shrink-0 bg-[var(--ink)] text-white rounded px-3.5 py-2 text-sm font-body font-medium flex items-center gap-1.5"><Plus size={15} /> Add</button>
      </div>
      {filtered.length === 0 ? <p className="text-sm text-[var(--ink-soft)] font-body text-center py-10">No customers yet. Tap Add to create your first ledger.</p> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((c) => {
            const activeItems = items.filter((i) => i.customerId === c.id);
            return (
              <div key={c.id} className="bg-white rounded-lg border border-[var(--line)] p-4 flex gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-[var(--paper-dim)] shrink-0 border border-[var(--line)]">
                  {c.photo ? <img src={c.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-display text-lg text-[var(--ink-soft)]">{c.name?.[0]}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-body font-medium text-sm truncate">{c.name}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => onEdit(c)} className="text-[var(--ink-soft)] hover:text-[var(--ink)]"><Pencil size={13} /></button>
                      <button onClick={() => onDelete(c)} className="text-[var(--ink-soft)] hover:text-[var(--red)]"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="text-xs text-[var(--ink-soft)] font-body">{c.mobile}</div>
                  <div className="text-xs text-[var(--ink-soft)] font-body">{c.rate}% p.a · {c.interestType === "compound" ? "Compound" : "Simple"} · {activeItems.length} item(s)</div>
                  <button onClick={() => onOpenLedger(c.id)} className="mt-2 text-xs font-body font-medium text-[var(--ink)] flex items-center gap-0.5 underline">View ledger <ChevronRight size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function emptyCustomer() {
  return { id: null, name: "", photo: "", mobile: "", dob: "", rate: 24, interestType: "simple", govtIdNumber: "", govtIdPhoto: "", flatNo: "", buildingName: "", roadName: "", area: "", city: "", state: "", country: "India", pinCode: "" };
}
function CustomerForm({ existing, onCancel, onSaved, onOpenLightbox }) {
  const [c, setC] = useState(existing || emptyCustomer());
  const [mobileErr, setMobileErr] = useState("");
  const [checking, setChecking] = useState(false);
  const set = (k, v) => setC((prev) => ({ ...prev, [k]: v }));

  const checkMobile = async (value) => {
    setMobileErr("");
    if (!value || value.length < 6) return;
    setChecking(true);
    try {
      const existingCust = await findCustomerByMobile(value, c.id);
      if (existingCust) setMobileErr(`This number is already used by ${existingCust.name}.`);
    } finally { setChecking(false); }
  };

  const canSave = c.name.trim() && c.mobile.trim() && !mobileErr;
  const save = async () => {
    await checkMobile(c.mobile);
    if (mobileErr) return;
    const fresh = await findCustomerByMobile(c.mobile, c.id);
    if (fresh) { setMobileErr(`This number is already used by ${fresh.name}.`); return; }
    onSaved(c);
  };

  return (
    <div className="max-w-lg">
      <BackHeader title={existing ? "Edit customer" : "New customer"} onBack={onCancel} />
      <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-4">
        <PhotoPicker label="Customer photo" value={c.photo} onChange={(v) => set("photo", v)} />
        <Field label="Full name *"><input className={inputCls} value={c.name} onChange={e => set("name", e.target.value)} /></Field>
        <Field label="Mobile number *">
          <input className={inputCls} value={c.mobile} onChange={e => { set("mobile", e.target.value); setMobileErr(""); }} onBlur={e => checkMobile(e.target.value)} />
          {checking && <p className="text-[10px] text-[var(--ink-soft)] mt-1">Checking…</p>}
          {mobileErr && <p className="text-[10px] text-[var(--red)] mt-1">{mobileErr}</p>}
        </Field>
        <Field label="Date of birth"><input type="date" className={inputCls} value={c.dob || ""} onChange={e => set("dob", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate of interest (% p.a.)"><input type="number" className={inputCls} value={c.rate} onChange={e => set("rate", parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Interest type"><select className={inputCls} value={c.interestType} onChange={e => set("interestType", e.target.value)}><option value="simple">Simple interest</option><option value="compound">Compound interest</option></select></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Govt ID number"><input className={inputCls} value={c.govtIdNumber} onChange={e => set("govtIdNumber", e.target.value)} placeholder="Aadhaar / PAN / Voter ID" /></Field>
        </div>
        <PhotoPicker label="Govt ID photo" value={c.govtIdPhoto} onChange={(v) => set("govtIdPhoto", v)} />

        <div className="pt-2 border-t border-[var(--line)]">
          <p className="text-xs font-medium text-[var(--ink-soft)] mb-3 font-body">Address</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Flat / House No."><input className={inputCls} value={c.flatNo} onChange={e => set("flatNo", e.target.value)} /></Field>
            <Field label="Building name"><input className={inputCls} value={c.buildingName} onChange={e => set("buildingName", e.target.value)} /></Field>
            <Field label="Road name"><input className={inputCls} value={c.roadName} onChange={e => set("roadName", e.target.value)} /></Field>
            <Field label="Area"><input className={inputCls} value={c.area} onChange={e => set("area", e.target.value)} /></Field>
            <Field label="City"><input className={inputCls} value={c.city} onChange={e => set("city", e.target.value)} /></Field>
            <Field label="State"><input className={inputCls} value={c.state} onChange={e => set("state", e.target.value)} /></Field>
            <Field label="Country"><input className={inputCls} value={c.country} onChange={e => set("country", e.target.value)} /></Field>
            <Field label="Pin code"><input className={inputCls} value={c.pinCode} onChange={e => set("pinCode", e.target.value)} /></Field>
          </div>
        </div>

        <button disabled={!canSave} onClick={save} className="w-full bg-[var(--ink)] disabled:opacity-40 text-white rounded py-2.5 font-body font-medium text-sm">Save customer</button>
      </div>
    </div>
  );
}
function BackHeader({ title, onBack }) {
  return <div className="flex items-center gap-2 mb-4"><button onClick={onBack} className="text-[var(--ink-soft)] hover:text-[var(--ink)]"><ArrowLeft size={18} /></button><h2 className="font-display text-xl">{title}</h2></div>;
}

function ModeSelect({ mode, setMode, bankAccountId, setBankAccountId, bankAccounts }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Payment mode">
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="bank">Bank</option>
        </select>
      </Field>
      {mode === "bank" && (
        <Field label="Bank account">
          <select className={inputCls} value={bankAccountId || ""} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Select account…</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} · {b.accountNumber.slice(-4)}</option>)}
          </select>
          {bankAccounts.length === 0 && <p className="text-[10px] text-[var(--ink-soft)] mt-1">Add a bank account under My Profile first.</p>}
        </Field>
      )}
    </div>
  );
}

/* ---------------- Payment (loan) entry ---------------- */
function PaymentEntry({ customers, bankAccounts, existing, onSaveCustomer, onSave }) {
  const isEdit = !!existing;
  const [customerId, setCustomerId] = useState(existing?.customerId || "");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newCust, setNewCust] = useState(emptyCustomer());
  const [mobileErr, setMobileErr] = useState("");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [amount, setAmount] = useState(existing?.principal || "");
  const [desc, setDesc] = useState(existing?.description || "");
  const [photo, setPhoto] = useState(existing?.photo || "");
  const [mode, setMode] = useState(existing?.paymentMode || "cash");
  const [bankAccountId, setBankAccountId] = useState(existing?.bankAccountId || "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      let custId = customerId;
      let rate = customers.find((c) => c.id === custId)?.rate ?? 24;
      let interestType = customers.find((c) => c.id === custId)?.interestType ?? "simple";
      if (creatingNew) {
        if (!newCust.name.trim() || !newCust.mobile.trim()) { setSaving(false); return; }
        const dupe = await findCustomerByMobile(newCust.mobile, null);
        if (dupe) { setMobileErr(`This number is already used by ${dupe.name}.`); setSaving(false); return; }
        custId = await onSaveCustomer(newCust);
        rate = newCust.rate; interestType = newCust.interestType;
      }
      if (!custId || !amount) { setSaving(false); return; }
      await onSave({ customerId: custId, date, principal: parseFloat(amount), description: desc, photo, rate, interestType, paymentMode: mode, bankAccountId: mode === "bank" ? bankAccountId || null : null });
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-lg">
      <h2 className="font-display text-xl mb-4">{isEdit ? "Edit payment" : "New payment — money lent"}</h2>
      <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-4">
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        {isEdit ? (
          <div className="bg-[var(--paper-dim)] rounded-md p-3 text-sm font-body">{customers.find((c) => c.id === customerId)?.name}</div>
        ) : !creatingNew ? (
          <Field label="Customer">
            <select className={inputCls} value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">Select existing customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.mobile}</option>)}
            </select>
            <button onClick={() => setCreatingNew(true)} className="text-xs font-body text-[var(--ink)] underline font-medium mt-2 flex items-center gap-1"><Plus size={12} /> Create new customer instead</button>
          </Field>
        ) : (
          <div className="bg-[var(--paper-dim)] rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between"><span className="text-xs font-body font-medium">New customer</span><button onClick={() => setCreatingNew(false)} className="text-xs text-[var(--ink-soft)]"><X size={13} /></button></div>
            <Field label="Name *"><input className={inputCls} value={newCust.name} onChange={e => setNewCust({ ...newCust, name: e.target.value })} /></Field>
            <Field label="Mobile *">
              <input className={inputCls} value={newCust.mobile} onChange={e => { setNewCust({ ...newCust, mobile: e.target.value }); setMobileErr(""); }} />
              {mobileErr && <p className="text-[10px] text-[var(--red)] mt-1">{mobileErr}</p>}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Rate % p.a."><input type="number" className={inputCls} value={newCust.rate} onChange={e => setNewCust({ ...newCust, rate: parseFloat(e.target.value) || 0 })} /></Field>
              <Field label="Interest"><select className={inputCls} value={newCust.interestType} onChange={e => setNewCust({ ...newCust, interestType: e.target.value })}><option value="simple">Simple</option><option value="compound">Compound</option></select></Field>
            </div>
          </div>
        )}
        <Field label="Amount paid to customer (₹)"><input type="number" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <ModeSelect mode={mode} setMode={setMode} bankAccountId={bankAccountId} setBankAccountId={setBankAccountId} bankAccounts={bankAccounts} />
        <Field label="Description of mortgaged item"><textarea rows={2} className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Gold chain, 22K, ~18g" /></Field>
        <PhotoPicker label="Photo of mortgaged item" value={photo} onChange={setPhoto} />
        <button disabled={saving} onClick={submit} className="w-full bg-[var(--ink)] disabled:opacity-50 text-white rounded py-2.5 font-body font-medium text-sm">{saving ? "Saving…" : isEdit ? "Save changes" : "Record payment"}</button>
      </div>
    </div>
  );
}

/* ---------------- Receipt entry ---------------- */
function ReceiptEntry({ customers, items, receipts, bankAccounts, existing, onSave }) {
  const isEdit = !!existing;
  const [customerId, setCustomerId] = useState(existing?.customerId || "");
  const [itemId, setItemId] = useState(existing?.itemId || "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [principalPaid, setPrincipalPaid] = useState(existing?.principalPaid || "");
  const [interestPaid, setInterestPaid] = useState(existing?.interestPaid || "");
  const [mode, setMode] = useState(existing?.paymentMode || "cash");
  const [bankAccountId, setBankAccountId] = useState(existing?.bankAccountId || "");
  const [saving, setSaving] = useState(false);

  const custItems = items.filter((i) => i.customerId === customerId);
  const activeState = useMemo(() => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    const relevantReceipts = receipts.filter((r) => r.itemId === item.id && (!isEdit || r.id !== existing.id));
    return computeItemState(item, relevantReceipts, date);
  }, [itemId, items, receipts, date]);

  const submit = async () => {
    if (!itemId || (!principalPaid && !interestPaid)) return;
    setSaving(true);
    try { await onSave({ itemId, customerId, date, principalPaid: parseFloat(principalPaid) || 0, interestPaid: parseFloat(interestPaid) || 0, paymentMode: mode, bankAccountId: mode === "bank" ? bankAccountId || null : null }); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-lg">
      <h2 className="font-display text-xl mb-4">{isEdit ? "Edit receipt" : "New receipt — repayment received"}</h2>
      <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-4">
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Customer">
          <select disabled={isEdit} className={inputCls} value={customerId} onChange={e => { setCustomerId(e.target.value); setItemId(""); }}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.mobile}</option>)}
          </select>
        </Field>
        {customerId && (
          <Field label="Against which mortgaged item">
            <select disabled={isEdit} className={inputCls} value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">Select item…</option>
              {custItems.map((i) => <option key={i.id} value={i.id}>{i.description || "Item"} — lent {inr(i.principal)} on {i.date}</option>)}
            </select>
          </Field>
        )}
        {activeState && (
          <div className="bg-[var(--paper-dim)] rounded-md p-3 text-xs font-body flex justify-between">
            <span>Outstanding principal: <b className="tabnum">{inr(activeState.balance)}</b></span>
            <span>Interest due as of {date}: <b className="tabnum text-[var(--red)]">{inr(activeState.unpaidInterest)}</b></span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Principal received (₹)"><input type="number" className={inputCls} value={principalPaid} onChange={e => setPrincipalPaid(e.target.value)} /></Field>
          <Field label="Interest received (₹)"><input type="number" className={inputCls} value={interestPaid} onChange={e => setInterestPaid(e.target.value)} /></Field>
        </div>
        {activeState && interestPaid !== "" && (() => {
          const diff = (parseFloat(interestPaid) || 0) - activeState.unpaidInterest;
          if (Math.abs(diff) < 1) return null;
          return diff < 0
            ? <p className="text-xs font-body text-[var(--red)]">Short by {inr(-diff)} against interest due.</p>
            : <p className="text-xs font-body text-[var(--amber)]">Excess of {inr(diff)} over interest due.</p>;
        })()}
        <ModeSelect mode={mode} setMode={setMode} bankAccountId={bankAccountId} setBankAccountId={setBankAccountId} bankAccounts={bankAccounts} />
        <button disabled={saving} onClick={submit} className="w-full bg-[var(--ink)] disabled:opacity-50 text-white rounded py-2.5 font-body font-medium text-sm">{saving ? "Saving…" : isEdit ? "Save changes" : "Record receipt"}</button>
      </div>
    </div>
  );
}

/* ---------------- Ledger ---------------- */
function LedgerScreen({ customers, items, receipts, selectedCustomerId, setSelectedCustomerId, onOpenLightbox, onEditItem, onDeleteItem, onEditReceipt, onDeleteReceipt }) {
  const customer = customers.find((c) => c.id === selectedCustomerId);
  if (!customer) {
    return (
      <div>
        <h2 className="font-display text-xl mb-4">Select a customer</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {customers.map((c) => <button key={c.id} onClick={() => setSelectedCustomerId(c.id)} className="text-left bg-white border border-[var(--line)] rounded-lg p-3 text-sm font-body hover:bg-[var(--paper-dim)]">{c.name} <span className="text-[var(--ink-soft)] text-xs">· {c.mobile}</span></button>)}
        </div>
      </div>
    );
  }
  const custItems = items.filter((i) => i.customerId === customer.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const asOf = todayISO();
  const dueTotal = custItems.reduce((s, it) => s + computeItemState(it, receipts.filter((r) => r.itemId === it.id), asOf).unpaidInterest, 0);

  const rows = [];
  for (const item of custItems) {
    const itemReceipts = receipts.filter((r) => r.itemId === item.id);
    const state = computeItemState(item, itemReceipts, asOf);
    rows.push({ type: "loan", date: item.date, desc: item.description || "Mortgaged item", amount: item.principal, item });
    itemReceipts.forEach((r) => {
      const tag = state.receiptTags.find((t) => t.receiptId === r.id);
      rows.push({ type: "receipt", date: r.date, desc: `Receipt — ${item.description || "item"}`, principalPaid: r.principalPaid, interestPaid: r.interestPaid, receipt: r, item, shortfall: tag?.shortfall || 0, excess: tag?.excess || 0 });
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div>
      <BackHeader title="Customer ledger" onBack={() => setSelectedCustomerId(null)} />
      <div className="flex flex-wrap gap-4 items-center bg-white border border-[var(--line)] rounded-lg p-4 mb-5">
        <Thumb src={customer.photo} size="w-16 h-16" onOpen={onOpenLightbox} />
        <div className="flex-1 min-w-[200px]">
          <div className="font-display text-lg">{customer.name}</div>
          <div className="text-xs text-[var(--ink-soft)] font-body">{customer.mobile} · {addressString(customer)}</div>
          <div className="text-xs text-[var(--ink-soft)] font-body">{customer.rate}% p.a. · {customer.interestType === "compound" ? "Compound" : "Simple"} interest</div>
          {customer.govtIdNumber && <div className="text-xs text-[var(--ink-soft)] font-body">Govt ID: {customer.govtIdNumber}</div>}
        </div>
        {customer.govtIdPhoto && <Thumb src={customer.govtIdPhoto} size="w-14 h-14" onOpen={onOpenLightbox} />}
        {dueTotal > 1 && (
          <a href={waLink(customer.mobile, `Hi ${customer.name}, a friendly reminder that ${inr(dueTotal)} interest is due. Please arrange payment at your earliest convenience.`)}
            target="_blank" rel="noreferrer" className="text-xs font-body font-medium border border-[var(--line)] rounded px-3 py-1.5 flex items-center gap-1.5 hover:border-[var(--ink)]">
            <MessageCircle size={14} /> Send reminder
          </a>
        )}
      </div>

      {custItems.map((item) => {
        const state = computeItemState(item, receipts.filter((r) => r.itemId === item.id), asOf);
        return (
          <div key={item.id} className="mb-4 bg-white border border-[var(--line)] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
              <div className="flex items-center gap-2 min-w-0">
                <Thumb src={item.photo} size="w-9 h-9" onOpen={onOpenLightbox} />
                <div className="min-w-0">
                  <div className="text-sm font-body font-medium truncate">{item.description || "Mortgaged item"}</div>
                  <div className="text-xs text-[var(--ink-soft)] font-body">Lent {inr(item.principal)} on {item.date} · {item.paymentMode === "bank" ? "Bank" : "Cash"}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-body font-medium px-2 py-0.5 rounded-full ${state.isClosed ? "bg-[var(--green)]/10 text-[var(--green-dark)]" : "bg-[var(--red)]/10 text-[var(--red)]"}`}>{state.isClosed ? "Redeemed" : "Active"}</span>
                <button onClick={() => onEditItem(item)} className="text-[var(--ink-soft)] hover:text-[var(--ink)]"><Pencil size={14} /></button>
                <button onClick={() => onDeleteItem(item)} className="text-[var(--ink-soft)] hover:text-[var(--red)]"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="px-4 py-2 flex justify-between text-xs font-body">
              <span>Outstanding: <b className="tabnum">{inr(state.balance)}</b></span>
              <span>Interest due today: <b className="tabnum text-[var(--red)]">{inr(state.unpaidInterest)}</b></span>
            </div>
          </div>
        );
      })}

      <h3 className="font-display text-base mt-6 mb-2">Transaction history</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead><tr className="text-left text-xs text-[var(--ink-soft)] ledger-rule"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Description</th><th className="py-2 pr-2 text-right">Principal</th><th className="py-2 pr-2 text-right">Interest</th><th className="py-2 pr-2"></th></tr></thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className={`ledger-rule border-l-4 ${r.type === "loan" ? "border-l-[var(--brass)]" : "border-l-[var(--green)]"}`}>
                <td className="py-2 pr-2 whitespace-nowrap">{r.date}</td>
                <td className="py-2 pr-2">
                  {r.desc}
                  {r.type === "receipt" && r.shortfall > 1 && <span className="ml-2 text-[10px] font-medium text-[var(--red)] bg-[var(--red)]/10 px-1.5 py-0.5 rounded">Short {inr(r.shortfall)}</span>}
                  {r.type === "receipt" && r.excess > 1 && <span className="ml-2 text-[10px] font-medium text-[var(--amber)] bg-yellow-50 px-1.5 py-0.5 rounded">Excess {inr(r.excess)}</span>}
                </td>
                <td className="py-2 pr-2 text-right tabnum">{r.type === "loan" ? inr(r.amount) : (r.principalPaid ? "-" + inr(r.principalPaid) : "—")}</td>
                <td className="py-2 pr-2 text-right tabnum">{r.type === "receipt" && r.interestPaid ? "-" + inr(r.interestPaid) : "—"}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">
                  {r.type === "receipt" ? (
                    <span className="inline-flex gap-2">
                      <button onClick={() => onEditReceipt(r.receipt)} className="text-[var(--ink-soft)] hover:text-[var(--ink)]"><Pencil size={13} /></button>
                      <button onClick={() => onDeleteReceipt(r.receipt)} className="text-[var(--ink-soft)] hover:text-[var(--red)]"><Trash2 size={13} /></button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Reports (customer-wise) ---------------- */
function ReportsScreen({ customers, items, receipts, openLedger }) {
  const asOf = todayISO();
  const custName = (id) => customers.find((c) => c.id === id)?.name || "Unknown";
  const custMobile = (id) => customers.find((c) => c.id === id)?.mobile || "";

  const dueByCustomer = {};
  const staleByCustomer = {};
  for (const item of items) {
    const itemReceipts = receipts.filter((r) => r.itemId === item.id);
    const state = computeItemState(item, itemReceipts, asOf);
    if (!state.isClosed) {
      if (state.unpaidInterest > 1) dueByCustomer[item.customerId] = (dueByCustomer[item.customerId] || 0) + state.unpaidInterest;
      const monthsSince = daysBetween(state.lastActivity, asOf) / 30;
      if (monthsSince >= 6) {
        const prev = staleByCustomer[item.customerId];
        if (!prev || monthsSince > prev) staleByCustomer[item.customerId] = monthsSince;
      }
    }
  }
  const dueList = Object.entries(dueByCustomer).map(([customerId, due]) => ({ customerId, due })).sort((a, b) => b.due - a.due);
  const staleList = Object.entries(staleByCustomer).map(([customerId, months]) => ({ customerId, months })).sort((a, b) => b.months - a.months);

  return (
    <div>
      <h2 className="font-display text-xl mb-1">Reports</h2>
      <p className="text-xs text-[var(--ink-soft)] font-body mb-6">As of {asOf} · grouped by customer</p>

      <h3 className="font-display text-base mb-2 flex items-center gap-1.5"><AlertTriangle size={15} className="text-[var(--red)]" /> Interest currently due</h3>
      {dueList.length === 0 ? <p className="text-sm text-[var(--ink-soft)] font-body mb-6">None — all settled.</p> : (
        <div className="space-y-2 mb-8">
          {dueList.map(({ customerId, due }) => (
            <div key={customerId} className="flex justify-between items-center bg-white border-l-4 border-[var(--red)] rounded-lg px-4 py-2.5">
              <button onClick={() => openLedger(customerId)} className="text-left flex-1 min-w-0"><div className="text-sm font-body font-medium truncate">{custName(customerId)}</div></button>
              <div className="flex items-center gap-3">
                <div className="font-display tabnum text-[var(--red)]">{inr(due)}</div>
                <a href={waLink(custMobile(customerId), `Hi ${custName(customerId)}, a friendly reminder that ${inr(due)} interest is due.`)} target="_blank" rel="noreferrer" className="text-[var(--green-dark)] hover:opacity-70"><MessageCircle size={16} /></a>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="font-display text-base mb-2 flex items-center gap-1.5"><AlertTriangle size={15} className="text-[var(--brass-dark)]" /> No payment for 6+ months</h3>
      {staleList.length === 0 ? <p className="text-sm text-[var(--ink-soft)] font-body">None — everyone is current.</p> : (
        <div className="space-y-2">
          {staleList.map(({ customerId, months }) => (
            <div key={customerId} className="flex justify-between items-center bg-white border-l-4 border-[var(--brass)] rounded-lg px-4 py-2.5">
              <button onClick={() => openLedger(customerId)} className="text-left flex-1 min-w-0"><div className="text-sm font-body font-medium truncate">{custName(customerId)}</div></button>
              <div className="flex items-center gap-3">
                <div className="font-body text-xs text-[var(--brass-dark)] font-medium">{months.toFixed(1)} months</div>
                <a href={waLink(custMobile(customerId), `Hi ${custName(customerId)}, it's been a while since your last payment. Please get in touch when convenient.`)} target="_blank" rel="noreferrer" className="text-[var(--green-dark)] hover:opacity-70"><MessageCircle size={16} /></a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- My Profile ---------------- */
function ProfileScreen({ tenant, bankAccounts, customers, items, receipts, onSaveTenant, onAddBank, onDeleteBank }) {
  const [t, setT] = useState(tenant);
  const [saving, setSaving] = useState(false);
  const [newBank, setNewBank] = useState({ bankName: "", accountNumber: "", ifsc: "", branch: "" });
  useEffect(() => { setT(tenant); }, [tenant]);
  const set = (k, v) => setT((prev) => ({ ...prev, [k]: v }));

  const save = async () => { setSaving(true); try { await onSaveTenant(t); } finally { setSaving(false); } };
  const addBank = async () => {
    if (!newBank.bankName.trim() || !newBank.accountNumber.trim()) return;
    await onAddBank(newBank);
    setNewBank({ bankName: "", accountNumber: "", ifsc: "", branch: "" });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-xl mb-4">My Profile</h2>
        <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-4">
          <Field label="Company name"><input className={inputCls} value={t.businessName || ""} onChange={e => set("businessName", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><input type="email" className={inputCls} value={t.email || ""} onChange={e => set("email", e.target.value)} /></Field>
            <Field label="Contact number"><input className={inputCls} value={t.contactNo || ""} onChange={e => set("contactNo", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PAN"><input className={inputCls} value={t.pan || ""} onChange={e => set("pan", e.target.value.toUpperCase())} /></Field>
            <Field label="GSTN"><input className={inputCls} value={t.gstn || ""} onChange={e => set("gstn", e.target.value.toUpperCase())} /></Field>
          </div>
          <div className="pt-2 border-t border-[var(--line)]">
            <p className="text-xs font-medium text-[var(--ink-soft)] mb-3 font-body">Office address</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Office no."><input className={inputCls} value={t.officeNo || ""} onChange={e => set("officeNo", e.target.value)} /></Field>
              <Field label="Building name"><input className={inputCls} value={t.buildingName || ""} onChange={e => set("buildingName", e.target.value)} /></Field>
              <Field label="Road name"><input className={inputCls} value={t.roadName || ""} onChange={e => set("roadName", e.target.value)} /></Field>
              <Field label="Area"><input className={inputCls} value={t.area || ""} onChange={e => set("area", e.target.value)} /></Field>
              <Field label="City"><input className={inputCls} value={t.city || ""} onChange={e => set("city", e.target.value)} /></Field>
              <Field label="State"><input className={inputCls} value={t.state || ""} onChange={e => set("state", e.target.value)} /></Field>
              <Field label="Country"><input className={inputCls} value={t.country || ""} onChange={e => set("country", e.target.value)} /></Field>
              <Field label="Pin code"><input className={inputCls} value={t.pinCode || ""} onChange={e => set("pinCode", e.target.value)} /></Field>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-body text-[var(--ink-soft)]">Plan: <b className={t.isPaid ? "text-[var(--green-dark)]" : "text-[var(--ink-soft)]"}>{t.isPaid ? "Paid" : "Free"}</b></span>
            <button disabled={saving} onClick={save} className="bg-[var(--ink)] disabled:opacity-50 text-white rounded px-5 py-2 font-body font-medium text-sm">{saving ? "Saving…" : "Save profile"}</button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg mb-3 flex items-center gap-2"><Building2 size={17} /> Bank accounts</h3>
        <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-3">
          {bankAccounts.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b border-[var(--line)] pb-2 last:border-0 last:pb-0">
              <div className="text-sm font-body">{b.bankName} · {b.accountNumber} <span className="text-[var(--ink-soft)] text-xs">{b.ifsc} {b.branch}</span></div>
              <button onClick={() => onDeleteBank(b.id)} className="text-[var(--ink-soft)] hover:text-[var(--red)]"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <input placeholder="Bank name" className={inputCls} value={newBank.bankName} onChange={e => setNewBank({ ...newBank, bankName: e.target.value })} />
            <input placeholder="Account number" className={inputCls} value={newBank.accountNumber} onChange={e => setNewBank({ ...newBank, accountNumber: e.target.value })} />
            <input placeholder="IFSC" className={inputCls} value={newBank.ifsc} onChange={e => setNewBank({ ...newBank, ifsc: e.target.value })} />
            <input placeholder="Branch" className={inputCls} value={newBank.branch} onChange={e => setNewBank({ ...newBank, branch: e.target.value })} />
          </div>
          <button onClick={addBank} className="text-xs font-body font-medium text-[var(--ink)] underline flex items-center gap-1"><Plus size={12} /> Add bank account</button>
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg mb-3">Backup</h3>
        <button onClick={() => exportExcelBackup(tenant, customers, items, receipts, bankAccounts)}
          className="flex items-center gap-2 bg-white border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm font-body font-medium hover:border-[var(--ink)]">
          <Download size={16} /> Download Excel backup
        </button>
      </div>
    </div>
  );
}

/* ---------------- Super Admin (platform owner) ---------------- */
function AdminScreen() {
  const [tenants, setTenants] = useState(null);
  const [activity, setActivity] = useState({});
  const load = async () => {
    const { data: t, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    if (!error) setTenants(t);
    const [{ data: allItems }, { data: allReceipts }] = await Promise.all([
      supabase.from("items").select("tenant_id,created_at"),
      supabase.from("receipts").select("tenant_id,created_at"),
    ]);
    const act = {};
    (allItems || []).concat(allReceipts || []).forEach((row) => {
      const prev = act[row.tenant_id];
      if (!prev || row.created_at > prev) act[row.tenant_id] = row.created_at;
    });
    setActivity(act);
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (t) => { await supabase.from("tenants").update({ status: t.status === "active" ? "suspended" : "active" }).eq("id", t.id); load(); };
  const togglePaid = async (t) => { await supabase.from("tenants").update({ is_paid: !t.is_paid }).eq("id", t.id); load(); };

  if (tenants === null) return <p className="text-sm text-[var(--ink-soft)] font-body">Loading sign-ups…</p>;

  return (
    <div>
      <h2 className="font-display text-xl mb-1 flex items-center gap-2"><ShieldAlert size={18} className="text-[var(--brass-dark)]" /> Platform Admin</h2>
      <p className="text-xs text-[var(--ink-soft)] font-body mb-6">Every business that has signed up for OONE.</p>
      <div className="space-y-2">
        {tenants.map((t) => (
          <div key={t.id} className="bg-white border border-[var(--line)] rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-body text-sm font-medium">{t.business_name}</div>
              <div className="text-xs text-[var(--ink-soft)] font-body">Signed up {new Date(t.created_at).toLocaleDateString("en-IN")} · Last activity {activity[t.id] ? new Date(activity[t.id]).toLocaleDateString("en-IN") : "never"}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => togglePaid(t)} className={`text-[10px] font-body font-medium px-2 py-0.5 rounded-full border ${t.is_paid ? "bg-[var(--green)]/10 text-[var(--green-dark)] border-[var(--green)]/30" : "text-[var(--ink-soft)] border-[var(--line)]"}`}>{t.is_paid ? "Paid" : "Free"}</button>
              <span className={`text-[10px] font-body font-medium px-2 py-0.5 rounded-full ${t.status === "active" ? "bg-[var(--green)]/10 text-[var(--green-dark)]" : "bg-[var(--red)]/10 text-[var(--red)]"}`}>{t.status}</span>
              <button onClick={() => toggleStatus(t)} className="text-xs font-body font-medium flex items-center gap-1 border border-[var(--line)] rounded px-2 py-1 hover:border-[var(--ink)]">
                {t.status === "active" ? <><Ban size={12} /> Suspend</> : <><CheckCircle2 size={12} /> Activate</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
