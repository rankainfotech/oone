import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Truck, Package, BookOpen, Receipt, ShoppingCart, FileText,
  ArrowLeft, LogOut, Plus, Trash2, Pencil, X, Building2, ChevronDown, AlertTriangle,
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import { LOGO_DATA_URI } from "../../logo";
import { todayISO, inr, inputCls, Field, BackHeader, PhotoPicker, Lightbox, SearchPicker } from "../../shared";
import * as api from "./data";
import {
  computeInvoiceTotals, buildSalesInvoiceLines, buildPurchaseInvoiceLines,
  buildReceiptLines, buildPaymentLines, trialBalance, profitAndLoss, balanceSheet,
  LEDGER_GROUPS, groupInfo, round2,
} from "./calc";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
  .font-display{ font-family:'Fraunces', Georgia, serif; }
  .font-body{ font-family:'Inter', system-ui, sans-serif; }
  .tabnum{ font-variant-numeric: tabular-nums; }
`;

export default function AccountsApp() {
  const navigate = useNavigate();
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [entitlement, setEntitlement] = useState(undefined);
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  // data caches for the current business
  const [ledgers, setLedgers] = useState([]);
  const [items, setItems] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [lines, setLines] = useState([]);
  const [allocations, setAllocations] = useState([]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { navigate("/products/mortgage"); return; }
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("*, tenants(*)").eq("id", session.user.id).single();
      if (!prof) return;
      setProfile(prof);
      setTenant(prof.tenants);
      if (prof.is_super_admin) { setEntitlement({ status: "active", max_businesses: 999 }); return; }
      const ent = await api.fetchAccountsEntitlement(prof.tenant_id);
      setEntitlement(ent || null);
    })();
  }, [session]);

  const loadBusinesses = async () => {
    const list = await api.fetchBusinesses();
    setBusinesses(list);
    if (list.length === 1) setBusinessId(list[0].id);
  };
  useEffect(() => { if (entitlement) loadBusinesses(); }, [entitlement]);

  const loadBusinessData = async () => {
    if (!businessId) return;
    const [l, i, v, ln, al] = await Promise.all([
      api.fetchLedgers(businessId), api.fetchItems(businessId), api.fetchVouchers(businessId),
      api.fetchVoucherLines(businessId), api.fetchAllocations(businessId),
    ]);
    setLedgers(l); setItems(i); setVouchers(v); setLines(ln); setAllocations(al);
  };
  useEffect(() => { loadBusinessData(); }, [businessId]);

  const startTrial = async () => {
    await api.startAccountsTrial(tenant.id);
    const ent = await api.fetchAccountsEntitlement(tenant.id);
    setEntitlement(ent);
  };

  if (session === undefined || !profile || entitlement === undefined) {
    return <div className="min-h-screen flex items-center justify-center font-body text-gray-400"><style>{FONT_STYLE}</style>Loading…</div>;
  }

  if (!entitlement || entitlement.status === "suspended") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4 text-center">
        <style>{FONT_STYLE}</style>
        <div className="max-w-sm">
          <img src={LOGO_DATA_URI} className="h-14 mx-auto mb-4" />
          <h1 className="font-display text-xl mb-2">myaccountsbook</h1>
          <p className="text-sm text-gray-500 mb-5">{entitlement?.status === "suspended" ? "Your access has been suspended. Contact the platform administrator." : "Not enabled on your account yet. Start a free trial to explore invoicing, ledgers and reports."}</p>
          {!entitlement && <button onClick={startTrial} className="bg-black text-white rounded px-5 py-2.5 text-sm font-medium">Start free trial</button>}
          <div className="mt-4"><button onClick={() => navigate("/products/mortgage")} className="text-xs text-gray-400 underline">Back to Money Lending</button></div>
        </div>
      </div>
    );
  }

  if (businesses === null) return <div className="min-h-screen flex items-center justify-center font-body text-gray-400"><style>{FONT_STYLE}</style>Loading your businesses…</div>;

  if (businesses.length === 0 || (!businessId && businesses.length > 1 && screen !== "chooseBusiness")) {
    return (
      <>
        <style>{FONT_STYLE}</style>
        {businesses.length === 0 ? (
          <CreateBusinessScreen onCreated={async (id) => { await loadBusinesses(); setBusinessId(id); }} />
        ) : (
          <ChooseBusinessScreen businesses={businesses} onPick={(id) => setBusinessId(id)} onCreateNew={() => setScreen("createBusiness")} maxBusinesses={entitlement.max_businesses} />
        )}
      </>
    );
  }

  if (screen === "createBusiness") {
    return <><style>{FONT_STYLE}</style><CreateBusinessScreen onCreated={async (id) => { await loadBusinesses(); setBusinessId(id); setScreen("dashboard"); }} onCancel={() => setScreen("dashboard")} /></>;
  }

  const business = businesses.find((b) => b.id === businessId);
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "sales", label: "Sales", icon: Receipt },
    { id: "paymentsReceipts", label: "Payments & Receipts", icon: FileText },
    { id: "purchases", label: "Purchases", icon: ShoppingCart },
    { id: "ledgers", label: "Ledgers", icon: BookOpen },
    { id: "reports", label: "Reports", icon: LayoutDashboard },
    { id: "profile", label: "Business Profile", icon: Building2 },
  ];

  return (
    <div className="min-h-screen font-body bg-white text-gray-900">
      <style>{FONT_STYLE}</style>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-black text-white text-sm px-4 py-2 rounded-full shadow-lg">{toast}</div>}

      <div className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-56 bg-white border-r border-gray-200 flex-col">
        <div className="h-20 flex items-center px-5 border-b border-gray-200">
          <img src={LOGO_DATA_URI} className="h-9 object-contain" />
        </div>
        <div className="px-5 py-3 border-b border-gray-200">
          <button onClick={() => businesses.length > 1 ? (setBusinessId(null)) : null} className="text-sm font-medium truncate flex items-center gap-1 text-left">
            {business?.name} {businesses.length > 1 && <ChevronDown size={13} />}
          </button>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setScreen(id)} className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${screen === id ? "bg-gray-100 font-medium border-r-2 border-black" : "text-gray-500 hover:bg-gray-50"}`}>
              <Icon size={17} className="shrink-0" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-3 px-5 py-4 text-sm text-gray-500 hover:text-black border-t border-gray-200">
          <LogOut size={17} /><span>Log out</span>
        </button>
      </div>

      <div className="md:pl-56 pb-20 md:pb-0">
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 h-14 flex items-center px-4">
          <span className="font-display text-lg">{navItems.find((n) => n.id === screen)?.label}</span>
        </div>
        <main className="max-w-6xl mx-auto px-4 pt-5 pb-10">
          {screen === "dashboard" && <Dashboard ledgers={ledgers} lines={lines} vouchers={vouchers} business={business} openScreen={setScreen} />}
          {screen === "ledgers" && <LedgersScreen ledgers={ledgers} items={items} businessId={businessId} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "sales" && <SalesScreen businessId={businessId} ledgers={ledgers} items={items} vouchers={vouchers} lines={lines} allocations={allocations} business={business} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "paymentsReceipts" && <PaymentsReceiptsScreen businessId={businessId} ledgers={ledgers} vouchers={vouchers} allocations={allocations} reload={loadBusinessData} showToast={showToast} />}
          {screen === "purchases" && <PurchasesScreen businessId={businessId} ledgers={ledgers} items={items} vouchers={vouchers} business={business} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "reports" && <ReportsScreen ledgers={ledgers} lines={lines} vouchers={vouchers} business={business} />}
          {screen === "profile" && <BusinessProfileScreen business={business} reload={loadBusinesses} showToast={showToast} />}
        </main>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex overflow-x-auto">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setScreen(id)} className={`flex-1 min-w-[70px] flex flex-col items-center gap-0.5 py-2 text-[9px] ${screen === id ? "text-black font-medium" : "text-gray-400"}`}>
            <Icon size={18} /><span className="text-center leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============ Business setup ============ */
function emptyBusiness() { return { name: "", office_no: "", building_name: "", street_name: "", city: "", state: "", country: "India", pin_code: "", mobile: "", email: "", gst_applicable: false, gstin: "", pan: "", books_start_date: todayISO().slice(0, 4) + "-04-01" }; }

function CreateBusinessScreen({ onCreated, onCancel }) {
  const [b, setB] = useState(emptyBusiness());
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k, v) => setB((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setErr("");
    if (!b.name.trim()) { setErr("Business name is required."); return; }
    setSaving(true);
    try { const id = await api.createBusiness(b); onCreated(id); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="min-h-screen bg-white px-4 py-10">
      <div className="max-w-lg mx-auto">
        <img src={LOGO_DATA_URI} className="h-10 mb-6" />
        {onCancel && <button onClick={onCancel} className="text-xs text-gray-400 flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Cancel</button>}
        <h1 className="font-display text-2xl mb-1">Set up your business</h1>
        <p className="text-sm text-gray-500 mb-6">This creates your accounting books — customers, vendors, invoices, everything lives under this business.</p>
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <PhotoPicker label="Company logo" value={b.logo} onChange={(v) => set("logo", v)} />
          <Field label="Company name *"><input className={inputCls} value={b.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Office No."><input className={inputCls} value={b.office_no} onChange={(e) => set("office_no", e.target.value)} /></Field>
            <Field label="Building Name"><input className={inputCls} value={b.building_name} onChange={(e) => set("building_name", e.target.value)} /></Field>
            <Field label="Street Name"><input className={inputCls} value={b.street_name} onChange={(e) => set("street_name", e.target.value)} /></Field>
            <Field label="City"><input className={inputCls} value={b.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="State"><input className={inputCls} value={b.state} onChange={(e) => set("state", e.target.value)} /></Field>
            <Field label="Country"><input className={inputCls} value={b.country} onChange={(e) => set("country", e.target.value)} /></Field>
            <Field label="Pin Code"><input className={inputCls} value={b.pin_code} onChange={(e) => set("pin_code", e.target.value)} /></Field>
            <Field label="Mobile Number"><input className={inputCls} value={b.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
          </div>
          <Field label="Email"><input type="email" className={inputCls} value={b.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Books start from"><input type="date" className={inputCls} value={b.books_start_date} onChange={(e) => set("books_start_date", e.target.value)} /></Field>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gstapp" checked={b.gst_applicable} onChange={(e) => set("gst_applicable", e.target.checked)} />
            <label htmlFor="gstapp" className="text-sm">GST Applicable</label>
          </div>
          {b.gst_applicable && (
            <Field label="GSTIN"><input className={inputCls} value={b.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="Verification against the GST portal needs a GSP API key — not wired up yet" /></Field>
          )}
          <Field label="PAN"><input className={inputCls} value={b.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button disabled={saving} onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">{saving ? "Creating…" : "Create business"}</button>
        </div>
      </div>
    </div>
  );
}

function ChooseBusinessScreen({ businesses, onPick, onCreateNew, maxBusinesses }) {
  return (
    <div className="min-h-screen bg-white px-4 py-10">
      <div className="max-w-md mx-auto text-center">
        <img src={LOGO_DATA_URI} className="h-10 mx-auto mb-6" />
        <h1 className="font-display text-xl mb-5">Choose a business</h1>
        <div className="space-y-2">
          {businesses.map((b) => (
            <button key={b.id} onClick={() => onPick(b.id)} className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-black flex items-center gap-3">
              {b.logo ? <img src={b.logo} className="w-9 h-9 rounded object-cover" /> : <Building2 size={22} className="text-gray-400" />}
              <span className="font-medium text-sm">{b.name}</span>
            </button>
          ))}
        </div>
        {businesses.length < maxBusinesses && (
          <button onClick={onCreateNew} className="mt-4 text-sm text-black underline flex items-center gap-1 mx-auto"><Plus size={14} /> Add another business</button>
        )}
      </div>
    </div>
  );
}

/* ============ Dashboard ============ */
function Dashboard({ ledgers, lines, vouchers, business, openScreen }) {
  const [detail, setDetail] = useState(null); // {kind, title, rows}
  const lineDates = useMemo(() => Object.fromEntries(vouchers.map((v) => [v.id, v.vdate])), [vouchers]);
  const asOf = todayISO();

  const balances = useMemo(() => {
    const totals = {};
    for (const l of ledgers) totals[l.id] = l.opening_side === "Cr" ? -(Number(l.opening_balance) || 0) : (Number(l.opening_balance) || 0);
    for (const line of lines) { if (!(line.ledger_id in totals)) totals[line.ledger_id] = 0; totals[line.ledger_id] += (Number(line.debit) || 0) - (Number(line.credit) || 0); }
    return totals;
  }, [ledgers, lines]);

  const byGroup = (groupKeys) => ledgers.filter((l) => groupKeys.includes(l.group_key));
  const sumPositive = (ls) => ls.reduce((s, l) => s + Math.max(0, balances[l.id] || 0), 0);
  const sumNegative = (ls) => ls.reduce((s, l) => s + Math.max(0, -(balances[l.id] || 0)), 0);

  const receivableLedgers = byGroup(["sundry_debtors"]);
  const payableLedgers = byGroup(["sundry_creditors"]);
  const cashLedgers = byGroup(["cash_in_hand"]);
  const bankLedgers = byGroup(["bank_accounts"]);
  const stockLedgers = byGroup(["stock_in_hand"]);

  const receivables = round2(sumPositive(receivableLedgers));
  const payables = round2(sumPositive(payableLedgers));
  const cashBalance = round2(cashLedgers.reduce((s, l) => s + (balances[l.id] || 0), 0));
  const bankBalance = round2(bankLedgers.reduce((s, l) => s + (balances[l.id] || 0), 0));
  const stockValue = round2(sumPositive(stockLedgers));

  const monthly = useMemo(() => {
    const byMonth = {};
    for (const line of lines) {
      const d = lineDates[line.voucher_id]; if (!d) continue;
      const ledger = ledgers.find((l) => l.id === line.ledger_id); if (!ledger) continue;
      const info = groupInfo(ledger.group_key);
      const key = d.slice(0, 7);
      byMonth[key] = byMonth[key] || { month: key, Income: 0, Expenses: 0 };
      if (info.nature === "income") byMonth[key].Income += (Number(line.credit) || 0) - (Number(line.debit) || 0);
      if (info.nature === "expense") byMonth[key].Expenses += (Number(line.debit) || 0) - (Number(line.credit) || 0);
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-6).map((m) => ({ ...m, Income: round2(m.Income), Expenses: round2(m.Expenses) }));
  }, [lines, ledgers, lineDates]);

  const expensePie = useMemo(() => {
    const byLedger = {};
    for (const line of lines) {
      const ledger = ledgers.find((l) => l.id === line.ledger_id); if (!ledger) continue;
      if (groupInfo(ledger.group_key).nature !== "expense") continue;
      const net = (Number(line.debit) || 0) - (Number(line.credit) || 0);
      byLedger[ledger.name] = (byLedger[ledger.name] || 0) + net;
    }
    return Object.entries(byLedger).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [lines, ledgers]);

  const PIE_COLORS = ["#111", "#555", "#888", "#aaa", "#c33", "#e88", "#39a", "#3a9"];

  const openLedgerwise = (title, groupLedgers, sideFn) => {
    const rows = groupLedgers.map((l) => ({ name: l.name, amount: round2(sideFn(l)) })).filter((r) => Math.abs(r.amount) > 0.5).sort((a, b) => b.amount - a.amount);
    setDetail({ title, rows });
  };

  const cards = [
    { label: "Receivables", value: receivables, onClick: () => openLedgerwise("Receivables, ledger-wise", receivableLedgers, (l) => Math.max(0, balances[l.id] || 0)) },
    { label: "Payables", value: payables, onClick: () => openLedgerwise("Payables, ledger-wise", payableLedgers, (l) => Math.max(0, -(balances[l.id] || 0))) },
    { label: "Cash Balance", value: cashBalance, onClick: () => openLedgerwise("Cash, ledger-wise", cashLedgers, (l) => balances[l.id] || 0) },
    { label: "Bank Balance", value: bankBalance, onClick: () => openLedgerwise("Bank, ledger-wise", bankLedgers, (l) => balances[l.id] || 0) },
    { label: "Inventory Register", value: stockValue, onClick: () => openLedgerwise("Inventory, ledger-wise", stockLedgers, (l) => Math.max(0, balances[l.id] || 0)) },
    { label: "Cash Flow (Cash+Bank)", value: round2(cashBalance + bankBalance), onClick: () => openLedgerwise("Cash Flow, ledger-wise", [...cashLedgers, ...bankLedgers], (l) => balances[l.id] || 0) },
  ];

  if (detail) {
    return (
      <div>
        <BackHeader title={detail.title} onBack={() => setDetail(null)} />
        <div className="space-y-1.5">
          {detail.rows.length === 0 && <p className="text-sm text-gray-400">Nothing to show.</p>}
          {detail.rows.map((r) => (
            <div key={r.name} className="flex justify-between bg-gray-50 rounded px-4 py-2.5 text-sm"><span>{r.name}</span><b className="tabnum">{inr(r.amount)}</b></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {cards.map((c) => (
          <button key={c.label} onClick={c.onClick} className="text-left bg-white rounded-lg p-4 border border-gray-200 hover:border-black transition-colors">
            <div className="text-[11px] text-gray-500 mb-1.5">{c.label}</div>
            <div className="font-display text-2xl tabnum">{inr(c.value)}</div>
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display text-base mb-3">Monthly Income vs Expenses</h3>
          {monthly.length === 0 ? <p className="text-sm text-gray-400">No transactions recorded yet.</p> : (
            <div className="h-64">
              <AccBarChart data={monthly} />
            </div>
          )}
        </div>
        <div>
          <h3 className="font-display text-base mb-3">Expenses by Ledger</h3>
          {expensePie.length === 0 ? <p className="text-sm text-gray-400">No expenses recorded yet.</p> : (
            <div className="h-64">
              <AccPieChart data={expensePie} colors={PIE_COLORS} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccBarChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => inr(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Income" fill="#111111" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Expenses" fill="#aaaaaa" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
function AccPieChart({ data, colors }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={85} label={(d) => d.name}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => inr(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ============ Ledgers ============ */
function emptyLedger(kind) {
  return { id: null, kind, name: "", group_key: kind === "customer" ? "sundry_debtors" : kind === "vendor" ? "sundry_creditors" : "current_assets",
    opening_balance: 0, opening_side: "Dr", contact_person: "", mobile: "", email: "", gst_type: "unregistered", gstin: "", pan: "",
    msme: "", other_registrations: "", office_no: "", building_name: "", street_name: "", city: "", state: "", country: "India", pin_code: "",
    bank_details: { bank_name: "", account_number: "", ifsc: "" } };
}
function emptyItem() {
  return { id: null, item_type: "product", name: "", item_code: "", unit: "", hsn_sac: "", affects_inventory: false,
    gst_rate: 0, other_tax_rate: 0, opening_qty: 0, opening_amount: 0, group_name: "", rfid: "", sale_rate: "", purchase_rate: "" };
}

function LedgersScreen({ ledgers, items, businessId, reload, showToast, onOpenLightbox }) {
  const [tab, setTab] = useState("customers");
  const [editingLedger, setEditingLedger] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

  const customers = ledgers.filter((l) => l.kind === "customer");
  const vendors = ledgers.filter((l) => l.kind === "vendor");
  const others = ledgers.filter((l) => l.kind === "other" && !l.system_key);

  const saveLedger = async (row) => {
    try { await api.saveLedger({ ...row, business_id: businessId }); await reload(); showToast("Saved"); setEditingLedger(null); }
    catch (e) { showToast(e.message.includes("duplicate") || e.message.includes("unique") ? "That mobile number is already used by another ledger in this business." : e.message); }
  };
  const deleteLedger = async (id) => {
    if (!window.confirm("Delete this ledger? This cannot be undone.")) return;
    const res = await api.deleteLedgerSafely(id);
    if (res.blocked) { showToast("This ledger has transactions. It can't be deleted."); return; }
    await reload(); showToast("Deleted");
  };
  const saveItemRow = async (row) => {
    try { await api.saveItem({ ...row, business_id: businessId }); await reload(); showToast("Saved"); setEditingItem(null); }
    catch (e) { showToast(e.message); }
  };
  const deleteItemRow = async (id) => {
    if (!window.confirm("Delete this item? This cannot be undone.")) return;
    const res = await api.deleteItemSafely(id);
    if (res.blocked) { showToast("This item has transactions. It can't be deleted."); return; }
    await reload(); showToast("Deleted");
  };

  if (editingLedger) return <LedgerForm existing={editingLedger} onCancel={() => setEditingLedger(null)} onSave={saveLedger} />;
  if (editingItem) return <ItemForm existing={editingItem} onCancel={() => setEditingItem(null)} onSave={saveItemRow} onOpenLightbox={onOpenLightbox} />;

  const tabs = [["customers", "Customers"], ["vendors", "Vendors"], ["items", "Products & Services"], ["other", "Other Ledgers"]];

  return (
    <div>
      <div className="flex gap-4 border-b border-gray-200 mb-5 text-sm overflow-x-auto">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`pb-2.5 whitespace-nowrap ${tab === k ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>{label}</button>
        ))}
      </div>
      {tab === "customers" && <LedgerList rows={customers} onAdd={() => setEditingLedger(emptyLedger("customer"))} onEdit={setEditingLedger} onDelete={deleteLedger} empty="No customers yet." />}
      {tab === "vendors" && <LedgerList rows={vendors} onAdd={() => setEditingLedger(emptyLedger("vendor"))} onEdit={setEditingLedger} onDelete={deleteLedger} empty="No vendors yet." />}
      {tab === "other" && <LedgerList rows={others} onAdd={() => setEditingLedger(emptyLedger("other"))} onEdit={setEditingLedger} onDelete={deleteLedger} empty="No other ledgers yet." showGroup />}
      {tab === "items" && (
        <div>
          <div className="flex justify-end mb-3"><button onClick={() => setEditingItem(emptyItem())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Add</button></div>
          {items.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No products or services yet.</p> : (
            <div className="grid sm:grid-cols-2 gap-3">
              {items.map((it) => (
                <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-4 flex gap-3">
                  {it.image ? <img src={it.image} onClick={() => onOpenLightbox(it.image)} className="w-12 h-12 rounded object-cover cursor-zoom-in" /> : <Package size={28} className="text-gray-300" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between"><span className="font-medium text-sm truncate">{it.name}</span><div className="flex gap-2 shrink-0"><button onClick={() => setEditingItem(it)}><Pencil size={13} className="text-gray-400" /></button><button onClick={() => deleteItemRow(it.id)}><Trash2 size={13} className="text-gray-400" /></button></div></div>
                    <div className="text-xs text-gray-400">{it.item_type} · {it.hsn_sac || "no HSN/SAC"} · GST {it.gst_rate}%</div>
                    {it.affects_inventory && <div className="text-xs text-gray-400">Stock: {it.opening_qty} {it.unit}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LedgerList({ rows, onAdd, onEdit, onDelete, empty, showGroup }) {
  return (
    <div>
      <div className="flex justify-end mb-3"><button onClick={onAdd} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Add</button></div>
      {rows.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">{empty}</p> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((l) => (
            <div key={l.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex justify-between"><span className="font-medium text-sm">{l.name}</span><div className="flex gap-2"><button onClick={() => onEdit(l)}><Pencil size={13} className="text-gray-400" /></button><button onClick={() => onDelete(l.id)}><Trash2 size={13} className="text-gray-400" /></button></div></div>
              <div className="text-xs text-gray-400">{l.mobile || "—"} {l.email ? `· ${l.email}` : ""}</div>
              {showGroup && <div className="text-xs text-gray-400">{groupInfo(l.group_key).name}</div>}
              <div className="text-xs text-gray-400">Opening: {inr(l.opening_balance)} {l.opening_side}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerForm({ existing, onCancel, onSave }) {
  const [l, setL] = useState(existing);
  const set = (k, v) => setL((p) => ({ ...p, [k]: v }));
  const isParty = l.kind === "customer" || l.kind === "vendor";
  return (
    <div className="max-w-lg">
      <BackHeader title={existing.id ? "Edit ledger" : `New ${l.kind}`} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <Field label="Name / Company name *"><input className={inputCls} value={l.name} onChange={(e) => set("name", e.target.value)} /></Field>
        {!isParty && (
          <Field label="Group">
            <select className={inputCls} value={l.group_key} onChange={(e) => set("group_key", e.target.value)}>
              {LEDGER_GROUPS.filter((g) => !["sundry_debtors", "sundry_creditors"].includes(g.key)).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </Field>
        )}
        {isParty && (
          <>
            <Field label="Contact person name"><input className={inputCls} value={l.contact_person} onChange={(e) => set("contact_person", e.target.value)} /></Field>
            <Field label="Mobile (required, must be unique in this business)"><input className={inputCls} value={l.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
            <Field label="Email"><input className={inputCls} value={l.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GSTN status">
                <select className={inputCls} value={l.gst_type} onChange={(e) => set("gst_type", e.target.value)}>
                  <option value="unregistered">Unregistered</option><option value="registered">Registered</option><option value="consumer">Consumer</option>
                </select>
              </Field>
              <Field label="GSTIN"><input className={inputCls} value={l.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
            </div>
            <Field label="PAN"><input className={inputCls} value={l.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
            {l.kind === "vendor" && (
              <>
                <Field label="MSME / other registrations"><input className={inputCls} value={l.msme} onChange={(e) => set("msme", e.target.value)} /></Field>
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="Bank name" className={inputCls} value={l.bank_details?.bank_name || ""} onChange={(e) => set("bank_details", { ...l.bank_details, bank_name: e.target.value })} />
                  <input placeholder="Account no." className={inputCls} value={l.bank_details?.account_number || ""} onChange={(e) => set("bank_details", { ...l.bank_details, account_number: e.target.value })} />
                  <input placeholder="IFSC" className={inputCls} value={l.bank_details?.ifsc || ""} onChange={(e) => set("bank_details", { ...l.bank_details, ifsc: e.target.value })} />
                </div>
              </>
            )}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-medium text-gray-500 mb-2">Address</p>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Office/Flat No." className={inputCls} value={l.office_no} onChange={(e) => set("office_no", e.target.value)} />
                <input placeholder="Building" className={inputCls} value={l.building_name} onChange={(e) => set("building_name", e.target.value)} />
                <input placeholder="Street" className={inputCls} value={l.street_name} onChange={(e) => set("street_name", e.target.value)} />
                <input placeholder="City" className={inputCls} value={l.city} onChange={(e) => set("city", e.target.value)} />
                <input placeholder="State" className={inputCls} value={l.state} onChange={(e) => set("state", e.target.value)} />
                <input placeholder="Pin code" className={inputCls} value={l.pin_code} onChange={(e) => set("pin_code", e.target.value)} />
              </div>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening balance"><input type="number" className={inputCls} value={l.opening_balance} onChange={(e) => set("opening_balance", parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Side"><select className={inputCls} value={l.opening_side} onChange={(e) => set("opening_side", e.target.value)}><option value="Dr">Dr</option><option value="Cr">Cr</option></select></Field>
        </div>
        <button onClick={() => onSave(l)} disabled={!l.name.trim() || (isParty && !l.mobile.trim())} className="w-full bg-black disabled:opacity-40 text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}

function ItemForm({ existing, onCancel, onSave, onOpenLightbox }) {
  const [it, setIt] = useState(existing);
  const set = (k, v) => setIt((p) => ({ ...p, [k]: v }));
  return (
    <div className="max-w-lg">
      <BackHeader title={existing.id ? "Edit item" : "New product / service"} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <PhotoPicker label="Image" value={it.image} onChange={(v) => set("image", v)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className={inputCls} value={it.item_type} onChange={(e) => set("item_type", e.target.value)}><option value="product">Product</option><option value="service">Service</option></select></Field>
          <Field label="Name *"><input className={inputCls} value={it.name} onChange={(e) => set("name", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Item code (auto if blank)"><input className={inputCls} value={it.item_code} onChange={(e) => set("item_code", e.target.value)} /></Field>
          <Field label="Unit"><input className={inputCls} value={it.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pcs, kg, hr…" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HSN/SAC"><input className={inputCls} value={it.hsn_sac} onChange={(e) => set("hsn_sac", e.target.value)} /></Field>
          <Field label="Group"><input className={inputCls} value={it.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="e.g. Gold Jewellery" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST %"><input type="number" className={inputCls} value={it.gst_rate} onChange={(e) => set("gst_rate", parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Other tax %"><input type="number" className={inputCls} value={it.other_tax_rate} onChange={(e) => set("other_tax_rate", parseFloat(e.target.value) || 0)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sale rate"><input type="number" className={inputCls} value={it.sale_rate} onChange={(e) => set("sale_rate", parseFloat(e.target.value) || "")} /></Field>
          <Field label="Purchase rate"><input type="number" className={inputCls} value={it.purchase_rate} onChange={(e) => set("purchase_rate", parseFloat(e.target.value) || "")} /></Field>
        </div>
        <div className="flex items-center gap-2"><input type="checkbox" id="affinv" checked={it.affects_inventory} onChange={(e) => set("affects_inventory", e.target.checked)} /><label htmlFor="affinv" className="text-sm">Affects inventory</label></div>
        {it.affects_inventory && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening quantity"><input type="number" className={inputCls} value={it.opening_qty} onChange={(e) => set("opening_qty", parseFloat(e.target.value) || 0)} /></Field>
            <Field label="Opening value (₹)"><input type="number" className={inputCls} value={it.opening_amount} onChange={(e) => set("opening_amount", parseFloat(e.target.value) || 0)} /></Field>
          </div>
        )}
        <Field label="RFID tag (optional)"><input className={inputCls} value={it.rfid} onChange={(e) => set("rfid", e.target.value)} /></Field>
        <button onClick={() => onSave(it)} disabled={!it.name.trim()} className="w-full bg-black disabled:opacity-40 text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}

/* ============ Sales: Invoice / Credit Note / Other Income ============ */
function sysLedgerMap(ledgers) {
  const m = {};
  ledgers.filter((l) => l.system_key).forEach((l) => { m[l.system_key] = l.id; });
  return m;
}

function InvoiceForm({ businessId, ledgers, items, vtype, business, onCancel, onSaved, showToast }) {
  const sys = sysLedgerMap(ledgers);
  const customers = ledgers.filter((l) => l.kind === "customer").map((l) => ({ id: l.id, label: l.name, sublabel: l.mobile }));
  const [partyId, setPartyId] = useState("");
  const [vdate, setVdate] = useState(todayISO());
  const [voucherNo, setVoucherNo] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [narration, setNarration] = useState("");
  const [supplyType, setSupplyType] = useState("intra");
  const [lineItems, setLineItems] = useState([{ item_id: "", description: "", hsn_sac: "", qty: 1, rate: 0, gstRate: 0, otherTaxRate: 0 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.nextVoucherNumber(businessId, vtype, vtype === "proforma_invoice" ? "PF-" : "INV-").then(setVoucherNo); }, [businessId, vtype]);

  const totals = useMemo(() => computeInvoiceTotals(lineItems.map((li) => ({ ...li, gstRate: li.gstRate })), { supplyType }), [lineItems, supplyType]);

  const setLine = (i, patch) => setLineItems((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLineItems((ls) => [...ls, { item_id: "", description: "", hsn_sac: "", qty: 1, rate: 0, gstRate: 0, otherTaxRate: 0 }]);
  const removeLine = (i) => setLineItems((ls) => ls.filter((_, idx) => idx !== i));
  const pickItem = (i, itemId) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return setLine(i, { item_id: itemId });
    setLine(i, { item_id: itemId, description: it.name, hsn_sac: it.hsn_sac, rate: it.sale_rate || 0, gstRate: it.gst_rate, otherTaxRate: it.other_tax_rate });
  };

  const save = async () => {
    if (!partyId || !voucherNo.trim()) { showToast("Select a customer and a voucher number."); return; }
    setSaving(true);
    try {
      const voucher = { business_id: businessId, vtype, voucher_no: voucherNo.trim(), vdate, party_ledger_id: partyId, main_ledger_id: sys.sales,
        po_number: poNumber, narration, supply_type: supplyType, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst,
        other_tax: totals.otherTax, round_off: totals.roundOff, total: totals.total };
      const apiItems = totals.lines.map((li, idx) => ({ line_no: idx + 1, item_id: li.item_id || null, description: li.description, hsn_sac: li.hsn_sac,
        qty: li.qty, rate: li.rate, amount: li.amount, gst_rate: li.gstRate, other_tax_rate: li.otherTaxRate, cgst_amt: li.cgstAmt, sgst_amt: li.sgstAmt, igst_amt: li.igstAmt, other_tax_amt: li.otherTaxAmt }));
      const lines = buildSalesInvoiceLines({ partyLedgerId: partyId, salesLedgerId: sys.sales, gstLedgers: sys, invoiceTotals: totals });
      await api.saveVoucher(voucher, apiItems, lines);
      showToast(vtype === "proforma_invoice" ? "Proforma invoice saved" : "Invoice saved");
      onSaved();
    } catch (e) { showToast(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <BackHeader title={vtype === "proforma_invoice" ? "New Proforma Invoice" : "New Tax Invoice"} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4 max-w-3xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Date of invoice"><input type="date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Invoice No."><input className={inputCls} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} /></Field>
          <Field label="Purchase Order No."><input className={inputCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Customer"><SearchPicker options={customers} value={partyId} onChange={setPartyId} placeholder="Type name or mobile…" /></Field>
          <Field label="Supply type (for GST)"><select className={inputCls} value={supplyType} onChange={(e) => setSupplyType(e.target.value)}><option value="intra">Intra-state (CGST+SGST)</option><option value="inter">Inter-state (IGST)</option></select></Field>
        </div>

        <div className="border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Line items</p>
          <div className="space-y-2">
            {lineItems.map((li, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-start bg-gray-50 p-2 rounded">
                <div className="col-span-12 sm:col-span-4"><SearchPicker options={items.map((it) => ({ id: it.id, label: it.name, sublabel: it.hsn_sac }))} value={li.item_id} onChange={(id) => pickItem(i, id)} placeholder="Item…" /></div>
                <input className={inputCls + " col-span-6 sm:col-span-2"} placeholder="HSN/SAC" value={li.hsn_sac} onChange={(e) => setLine(i, { hsn_sac: e.target.value })} />
                <input type="number" className={inputCls + " col-span-3 sm:col-span-1"} placeholder="Qty" value={li.qty} onChange={(e) => setLine(i, { qty: parseFloat(e.target.value) || 0 })} />
                <input type="number" className={inputCls + " col-span-3 sm:col-span-2"} placeholder="Rate" value={li.rate} onChange={(e) => setLine(i, { rate: parseFloat(e.target.value) || 0 })} />
                <input type="number" className={inputCls + " col-span-3 sm:col-span-1"} placeholder="GST%" value={li.gstRate} onChange={(e) => setLine(i, { gstRate: parseFloat(e.target.value) || 0 })} />
                <div className="col-span-3 sm:col-span-1 text-sm tabnum pt-2 text-right">{inr(round2((li.qty||0)*(li.rate||0)))}</div>
                <button onClick={() => removeLine(i)} className="col-span-12 sm:col-span-1 text-gray-400 hover:text-red-600 flex justify-end sm:justify-center pt-1"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button onClick={addLine} className="mt-2 text-xs text-black underline flex items-center gap-1"><Plus size={12} /> Add line</button>
        </div>

        <div className="flex justify-end">
          <div className="w-64 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span className="tabnum">{inr(totals.subtotal)}</span></div>
            {supplyType === "intra" ? (<><div className="flex justify-between"><span>CGST</span><span className="tabnum">{inr(totals.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span className="tabnum">{inr(totals.sgst)}</span></div></>) : (<div className="flex justify-between"><span>IGST</span><span className="tabnum">{inr(totals.igst)}</span></div>)}
            <div className="flex justify-between text-gray-400"><span>Round off</span><span className="tabnum">{inr(totals.roundOff)}</span></div>
            <div className="flex justify-between font-semibold border-t border-gray-200 pt-1"><span>Total</span><span className="tabnum">{inr(totals.total)}</span></div>
          </div>
        </div>
        <Field label="Remarks"><textarea rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <p className="text-[11px] text-gray-400">E-Invoice and E-Way Bill generation need a GSP API connection to go live — not wired up yet.</p>
        <button disabled={saving} onClick={save} className="w-full bg-black disabled:opacity-50 text-white rounded py-2.5 text-sm font-medium">{saving ? "Saving…" : "Save Invoice"}</button>
      </div>
    </div>
  );
}

function OtherIncomeForm({ businessId, ledgers, onCancel, onSaved, showToast }) {
  const sys = sysLedgerMap(ledgers);
  const parties = ledgers.map((l) => ({ id: l.id, label: l.name, sublabel: l.kind }));
  const [partyId, setPartyId] = useState("");
  const [vdate, setVdate] = useState(todayISO());
  const [voucherNo, setVoucherNo] = useState("");
  const [amount, setAmount] = useState("");
  const [gstRate, setGstRate] = useState(0);
  const [narration, setNarration] = useState("");
  const [supplyType, setSupplyType] = useState("intra");
  useEffect(() => { api.nextVoucherNumber(businessId, "other_income", "OI-").then(setVoucherNo); }, [businessId]);
  const totals = useMemo(() => computeInvoiceTotals([{ qty: 1, rate: parseFloat(amount) || 0, gstRate }], { supplyType }), [amount, gstRate, supplyType]);
  const save = async () => {
    if (!partyId || !amount) { showToast("Select a ledger and an amount."); return; }
    try {
      const voucher = { business_id: businessId, vtype: "other_income", voucher_no: voucherNo, vdate, party_ledger_id: partyId, main_ledger_id: sys.other_income,
        narration, supply_type: supplyType, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, round_off: totals.roundOff, total: totals.total };
      const lines = buildSalesInvoiceLines({ partyLedgerId: partyId, salesLedgerId: sys.other_income, gstLedgers: sys, invoiceTotals: totals });
      await api.saveVoucher(voucher, [], lines);
      showToast("Other income recorded"); onSaved();
    } catch (e) { showToast(e.message); }
  };
  return (
    <div className="max-w-lg">
      <BackHeader title="Other Income" onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Journal Entry No."><input className={inputCls} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} /></Field>
        </div>
        <Field label="Customer / Vendor / Ledger"><SearchPicker options={parties} value={partyId} onChange={setPartyId} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="GST %"><input type="number" className={inputCls} value={gstRate} onChange={(e) => setGstRate(parseFloat(e.target.value) || 0)} /></Field>
        </div>
        <p className="text-xs text-gray-400">Total incl. tax: <b>{inr(totals.total)}</b></p>
        <Field label="Remarks"><textarea rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}

function VoucherListScreen({ title, vouchers, ledgers, onOpenNew, newLabel, extraButtons }) {
  const name = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl">{title}</h2>
        <div className="flex gap-2">{extraButtons}<button onClick={onOpenNew} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> {newLabel}</button></div>
      </div>
      {vouchers.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">Nothing recorded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">No.</th><th className="py-2 pr-2">Party</th><th className="py-2 pr-2 text-right">Total</th></tr></thead>
            <tbody>{vouchers.map((v) => (
              <tr key={v.id} className="border-b border-gray-100"><td className="py-2 pr-2">{v.vdate}</td><td className="py-2 pr-2">{v.voucher_no}</td><td className="py-2 pr-2">{name(v.party_ledger_id)}</td><td className="py-2 pr-2 text-right tabnum">{inr(v.total)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SalesScreen({ businessId, ledgers, items, vouchers, lines, allocations, business, reload, showToast, onOpenLightbox }) {
  const [mode, setMode] = useState("list"); // list | invoice | proforma | otherIncome
  const salesVouchers = vouchers.filter((v) => ["sales_invoice", "proforma_invoice"].includes(v.vtype));
  if (mode === "invoice") return <InvoiceForm businessId={businessId} ledgers={ledgers} items={items} vtype="sales_invoice" business={business} onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} />;
  if (mode === "proforma") return <InvoiceForm businessId={businessId} ledgers={ledgers} items={items} vtype="proforma_invoice" business={business} onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} />;
  if (mode === "otherIncome") return <OtherIncomeForm businessId={businessId} ledgers={ledgers} onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} />;
  return (
    <VoucherListScreen title="Sales" vouchers={salesVouchers} ledgers={ledgers} onOpenNew={() => setMode("invoice")} newLabel="New Invoice"
      extraButtons={<><button onClick={() => setMode("proforma")} className="border border-gray-300 rounded px-3 py-2 text-sm">Proforma</button><button onClick={() => setMode("otherIncome")} className="border border-gray-300 rounded px-3 py-2 text-sm">Other Income</button></>} />
  );
}

/* ============ Payments & Receipts ============ */
function outstandingInvoices(vouchers, allocations, partyId) {
  return vouchers.filter((v) => v.party_ledger_id === partyId && ["sales_invoice", "purchase_invoice"].includes(v.vtype)).map((v) => {
    const allocated = allocations.filter((a) => a.invoice_voucher_id === v.id).reduce((s, a) => s + Number(a.amount), 0);
    return { ...v, outstanding: round2(v.total - allocated) };
  }).filter((v) => v.outstanding > 0.5);
}

function PaymentsReceiptsScreen({ businessId, ledgers, vouchers, allocations, reload, showToast }) {
  const [mode, setMode] = useState("list");
  const prVouchers = vouchers.filter((v) => ["receipt", "payment"].includes(v.vtype));
  if (mode === "new") return <ReceiptPaymentForm businessId={businessId} ledgers={ledgers} vouchers={vouchers} allocations={allocations} onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} />;
  return <VoucherListScreen title="Payments & Receipts" vouchers={prVouchers} ledgers={ledgers} onOpenNew={() => setMode("new")} newLabel="New Entry" />;
}

function ReceiptPaymentForm({ businessId, ledgers, vouchers, allocations, onCancel, onSaved, showToast }) {
  const sys = sysLedgerMap(ledgers);
  const [kind, setKind] = useState("receipt");
  const [partyId, setPartyId] = useState("");
  const [vdate, setVdate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("cash");
  const [bankLedgerId, setBankLedgerId] = useState("");
  const [allocInvoiceId, setAllocInvoiceId] = useState("");
  const [narration, setNarration] = useState("");
  const [voucherNo, setVoucherNo] = useState("");
  useEffect(() => { api.nextVoucherNumber(businessId, kind, kind === "receipt" ? "RCT-" : "PMT-").then(setVoucherNo); }, [businessId, kind]);

  const parties = ledgers.filter((l) => l.kind === (kind === "receipt" ? "customer" : "vendor")).map((l) => ({ id: l.id, label: l.name, sublabel: l.mobile }));
  const bankLedgers = ledgers.filter((l) => l.group_key === "bank_accounts").map((l) => ({ id: l.id, label: l.name }));
  const open = partyId ? outstandingInvoices(vouchers, allocations, partyId) : [];
  const cashBankLedgerId = mode === "cash" ? sys.cash : bankLedgerId;

  const save = async () => {
    if (!partyId || !amount || !cashBankLedgerId) { showToast("Fill in party, amount, and cash/bank."); return; }
    try {
      const voucher = { business_id: businessId, vtype: kind, voucher_no: voucherNo, vdate, party_ledger_id: partyId, cash_bank_ledger_id: cashBankLedgerId, narration, total: round2(amount) };
      const lines = kind === "receipt" ? buildReceiptLines({ cashBankLedgerId, partyLedgerId: partyId, amount }) : buildPaymentLines({ cashBankLedgerId, partyLedgerId: partyId, amount });
      const allocs = allocInvoiceId ? [{ invoice_voucher_id: allocInvoiceId, amount: round2(amount) }] : [];
      await api.saveVoucher(voucher, [], lines, allocs);
      showToast(kind === "receipt" ? "Receipt recorded" : "Payment recorded"); onSaved();
    } catch (e) { showToast(e.message); }
  };

  return (
    <div className="max-w-lg">
      <BackHeader title="New Payment / Receipt" onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex gap-4 text-sm border-b border-gray-200 pb-3">
          <button onClick={() => { setKind("receipt"); setPartyId(""); }} className={kind === "receipt" ? "font-semibold border-b-2 border-black" : "text-gray-400"}>Receipt</button>
          <button onClick={() => { setKind("payment"); setPartyId(""); }} className={kind === "payment" ? "font-semibold border-b-2 border-black" : "text-gray-400"}>Payment</button>
        </div>
        <Field label="Date"><input type="date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
        <Field label={kind === "receipt" ? "Customer" : "Vendor"}><SearchPicker options={parties} value={partyId} onChange={(v) => { setPartyId(v); setAllocInvoiceId(""); }} /></Field>
        <Field label="Amount"><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option></select></Field>
          {mode === "bank" && <Field label="Bank"><select className={inputCls} value={bankLedgerId} onChange={(e) => setBankLedgerId(e.target.value)}><option value="">Select…</option>{bankLedgers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>}
        </div>
        {open.length > 0 && (
          <Field label="Mark against outstanding invoice (optional)">
            <select className={inputCls} value={allocInvoiceId} onChange={(e) => setAllocInvoiceId(e.target.value)}>
              <option value="">Not allocated to a specific invoice</option>
              {open.map((v) => <option key={v.id} value={v.id}>{v.voucher_no} — outstanding {inr(v.outstanding)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Remarks"><textarea rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}

/* ============ Purchases: Purchase Invoice / Expense / Debit Note ============ */
function PurchaseInvoiceForm({ businessId, ledgers, items, vtype, onCancel, onSaved, showToast, onOpenLightbox }) {
  const sys = sysLedgerMap(ledgers);
  const vendors = ledgers.filter((l) => l.kind === "vendor").map((l) => ({ id: l.id, label: l.name, sublabel: l.mobile }));
  const parties = ledgers.map((l) => ({ id: l.id, label: l.name, sublabel: l.kind }));
  const [partyId, setPartyId] = useState("");
  const [vdate, setVdate] = useState(todayISO());
  const [voucherNo, setVoucherNo] = useState("");
  const [amount, setAmount] = useState("");
  const [gstRate, setGstRate] = useState(0);
  const [supplyType, setSupplyType] = useState("intra");
  const [narration, setNarration] = useState("");
  const [photo, setPhoto] = useState("");
  const isExpense = vtype === "expense";
  useEffect(() => { api.nextVoucherNumber(businessId, vtype, vtype === "purchase_invoice" ? "PUR-" : isExpense ? "EXP-" : "DN-").then(setVoucherNo); }, [businessId, vtype]);
  const totals = useMemo(() => computeInvoiceTotals([{ qty: 1, rate: parseFloat(amount) || 0, gstRate }], { supplyType }), [amount, gstRate, supplyType]);
  const save = async () => {
    if (!partyId || !amount) { showToast("Select a ledger and an amount."); return; }
    try {
      const voucher = { business_id: businessId, vtype, voucher_no: voucherNo, vdate, party_ledger_id: partyId, main_ledger_id: sys.purchases,
        narration, supply_type: supplyType, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, round_off: totals.roundOff, total: totals.total, attachment: photo };
      const lines = buildPurchaseInvoiceLines({ partyLedgerId: partyId, purchaseLedgerId: sys.purchases, gstLedgers: sys, invoiceTotals: totals });
      await api.saveVoucher(voucher, [], lines);
      showToast("Saved"); onSaved();
    } catch (e) { showToast(e.message); }
  };
  return (
    <div className="max-w-lg">
      <BackHeader title={vtype === "purchase_invoice" ? "New Purchase Invoice" : isExpense ? "New Expense" : "New Debit Note"} onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Journal Entry No."><input className={inputCls} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} /></Field>
        </div>
        <Field label="Customer / Vendor / Ledger"><SearchPicker options={isExpense ? parties : vendors} value={partyId} onChange={setPartyId} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount"><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="GST %"><input type="number" className={inputCls} value={gstRate} onChange={(e) => setGstRate(parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Supply"><select className={inputCls} value={supplyType} onChange={(e) => setSupplyType(e.target.value)}><option value="intra">Intra</option><option value="inter">Inter</option></select></Field>
        </div>
        <p className="text-xs text-gray-400">Total incl. tax: <b>{inr(totals.total)}</b></p>
        {isExpense && <PhotoPicker label="Upload or click purchase invoice photo" value={photo} onChange={setPhoto} />}
        <Field label="Remarks"><textarea rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save</button>
      </div>
    </div>
  );
}

function PurchasesScreen({ businessId, ledgers, items, vouchers, business, reload, showToast, onOpenLightbox }) {
  const [mode, setMode] = useState("list");
  const purchaseVouchers = vouchers.filter((v) => ["purchase_invoice", "expense", "debit_note"].includes(v.vtype));
  if (mode === "purchase") return <PurchaseInvoiceForm businessId={businessId} ledgers={ledgers} items={items} vtype="purchase_invoice" onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} onOpenLightbox={onOpenLightbox} />;
  if (mode === "expense") return <PurchaseInvoiceForm businessId={businessId} ledgers={ledgers} items={items} vtype="expense" onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} onOpenLightbox={onOpenLightbox} />;
  if (mode === "debit") return <PurchaseInvoiceForm businessId={businessId} ledgers={ledgers} items={items} vtype="debit_note" onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} onOpenLightbox={onOpenLightbox} />;
  return (
    <VoucherListScreen title="Purchases" vouchers={purchaseVouchers} ledgers={ledgers} onOpenNew={() => setMode("purchase")} newLabel="Purchase Invoice"
      extraButtons={<><button onClick={() => setMode("expense")} className="border border-gray-300 rounded px-3 py-2 text-sm">Expense</button><button onClick={() => setMode("debit")} className="border border-gray-300 rounded px-3 py-2 text-sm">Debit Note</button></>} />
  );
}

/* ============ Reports ============ */
function ReportsScreen({ ledgers, lines, vouchers, business }) {
  const [report, setReport] = useState("trial");
  const [asOf, setAsOf] = useState(todayISO());
  const lineDates = useMemo(() => Object.fromEntries(vouchers.map((v) => [v.id, v.vdate])), [vouchers]);
  const booksStart = business?.books_start_date || todayISO().slice(0, 4) + "-04-01";

  const tb = useMemo(() => trialBalance(ledgers, lines, asOf, lineDates), [ledgers, lines, asOf, lineDates]);
  const pl = useMemo(() => profitAndLoss(ledgers, lines, booksStart, asOf, lineDates), [ledgers, lines, booksStart, asOf, lineDates]);
  const bs = useMemo(() => balanceSheet(ledgers, lines, asOf, booksStart, lineDates), [ledgers, lines, asOf, booksStart, lineDates]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-4 text-sm">
          {[["trial", "Trial Balance"], ["pl", "Profit & Loss"], ["bs", "Balance Sheet"]].map(([k, l]) => (
            <button key={k} onClick={() => setReport(k)} className={report === k ? "font-semibold border-b-2 border-black pb-1" : "text-gray-400 pb-1"}>{l}</button>
          ))}
        </div>
        <input type="date" className={inputCls + " !w-auto"} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>

      {report === "trial" && (
        <div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2">Ledger</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th></tr></thead>
            <tbody>{tb.rows.map((r) => (<tr key={r.ledgerId} className="border-b border-gray-100"><td className="py-2">{r.name}</td><td className="py-2 text-right tabnum">{r.debit ? inr(r.debit) : "—"}</td><td className="py-2 text-right tabnum">{r.credit ? inr(r.credit) : "—"}</td></tr>))}</tbody>
            <tfoot><tr className="font-semibold border-t-2 border-black"><td className="py-2">Total</td><td className="py-2 text-right tabnum">{inr(tb.totalDebit)}</td><td className="py-2 text-right tabnum">{inr(tb.totalCredit)}</td></tr></tfoot>
          </table>
          <p className={`text-xs mt-2 ${tb.balanced ? "text-green-600" : "text-red-600"}`}>{tb.balanced ? "✓ Balanced" : "⚠ Not balanced — this should never happen; please report it."}</p>
        </div>
      )}
      {report === "pl" && (
        <div className="grid sm:grid-cols-2 gap-6">
          <div><h3 className="font-display text-base mb-2">Income</h3>{pl.income.map((r) => <div key={r.name} className="flex justify-between text-sm py-1"><span>{r.name}</span><span className="tabnum">{inr(r.amount)}</span></div>)}<div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total Income</span><span className="tabnum">{inr(pl.totalIncome)}</span></div></div>
          <div><h3 className="font-display text-base mb-2">Expenses</h3>{pl.expense.map((r) => <div key={r.name} className="flex justify-between text-sm py-1"><span>{r.name}</span><span className="tabnum">{inr(r.amount)}</span></div>)}<div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total Expenses</span><span className="tabnum">{inr(pl.totalExpense)}</span></div></div>
          <div className="sm:col-span-2 bg-gray-50 rounded p-3 flex justify-between font-semibold"><span>Net Profit</span><span className="tabnum">{inr(pl.netProfit)}</span></div>
        </div>
      )}
      {report === "bs" && (
        <div>
          <div className="grid sm:grid-cols-2 gap-6">
            <div><h3 className="font-display text-base mb-2">Assets</h3>{bs.assets.map((r) => <div key={r.name} className="flex justify-between text-sm py-1"><span>{r.name}</span><span className="tabnum">{inr(r.amount)}</span></div>)}<div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total Assets</span><span className="tabnum">{inr(bs.totalAssets)}</span></div></div>
            <div><h3 className="font-display text-base mb-2">Liabilities & Capital</h3>{bs.liabilities.map((r) => <div key={r.name} className="flex justify-between text-sm py-1"><span>{r.name}</span><span className="tabnum">{inr(r.amount)}</span></div>)}<div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total</span><span className="tabnum">{inr(bs.totalLiabilities)}</span></div></div>
          </div>
          <p className={`text-xs mt-3 ${bs.balanced ? "text-green-600" : "text-red-600"}`}>{bs.balanced ? "✓ Balance Sheet balances" : "⚠ Does not balance — this should never happen; please report it."}</p>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-6">GST, TDS, and TCS detail reports are planned next — this release gives you the three core financial statements.</p>
    </div>
  );
}

/* ============ Business Profile ============ */
function BusinessProfileScreen({ business, reload, showToast }) {
  const [b, setB] = useState(business);
  useEffect(() => setB(business), [business]);
  const set = (k, v) => setB((p) => ({ ...p, [k]: v }));
  const save = async () => {
    try {
      await api.updateBusiness(business.id, { name: b.name, logo: b.logo, office_no: b.office_no, building_name: b.building_name, street_name: b.street_name,
        city: b.city, state: b.state, country: b.country, pin_code: b.pin_code, mobile: b.mobile, email: b.email, gst_applicable: b.gst_applicable, gstin: b.gstin, pan: b.pan });
      await reload(); showToast("Saved");
    } catch (e) { showToast(e.message); }
  };
  return (
    <div className="max-w-lg">
      <h2 className="font-display text-xl mb-4">Business Profile</h2>
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <PhotoPicker label="Logo" value={b.logo} onChange={(v) => set("logo", v)} />
        <Field label="Company name"><input className={inputCls} value={b.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile"><input className={inputCls} value={b.mobile || ""} onChange={(e) => set("mobile", e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={b.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Office No." className={inputCls} value={b.office_no || ""} onChange={(e) => set("office_no", e.target.value)} />
          <input placeholder="Building" className={inputCls} value={b.building_name || ""} onChange={(e) => set("building_name", e.target.value)} />
          <input placeholder="Street" className={inputCls} value={b.street_name || ""} onChange={(e) => set("street_name", e.target.value)} />
          <input placeholder="City" className={inputCls} value={b.city || ""} onChange={(e) => set("city", e.target.value)} />
          <input placeholder="State" className={inputCls} value={b.state || ""} onChange={(e) => set("state", e.target.value)} />
          <input placeholder="Pin code" className={inputCls} value={b.pin_code || ""} onChange={(e) => set("pin_code", e.target.value)} />
        </div>
        <div className="flex items-center gap-2"><input type="checkbox" checked={b.gst_applicable} onChange={(e) => set("gst_applicable", e.target.checked)} /><label className="text-sm">GST Applicable</label></div>
        {b.gst_applicable && <Field label="GSTIN"><input className={inputCls} value={b.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>}
        <Field label="PAN"><input className={inputCls} value={b.pan || ""} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
        <button onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium">Save Profile</button>
      </div>
    </div>
  );
}
