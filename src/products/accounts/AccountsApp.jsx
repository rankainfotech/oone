import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Truck, Package, BookOpen, Receipt, ShoppingCart, FileText,
  ArrowLeft, LogOut, Plus, Trash2, Pencil, X, Building2, ChevronDown, AlertTriangle, Settings as SettingsIcon, Menu, ClipboardList, Clock, Landmark,
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import { LOGO_DATA_URI } from "../../logo";
import { todayISO, inr, inputCls, Field, BackHeader, PhotoPicker, Lightbox, SearchPicker } from "../../shared";
import * as api from "./data";
import { InvoiceForm, PartyPicker } from "./Invoice";
import SettingsScreen from "./Settings";
import LedgerView from "./LedgerView";
import Dashboard from "./Dashboard";
import SalesBySalesperson from "./SalesReport";
import JournalScreen, { ExpenseLedgerPicker } from "./Journal";
import TimesheetsScreen from "./Timesheets";
import BankingScreen from "./Banking";
import { GstReport, AgeingReport, RegisterReport } from "./ReportsExtra";
import { generateDueRecurring } from "./recurring";
import { ItemForm, emptyItem } from "./ItemForm";
import { LedgerForm, emptyLedger } from "./LedgerForm";
import {
  computeInvoiceTotals, buildSalesInvoiceLines, buildPurchaseInvoiceLines,
  buildReceiptLines, buildPaymentLines, trialBalance, profitAndLoss, balanceSheet,
  LEDGER_GROUPS, groupInfo, round2, dueRecurringDates, suggestExpenseLedger, confidenceLabel,
} from "./calc";

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
  const [bootError, setBootError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(null);
  const [voucherItems, setVoucherItems] = useState([]);

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

  // Re-run only when the signed-in USER changes (not on every token refresh)
  const authKey = session === undefined ? "loading" : session ? session.user.id : "none";
  useEffect(() => {
    if (authKey === "loading") return;
    if (authKey === "none") {
      setProfile(null); setTenant(null); setEntitlement(undefined); setBusinesses(null); setBusinessId(null); setBootError("");
      return;
    }
    setBootError(""); setProfile(null); setEntitlement(undefined); setBusinesses(null); setBusinessId(null);
    (async () => {
      try {
        const { data: prof, error } = await supabase.from("profiles").select("*, tenants(*)").eq("id", session.user.id).single();
        if (error) throw error;
        setProfile(prof);
        setTenant(prof.tenants);
        if (prof.is_super_admin) { setEntitlement({ status: "active", max_businesses: 999 }); return; }
        const ent = await api.fetchAccountsEntitlement(prof.tenant_id);
        setEntitlement(ent || null);
      } catch (e) {
        setBootError(e.message || "Could not load your account.");
      }
    })();
  }, [authKey]);

  const loadBusinesses = async () => {
    const list = await api.fetchBusinesses();
    setBusinesses(list);
    if (list.length === 1) setBusinessId(list[0].id);
  };
  useEffect(() => { if (entitlement) loadBusinesses(); }, [entitlement]);

  const loadBusinessData = async () => {
    if (!businessId) return;
    const [l, i, v, ln, al, vi] = await Promise.all([
      api.fetchLedgers(businessId), api.fetchItems(businessId), api.fetchVouchers(businessId),
      api.fetchVoucherLines(businessId), api.fetchAllocations(businessId),
      api.fetchAllVoucherItems(businessId).catch(() => []),     // only needed for the inventory register
    ]);
    setLedgers(l); setItems(i); setVouchers(v); setLines(ln); setAllocations(al); setVoucherItems(vi);
  };
  useEffect(() => { loadBusinessData(); }, [businessId]);

  const startTrial = async () => {
    await api.startAccountsTrial(tenant.id);
    const ent = await api.fetchAccountsEntitlement(tenant.id);
    setEntitlement(ent);
  };

  if (session === null) return <><style>{FONT_STYLE}</style><AccountsAuth /></>;
  if (bootError) {
    const network = /failed to fetch|load failed|network/i.test(bootError);
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4 text-center">
        <style>{FONT_STYLE}</style>
        <div className="max-w-sm">
          <img src={LOGO_DATA_URI} className="h-12 mx-auto mb-4" />
          <h1 className="font-display text-xl mb-2">{network ? "Can't reach the server" : "Couldn't load your account"}</h1>
          <p className="text-sm text-gray-500 mb-5">{network ? "Check your internet connection and try again in a minute. If this keeps happening, contact support." : bootError}</p>
          <button onClick={() => window.location.reload()} className="bg-black text-white rounded px-5 py-2.5 text-sm font-medium">Try again</button>
          <div className="mt-4"><button onClick={() => supabase.auth.signOut()} className="text-xs text-gray-400 underline">Log out</button></div>
        </div>
      </div>
    );
  }

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
  const openVoucher = (v) => {
    const full = vouchers.find((x) => x.id === v.id) || v;
    const t = full.vtype;
    if (["sales_invoice", "proforma_invoice"].includes(t)) { setPendingOpen(full.id); setScreen("sales"); }
    else if (t === "purchase_invoice") { setPendingOpen(full.id); setScreen("purchases"); }
    else if (["receipt", "payment"].includes(t)) setScreen("paymentsReceipts");
    else if (["expense", "debit_note"].includes(t)) setScreen("purchases");
    else if (t === "other_income") setScreen("sales");
  };
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "sales", label: "Sales", icon: Receipt },
    { id: "paymentsReceipts", label: "Payments & Receipts", icon: FileText },
    { id: "purchases", label: "Purchases", icon: ShoppingCart },
    { id: "ledgers", label: "Ledgers", icon: BookOpen },
    { id: "journal", label: "Journal", icon: ClipboardList },
    { id: "banking", label: "Banking", icon: Landmark },
    { id: "timesheets", label: "Timesheets", icon: Clock },
    { id: "reports", label: "Reports", icon: LayoutDashboard },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "profile", label: "Business Profile", icon: Building2 },
  ];

  return (
    <div className="min-h-screen font-body bg-white text-gray-900">
      <style>{FONT_STYLE}</style>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-black text-white text-sm px-4 py-2 rounded-full shadow-lg">{toast}</div>}

      {menuOpen && <div data-testid="menu-backdrop" onClick={() => setMenuOpen(false)} className="md:hidden fixed inset-0 z-40 bg-black/40" />}
      <aside aria-label="Main menu" data-open={menuOpen ? "true" : "false"} className={`fixed left-0 top-0 bottom-0 z-50 w-64 md:w-56 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ${menuOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
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
            <button key={id} onClick={() => { setScreen(id); setMenuOpen(false); }} className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${screen === id ? "bg-gray-100 font-medium border-r-2 border-black" : "text-gray-500 hover:bg-gray-50"}`}>
              <Icon size={17} className="shrink-0" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-3 px-5 py-4 text-sm text-gray-500 hover:text-black border-t border-gray-200">
          <LogOut size={17} /><span>Log out</span>
        </button>
      </aside>

      <div className="md:pl-56">
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 h-14 flex items-center gap-3 px-4">
          <button aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} className="md:hidden -ml-1 p-1.5 rounded hover:bg-gray-100"><Menu size={22} /></button>
          <span className="font-display text-lg">{navItems.find((n) => n.id === screen)?.label}</span>
        </div>
        <main className="max-w-6xl mx-auto px-4 pt-5 pb-10">
          {screen === "dashboard" && <Dashboard ledgers={ledgers} items={items} lines={lines} vouchers={vouchers} voucherItems={voucherItems} business={business} onOpenVoucher={openVoucher} onNavigate={setScreen} />}
          {screen === "ledgers" && <LedgersScreen ledgers={ledgers} items={items} vouchers={vouchers} lines={lines} business={business} businessId={businessId} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "sales" && <SalesScreen pendingOpen={pendingOpen} clearPending={() => setPendingOpen(null)} goSettings={() => setScreen("settings")} businessId={businessId} ledgers={ledgers} items={items} vouchers={vouchers} lines={lines} allocations={allocations} business={business} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "paymentsReceipts" && <PaymentsReceiptsScreen businessId={businessId} ledgers={ledgers} vouchers={vouchers} allocations={allocations} business={business} reload={loadBusinessData} showToast={showToast} />}
          {screen === "purchases" && <PurchasesScreen pendingOpen={pendingOpen} clearPending={() => setPendingOpen(null)} lines={lines} allocations={allocations} goSettings={() => setScreen("settings")} businessId={businessId} ledgers={ledgers} items={items} vouchers={vouchers} business={business} reload={loadBusinessData} showToast={showToast} onOpenLightbox={setLightboxUrl} />}
          {screen === "journal" && <JournalScreen businessId={businessId} ledgers={ledgers} vouchers={vouchers} lines={lines} business={business} reload={loadBusinessData} showToast={showToast} />}
          {screen === "banking" && <BankingScreen businessId={businessId} ledgers={ledgers} vouchers={vouchers} lines={lines} business={business} reload={loadBusinessData} showToast={showToast} />}
          {screen === "timesheets" && <TimesheetsScreen businessId={businessId} ledgers={ledgers} reload={loadBusinessData} showToast={showToast} />}
          {screen === "reports" && <ReportsScreen ledgers={ledgers} lines={lines} vouchers={vouchers} allocations={allocations} business={business} onOpenVoucher={openVoucher} />}
          {screen === "settings" && <SettingsScreen business={business} businessId={businessId} showToast={showToast} reloadBusinesses={loadBusinesses} />}
          {screen === "profile" && <BusinessProfileScreen business={business} reload={loadBusinesses} showToast={showToast} />}
        </main>
      </div>

    </div>
  );
}

/* ============ myaccountsbook sign-in / sign-up ============ */
function AccountsAuth() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState(""); const [fullName, setFullName] = useState(""); const [mobile, setMobile] = useState("");
  const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState(false);
  const friendly = (m) => /failed to fetch|load failed|networkerror/i.test(m || "")
    ? "Can't reach the OONE server right now. Check your internet connection and try again in a minute." : m;

  const login = async () => {
    setErr(""); setInfo("");
    if (!email || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setErr(friendly(error.message));
    } catch (e) { setErr(friendly(e.message)); }
    finally { setBusy(false); }
  };

  const signup = async () => {
    setErr(""); setInfo("");
    if (!email || password.length < 6 || !businessName.trim() || !mobile.trim()) { setErr("Fill in business name, email, mobile number, and a password of 6+ characters."); return; }
    setBusy(true);
    try {
      const { data: taken, error: chkErr } = await supabase.rpc("is_mobile_taken", { check_mobile: mobile.trim() });
      if (chkErr) { setErr(friendly(chkErr.message)); return; }
      if (taken) { setErr("This mobile number is already registered to another account."); return; }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { business_name: businessName.trim(), full_name: fullName.trim(), mobile: mobile.trim() } } });
      if (error) setErr(/already registered|already exists/i.test(error.message) ? "An account with this email already exists. Please log in instead." : friendly(error.message));
      else if (data?.user && data.user.identities && data.user.identities.length === 0) setErr("An account with this email already exists. Please log in instead.");
      else setInfo("Account created. If email confirmation is on, check your inbox — otherwise you're signed in already.");
    } catch (e) { setErr(friendly(e.message)); }
    finally { setBusy(false); }
  };

  const forgot = async () => {
    setErr(""); setInfo("");
    if (!email) { setErr("Enter your email first, then tap Forgot password."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/products/mortgage" });
    if (error) setErr(friendly(error.message)); else setInfo("If that email has an account, a reset link has been sent.");
  };

  return (
    <div className="min-h-screen flex flex-col bg-white px-4">
      <div className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <img src={LOGO_DATA_URI} alt="OONE" className="h-24 mx-auto object-contain" />
            <p className="font-display text-xl mt-2">myaccountsbook</p>
            <p className="text-gray-500 text-sm mt-1">Accounting, invoicing &amp; GST for your business.</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex gap-4 mb-4 text-sm">
              <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }} className={mode === "login" ? "font-semibold border-b-2 border-black" : "text-gray-400"}>Log in</button>
              <button onClick={() => { setMode("signup"); setErr(""); setInfo(""); }} className={mode === "signup" ? "font-semibold border-b-2 border-black" : "text-gray-400"}>New business — Sign up</button>
            </div>
            <div className="space-y-3">
              {mode === "signup" && (
                <>
                  <Field label="Your business name *"><input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></Field>
                  <Field label="Your name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
                  <Field label="Mobile number *"><input type="tel" className={inputCls} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile number" /></Field>
                </>
              )}
              <Field label={mode === "signup" ? "Email *" : "Email"}><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Password"><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? login() : signup())} /></Field>
            </div>
            {mode === "login" && <div className="text-right mt-2"><button onClick={forgot} className="text-xs text-gray-500 underline">Forgot password?</button></div>}
            {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
            {info && <p className="text-xs text-green-700 mt-3">{info}</p>}
            <button disabled={busy} onClick={mode === "login" ? login : signup} className="w-full mt-5 bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-3">One OONE login works across all OONE products.</p>
          </div>
        </div>
      </div>
      <p className="text-center text-gray-400 text-xs py-4">© {new Date().getFullYear()}, Ranka Infotech LLP. All Rights Reserved.</p>
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





/* ============ Ledgers ============ */



function LedgersScreen({ ledgers, items, vouchers = [], lines = [], business, businessId, reload, showToast, onOpenLightbox }) {
  const [tab, setTab] = useState("customers");
  const [editingLedger, setEditingLedger] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [viewing, setViewing] = useState(null);

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

  if (viewing) return <LedgerView ledger={viewing} vouchers={vouchers} lines={lines} business={business} onBack={() => setViewing(null)} />;
  if (editingLedger) return <LedgerForm existing={editingLedger} onCancel={() => setEditingLedger(null)} onSave={saveLedger} />;
  if (editingItem) return <ItemForm existing={editingItem} onCancel={() => setEditingItem(null)} onSave={saveItemRow} groups={[...new Set(items.map((i) => i.group_name).filter(Boolean))].sort()} attrNames={[...new Set(items.flatMap((i) => (i.attributes || []).map((a) => a.label)).filter(Boolean))].sort()} />;

  const tabs = [["customers", "Customers"], ["vendors", "Vendors"], ["items", "Products & Services"], ["other", "Other Ledgers"]];

  return (
    <div>
      <div className="flex gap-4 border-b border-gray-200 mb-5 text-sm overflow-x-auto">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`pb-2.5 whitespace-nowrap ${tab === k ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>{label}</button>
        ))}
      </div>
      {tab === "customers" && <LedgerList rows={customers} onAdd={() => setEditingLedger(emptyLedger("customer"))} onEdit={setEditingLedger} onDelete={deleteLedger} onView={setViewing} empty="No customers yet." />}
      {tab === "vendors" && <LedgerList rows={vendors} onAdd={() => setEditingLedger(emptyLedger("vendor"))} onEdit={setEditingLedger} onDelete={deleteLedger} onView={setViewing} empty="No vendors yet." />}
      {tab === "other" && <LedgerList rows={others} onAdd={() => setEditingLedger(emptyLedger("other"))} onEdit={setEditingLedger} onDelete={deleteLedger} onView={setViewing} empty="No other ledgers yet." showGroup />}
      {tab === "items" && (
        <div>
          <div className="flex justify-end mb-3"><button onClick={() => setEditingItem(emptyItem())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Add</button></div>
          {items.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No products or services yet.</p> : (
            <div className="space-y-6">
              {Object.entries(items.reduce((acc, it) => { const g = it.group_name || "Ungrouped"; (acc[g] = acc[g] || []).push(it); return acc; }, {}))
                .sort(([a], [b]) => (a === "Ungrouped") - (b === "Ungrouped") || a.localeCompare(b))
                .map(([group, groupItems]) => (
                <div key={group}>
                  <h3 className="font-display text-base mb-2 flex items-center gap-2">{group} <span className="text-xs font-body text-gray-400">{groupItems.length} item{groupItems.length > 1 ? "s" : ""}</span></h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {groupItems.map((it) => (
                      <div key={it.id} className="bg-white rounded-lg border border-gray-200 p-4 flex gap-3">
                        {it.image ? <img src={it.image} onClick={() => onOpenLightbox(it.image)} className="w-12 h-12 rounded object-cover cursor-zoom-in" /> : <Package size={28} className="text-gray-300" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between"><span className="font-medium text-sm truncate">{it.name}</span><div className="flex gap-2 shrink-0"><button aria-label={`Edit ${it.name}`} onClick={() => setEditingItem(it)}><Pencil size={13} className="text-gray-400" /></button><button aria-label={`Delete ${it.name}`} onClick={() => deleteItemRow(it.id)}><Trash2 size={13} className="text-gray-400" /></button></div></div>
                          <div className="text-xs text-gray-400">{it.item_code ? `#${it.item_code} · ` : ""}{it.item_type} · {it.hsn_sac || "no HSN/SAC"} · GST {it.gst_rate}%{Array.isArray(it.other_taxes) && it.other_taxes.length ? ` + ${it.other_taxes.map((t) => `${t.name} ${t.rate}%`).join(", ")}` : ""}</div>
                          {Array.isArray(it.attributes) && it.attributes.length > 0 && <div className="text-xs text-gray-600 mt-0.5">{it.attributes.map((a) => `${a.label}: ${a.value}${a.show ? "" : " (not on bill)"}`).join(" · ")}</div>}
                          {it.rfid && <div className="text-xs text-gray-400">RFID: {it.rfid}</div>}
                          {it.affects_inventory && <div className="text-xs text-gray-400">Stock: {it.opening_qty} {it.unit}</div>}
                        </div>
                      </div>
                    ))}
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

function LedgerList({ rows, onAdd, onEdit, onDelete, onView, empty, showGroup }) {
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
              {onView && <button aria-label={`View ledger of ${l.name}`} onClick={() => onView(l)} className="mt-2 text-xs text-blue-700 font-medium flex items-center gap-1"><BookOpen size={12} /> View ledger</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}





/* ============ Sales: Invoice / Credit Note / Other Income ============ */
function sysLedgerMap(ledgers) {
  const m = {};
  ledgers.filter((l) => l.system_key).forEach((l) => { m[l.system_key] = l.id; });
  return m;
}



function OtherIncomeForm({ businessId, ledgers, business, onCancel, onSaved, showToast, reload }) {
  const sys = sysLedgerMap(ledgers);
  const parties = ledgers.map((l) => ({ id: l.id, label: l.name, sublabel: l.kind }));
  const [partyId, setPartyId] = useState("");
  const [vdate, setVdate] = useState(todayISO());
  const [voucherNo, setVoucherNo] = useState("");
  const [amount, setAmount] = useState("");
  const [gstRate, setGstRate] = useState(0);
  const [narration, setNarration] = useState("");
  const [supplyType, setSupplyType] = useState("intra");
  useEffect(() => { api.nextVoucherNumber(businessId, "other_income", "OI-", business?.settings?.numbering?.other_income, vdate).then(setVoucherNo).catch(() => {}); }, [businessId, vdate]);
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
        <Field label="Customer / Vendor / Ledger"><PartyPicker kind="customer" allowAll ledgers={ledgers} value={partyId} onChange={setPartyId} businessId={businessId} reload={reload} showToast={showToast} /></Field>
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

/** Invoices marked "repeat": shows what is due and creates the copies when asked. */
function RecurringTab({ templates, ledgers, businessId, settings, reload, showToast, onOpen }) {
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const dueCount = templates.reduce((n, t) => n + dueRecurringDates(t.meta.recurring, today).dates.length, 0);
  const FREQ = { weekly: "every week", monthly: "every month", quarterly: "every 3 months", yearly: "every year" };
  const run = async () => {
    setBusy(true);
    try { const r = await generateDueRecurring({ templates, ledgers, businessId, settings, today }); await reload(); showToast(r.errors.length ? `Created ${r.created}. Problem: ${r.errors[0]}` : `${r.created} invoice${r.created === 1 ? "" : "s"} created`); }
    catch (e) { showToast(e.message); } finally { setBusy(false); }
  };
  const stop = async (t) => {
    if (!window.confirm(`Stop repeating ${t.voucher_no}? Invoices already created stay as they are.`)) return;
    try { await api.updateVoucherMeta(t.id, { ...t.meta, recurring: { ...t.meta.recurring, active: false } }); await reload(); } catch (e) { showToast(e.message); }
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-sm text-gray-500">{templates.length === 0 ? "No repeating invoices. Tick “Repeat this invoice automatically” on a tax invoice to set one up." : dueCount ? `${dueCount} invoice${dueCount === 1 ? " is" : "s are"} due to be created.` : "Nothing is due right now."}</p>
        {templates.length > 0 && <button disabled={busy || !dueCount} onClick={run} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium disabled:opacity-40">{busy ? "Creating…" : "Create due invoices now"}</button>}
      </div>
      {templates.length > 0 && (
        <table className="w-full text-sm" aria-label="Repeating invoices"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Invoice</th><th className="py-2 pr-2">Customer</th><th className="py-2 pr-2">Repeats</th><th className="py-2 pr-2">Next on</th><th className="py-2 pr-2 text-right">Amount</th><th /></tr></thead>
          <tbody>{templates.map((t) => { const r = t.meta.recurring; const due = dueRecurringDates(r, today).dates.length; return (
            <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(t)}>
              <td className="py-2.5 pr-2">{t.voucher_no}</td><td className="py-2.5 pr-2">{nameOf(t.party_ledger_id)}</td><td className="py-2.5 pr-2">{FREQ[r.frequency]}{r.end ? ` until ${r.end.split("-").reverse().join("-")}` : ""}</td>
              <td className="py-2.5 pr-2 whitespace-nowrap">{r.next.split("-").reverse().join("-")}{due > 0 && <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">{due} due</span>}</td>
              <td className="py-2.5 pr-2 text-right tabnum">{inr(t.total)}</td><td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}><button aria-label={`Stop repeating ${t.voucher_no}`} onClick={() => stop(t)} className="text-xs text-gray-500 underline">Stop</button></td>
            </tr>); })}</tbody></table>
      )}
    </div>
  );
}

function SalesScreen({ businessId, ledgers, items, vouchers, lines, allocations, business, reload, showToast, onOpenLightbox, goSettings, pendingOpen, clearPending }) {
  const [mode, setMode] = useState("list");
  const [tab, setTab] = useState("invoices"); // invoices | proforma  (kept apart: a proforma is not a sale)
  const [cfg, setCfg] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const isPf = tab === "proforma", isCn = tab === "credit", isRec = tab === "recurring";
  const TAB_TYPE = { invoices: "sales_invoice", proforma: "proforma_invoice", credit: "credit_note" };
  const shown = isRec ? vouchers.filter((v) => v.vtype === "sales_invoice" && v.meta?.recurring?.active) : vouchers.filter((v) => v.vtype === TAB_TYPE[tab]);
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const metaOf = (v) => v.meta || {};
  const convertedInv = (v) => (metaOf(v).converted_to ? vouchers.find((x) => x.id === metaOf(v).converted_to) : null);
  const statusOf = (v) => {
    const m = metaOf(v);
    if (m.status === "draft") return { label: "Draft", cls: "bg-gray-100 text-gray-600" };
    if (v.vtype === "credit_note") return { label: "Credit note", cls: "bg-purple-50 text-purple-700" };
    if (v.vtype === "proforma_invoice") { const c = convertedInv(v); return c ? { label: `Converted to ${c.voucher_no}`, cls: "bg-green-50 text-green-700" } : { label: "Open", cls: "bg-blue-50 text-blue-700" }; }
    const paid = allocations.filter((a) => a.invoice_voucher_id === v.id).reduce((s, a) => s + Number(a.amount), 0);
    if (paid >= v.total - 0.5) return { label: "Paid", cls: "bg-green-50 text-green-700" };
    if (paid > 0) return { label: "Partly paid", cls: "bg-yellow-50 text-yellow-700" };
    return { label: "Unpaid", cls: "bg-red-50 text-red-700" };
  };
  const load = async (v) => { const [its, atts] = await Promise.all([api.fetchVoucherItems(v.id), api.fetchAttachments(v.id)]); return { voucher: v, items: its, attachments: atts }; };
  const openNew = (vtype) => { setCfg({ vtype, initial: null, convertFrom: null }); setMode("form"); };
  const openExisting = async (v) => { setBusyId(v.id); try { setCfg({ vtype: v.vtype, initial: await load(v), convertFrom: null }); setMode("form"); } catch (e) { showToast(e.message); } finally { setBusyId(null); } };
  const convert = async (v) => { setBusyId(v.id); try { const init = await load(v); setCfg({ vtype: "sales_invoice", initial: { ...init, attachments: [] }, convertFrom: v }); setMode("form"); } catch (e) { showToast(e.message); } finally { setBusyId(null); } };
  const remove = async (v) => {
    if (!window.confirm(`Delete ${v.voucher_no}? ${v.vtype === "sales_invoice" ? "Its accounting entries and payments are removed too. " : ""}This cannot be undone.`)) return;
    try { await api.deleteVoucher(v.id); await reload(); showToast("Deleted"); } catch (e) { showToast(e.message); }
  };
  const done = async () => { await reload(); setMode("list"); setCfg(null); };
  useEffect(() => {
    if (!pendingOpen) return;
    const v = vouchers.find((x) => x.id === pendingOpen && ["sales_invoice", "proforma_invoice"].includes(x.vtype));
    if (v) { if (v.vtype === "proforma_invoice") setTab("proforma"); openExisting(v); }
    clearPending && clearPending();
  }, [pendingOpen]);

  if (mode === "form") return <InvoiceForm key={cfg.initial?.voucher?.id || "new" + cfg.vtype + (cfg.convertFrom?.id || "")} businessId={businessId} ledgers={ledgers} items={items} vtype={cfg.vtype} business={business} initial={cfg.initial} convertFrom={cfg.convertFrom} vouchers={vouchers} allocations={allocations} lines={lines} reload={reload} goSettings={goSettings} onCancel={() => { setMode("list"); setCfg(null); }} onSaved={done} showToast={showToast} onOpenLightbox={onOpenLightbox} />;
  if (mode === "otherIncome") return <OtherIncomeForm businessId={businessId} ledgers={ledgers} business={business} reload={reload} onCancel={() => setMode("list")} onSaved={done} showToast={showToast} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-display text-xl">Sales</h2>
        <div className="flex gap-2">
          <button onClick={() => setMode("otherIncome")} className="border border-gray-300 rounded px-3 py-2 text-sm">Other Income</button>
          <button onClick={() => openNew(isPf ? "proforma_invoice" : isCn ? "credit_note" : "sales_invoice")} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> {isPf ? "New Proforma" : isCn ? "New Credit Note" : "New Invoice"}</button>
        </div>
      </div>
      <div className="flex gap-4 border-b border-gray-200 mb-3 text-sm">
        <button onClick={() => setTab("invoices")} className={`pb-2 ${!isPf ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>Tax Invoices</button>
        <button onClick={() => setTab("proforma")} className={`pb-2 ${isPf ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>Proforma Invoices</button>
        <button onClick={() => setTab("credit")} className={`pb-2 ${isCn ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>Credit Notes</button>
        <button onClick={() => setTab("recurring")} className={`pb-2 ${isRec ? "font-semibold border-b-2 border-black" : "text-gray-400"}`}>Recurring</button>
      </div>
      {isPf && <p className="text-xs text-gray-500 mb-3">Proforma invoices are quotations only. They are kept apart from sales and never touch your accounts, GST or reports until converted to a Tax Invoice.</p>}
      {isRec ? <RecurringTab templates={shown} ledgers={ledgers} businessId={businessId} settings={business?.settings || {}} reload={reload} showToast={showToast} onOpen={openExisting} /> : shown.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">{isPf ? "No proforma invoices yet." : isCn ? "No credit notes yet. Use one when goods are returned or a bill is reduced." : "No invoices yet."}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">No.</th><th className="py-2 pr-2">Customer</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2 text-right">Total</th><th className="py-2"></th></tr></thead>
            <tbody>{shown.map((v) => {
              const st = statusOf(v); const m = metaOf(v); const conv = convertedInv(v);
              return (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openExisting(v)}>
                  <td className="py-2.5 pr-2 whitespace-nowrap">{v.vdate}</td>
                  <td className="py-2.5 pr-2">{v.voucher_no}</td>
                  <td className="py-2.5 pr-2">{nameOf(v.party_ledger_id)}</td>
                  <td className="py-2.5 pr-2"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>{m.send_later && <span className="ml-1 text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">To send</span>}</td>
                  <td className="py-2.5 pr-2 text-right tabnum">{inr(v.total)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {v.vtype === "proforma_invoice" && !conv && m.status !== "draft" && <button disabled={busyId === v.id} onClick={() => convert(v)} className="text-xs text-blue-700 underline mr-3">Convert to Tax Invoice</button>}
                    {!conv && <button aria-label={`Delete ${v.voucher_no}`} onClick={() => remove(v)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============ Payments & Receipts ============ */
function outstandingInvoices(vouchers, allocations, partyId) {
  return vouchers.filter((v) => v.party_ledger_id === partyId && ["sales_invoice", "purchase_invoice"].includes(v.vtype) && v.meta?.status !== "draft").map((v) => {
    const allocated = allocations.filter((a) => a.invoice_voucher_id === v.id).reduce((s, a) => s + Number(a.amount), 0);
    return { ...v, outstanding: round2(v.total - allocated) };
  }).filter((v) => v.outstanding > 0.5);
}

function PaymentsReceiptsScreen({ businessId, ledgers, vouchers, allocations, business, reload, showToast }) {
  const [mode, setMode] = useState("list");
  const prVouchers = vouchers.filter((v) => ["receipt", "payment"].includes(v.vtype));
  if (mode === "new") return <ReceiptPaymentForm businessId={businessId} ledgers={ledgers} vouchers={vouchers} allocations={allocations} business={business} reload={reload} onCancel={() => setMode("list")} onSaved={async () => { await reload(); setMode("list"); }} showToast={showToast} />;
  return <VoucherListScreen title="Payments & Receipts" vouchers={prVouchers} ledgers={ledgers} onOpenNew={() => setMode("new")} newLabel="New Entry" />;
}

function ReceiptPaymentForm({ businessId, ledgers, vouchers, allocations, business, onCancel, onSaved, showToast, reload }) {
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
  useEffect(() => { api.nextVoucherNumber(businessId, kind, kind === "receipt" ? "RCT-" : "PMT-", business?.settings?.numbering?.[kind], vdate).then(setVoucherNo).catch(() => {}); }, [businessId, kind, vdate]);

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
        <Field label={kind === "receipt" ? "Customer" : "Vendor"}><PartyPicker kind={kind === "receipt" ? "customer" : "vendor"} ledgers={ledgers} value={partyId} onChange={(v) => { setPartyId(v); setAllocInvoiceId(""); }} businessId={businessId} reload={reload} showToast={showToast} /></Field>
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
function ExpenseForm({ businessId, ledgers, vouchers, business, onCancel, onSaved, showToast, onOpenLightbox, reload }) {
  const sys = sysLedgerMap(ledgers);
  const [partyId, setPartyId] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [paidFrom, setPaidFrom] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [vdate, setVdate] = useState(todayISO());
  const [voucherNo, setVoucherNo] = useState("");
  const [amount, setAmount] = useState("");
  const [gstRate, setGstRate] = useState(0);
  const [supplyType, setSupplyType] = useState("intra");
  const [narration, setNarration] = useState("");
  const [photo, setPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.nextVoucherNumber(businessId, "expense", "EXP-", business?.settings?.numbering?.expense, vdate).then(setVoucherNo).catch(() => {}); }, [businessId, vdate]);
  const totals = useMemo(() => computeInvoiceTotals([{ qty: 1, rate: parseFloat(amount) || 0, gstRate }], { supplyType }), [amount, gstRate, supplyType]);
  const payFrom = ledgers.filter((l) => ["cash_in_hand", "bank_accounts"].includes(l.group_key));
  // what this vendor / description was booked to before
  const history = useMemo(() => vouchers.filter((v) => v.vtype === "expense" && v.main_ledger_id && v.main_ledger_id !== sys.purchases).map((v) => ({ partyId: v.party_ledger_id, description: v.narration || "", ledgerId: v.main_ledger_id })), [vouchers, sys.purchases]);
  const suggestion = useMemo(() => suggestExpenseLedger({ history, partyId, description: narration }), [history, partyId, narration]);
  const sugLedger = suggestion ? ledgers.find((l) => l.id === suggestion.ledgerId) : null;
  const save = async () => {
    if (!ledgerId) { showToast("Choose the expense (for example Rent or Electricity)."); return; }
    if (!partyId && !paidFrom) { showToast("Choose who this is payable to, or whether it was paid from Cash or Bank."); return; }
    if (!(parseFloat(amount) > 0)) { showToast("Enter the amount."); return; }
    setSaving(true);
    try {
      const credit = paidFrom || partyId;
      const voucher = { business_id: businessId, vtype: "expense", voucher_no: voucherNo, vdate, party_ledger_id: partyId || null, main_ledger_id: ledgerId,
        narration, supply_type: supplyType, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, round_off: totals.roundOff, total: totals.total, attachment: photo,
        meta: { paid_from: paidFrom || null, ...(suggestion ? { ai: { suggested_ledger_id: suggestion.ledgerId, confidence: suggestion.confidence, decision: suggestion.ledgerId === ledgerId ? "accepted" : "changed" } } : {}) } };
      const lines = buildPurchaseInvoiceLines({ partyLedgerId: credit, purchaseLedgerId: ledgerId, gstLedgers: sys, invoiceTotals: totals });
      await api.saveVoucher(voucher, [], lines);
      showToast("Saved"); onSaved();
    } catch (e) { showToast(e.message); } finally { setSaving(false); }
  };
  return (
    <div className="max-w-lg">
      <BackHeader title="New Expense" onBack={onCancel} />
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" aria-label="Expense date" className={inputCls} value={vdate} onChange={(e) => setVdate(e.target.value)} /></Field>
          <Field label="Expense no."><input aria-label="Expense number" className={inputCls} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} /></Field>
        </div>
        <Field label="Customer / Vendor / Ledger (who it is payable to)"><PartyPicker kind="vendor" ledgers={ledgers} value={partyId} onChange={setPartyId} businessId={businessId} reload={reload} showToast={showToast} /></Field>
        <Field label="Remarks / what it was for"><textarea aria-label="Expense remarks" rows={2} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Jio fiber bill for October" /></Field>
        {suggestion && sugLedger && !ledgerId && !dismissed && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm" aria-label="Ledger suggestion">
            <div>Suggested expense: <b>{sugLedger.name}</b> · {Math.round(suggestion.confidence * 100)}% ({confidenceLabel(suggestion.confidence)} confidence)</div>
            <div className="text-[11px] text-gray-500">Based on {suggestion.basedOn} similar earlier entr{suggestion.basedOn === 1 ? "y" : "ies"}.</div>
            <div className="flex gap-2 mt-2"><button onClick={() => setLedgerId(suggestion.ledgerId)} className="text-xs bg-black text-white rounded px-3 py-1.5">Accept</button><button onClick={() => setDismissed(true)} className="text-xs border border-gray-300 bg-white rounded px-3 py-1.5">Change</button></div>
          </div>
        )}
        <Field label="Expense *"><ExpenseLedgerPicker ledgers={ledgers} value={ledgerId} onChange={setLedgerId} businessId={businessId} reload={reload} showToast={showToast} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount"><input type="number" aria-label="Expense amount" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="GST %"><input type="number" aria-label="Expense GST rate" className={inputCls} value={gstRate} onChange={(e) => setGstRate(parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Supply"><select aria-label="Expense supply" className={inputCls} value={supplyType} onChange={(e) => setSupplyType(e.target.value)}><option value="intra">Intra</option><option value="inter">Inter</option></select></Field>
        </div>
        <p className="text-xs text-gray-400">Total incl. tax: <b>{inr(totals.total)}</b></p>
        <Field label="Paid"><select aria-label="Paid from" className={inputCls} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}><option value="">On credit — to be paid later</option>{payFrom.map((l) => <option key={l.id} value={l.id}>Paid now from {l.name}</option>)}</select></Field>
        <PhotoPicker label="Upload or click purchase invoice photo" value={photo} onChange={setPhoto} />
        <button disabled={saving} onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function PurchasesScreen({ businessId, ledgers, items, vouchers, lines, allocations, business, reload, showToast, onOpenLightbox, goSettings, pendingOpen, clearPending }) {
  const [mode, setMode] = useState("list"); // list | bill | expense | debit
  const [cfg, setCfg] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const rows = vouchers.filter((v) => ["purchase_invoice", "expense", "debit_note"].includes(v.vtype));
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const TYPE = { purchase_invoice: "Purchase invoice", expense: "Expense", debit_note: "Debit note" };
  const statusOf = (v) => {
    if (v.vtype === "debit_note") return (v.meta || {}).status === "draft" ? { label: "Draft", cls: "bg-gray-100 text-gray-600" } : { label: "Debit note", cls: "bg-purple-50 text-purple-700" };
    if (v.vtype !== "purchase_invoice") return null;
    if ((v.meta || {}).status === "draft") return { label: "Draft", cls: "bg-gray-100 text-gray-600" };
    const paid = allocations.filter((a) => a.invoice_voucher_id === v.id).reduce((s, a) => s + Number(a.amount), 0);
    if (paid >= v.total - 0.5) return { label: "Paid", cls: "bg-green-50 text-green-700" };
    if (paid > 0) return { label: "Partly paid", cls: "bg-yellow-50 text-yellow-700" };
    return { label: "Unpaid", cls: "bg-red-50 text-red-700" };
  };
  const openNew = (vtype = "purchase_invoice") => { setCfg({ initial: null, vtype }); setMode("bill"); };
  const openBill = async (v) => {
    setBusyId(v.id);
    try { const [its, atts] = await Promise.all([api.fetchVoucherItems(v.id), api.fetchAttachments(v.id)]); setCfg({ vtype: v.vtype, initial: { voucher: v, items: its, attachments: atts } }); setMode("bill"); }
    catch (e) { showToast(e.message); } finally { setBusyId(null); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Delete ${v.voucher_no}? Its accounting entries are removed too. This cannot be undone.`)) return;
    try { await api.deleteVoucher(v.id); await reload(); showToast("Deleted"); } catch (e) { showToast(e.message); }
  };
  const done = async () => { await reload(); setMode("list"); setCfg(null); };
  useEffect(() => {
    if (!pendingOpen) return;
    const v = vouchers.find((x) => x.id === pendingOpen && x.vtype === "purchase_invoice");
    if (v) openBill(v);
    clearPending && clearPending();
  }, [pendingOpen]);

  if (mode === "bill") return <InvoiceForm key={cfg.initial?.voucher?.id || `new-${cfg.vtype || "purchase_invoice"}`} businessId={businessId} ledgers={ledgers} items={items} vtype={cfg.vtype || "purchase_invoice"} business={business} initial={cfg.initial} convertFrom={null} vouchers={vouchers} allocations={allocations} lines={lines} reload={reload} goSettings={goSettings} onCancel={() => { setMode("list"); setCfg(null); }} onSaved={done} showToast={showToast} onOpenLightbox={onOpenLightbox} />;
  if (mode === "expense") return <ExpenseForm vouchers={vouchers} businessId={businessId} ledgers={ledgers} business={business} reload={reload} onCancel={() => setMode("list")} onSaved={done} showToast={showToast} onOpenLightbox={onOpenLightbox} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-xl">Purchases</h2>
        <div className="flex gap-2">
          <button onClick={() => setMode("expense")} className="border border-gray-300 rounded px-3 py-2 text-sm">Expense</button>
          <button onClick={() => openNew("debit_note")} className="border border-gray-300 rounded px-3 py-2 text-sm">Debit Note</button>
          <button onClick={() => openNew()} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> New Purchase Invoice</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No purchases recorded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Voucher no.</th><th className="py-2 pr-2">Type</th><th className="py-2 pr-2">Vendor / ledger</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2 text-right">Total</th><th className="py-2"></th></tr></thead>
            <tbody>{rows.map((v) => {
              const st = statusOf(v); const clickable = ["purchase_invoice", "debit_note"].includes(v.vtype);
              return (
                <tr key={v.id} className={`border-b border-gray-100 ${clickable ? "hover:bg-gray-50 cursor-pointer" : ""}`} onClick={() => clickable && openBill(v)}>
                  <td className="py-2.5 pr-2 whitespace-nowrap">{v.vdate}</td>
                  <td className="py-2.5 pr-2">{v.voucher_no}{v.reference && <div className="text-[11px] text-gray-400">Vendor bill {v.reference}</div>}</td>
                  <td className="py-2.5 pr-2">{TYPE[v.vtype]}</td>
                  <td className="py-2.5 pr-2">{nameOf(v.party_ledger_id)}</td>
                  <td className="py-2.5 pr-2">{st && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>}</td>
                  <td className="py-2.5 pr-2 text-right tabnum">{inr(v.total)}</td>
                  <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}><button disabled={busyId === v.id} aria-label={`Delete ${v.voucher_no}`} onClick={() => remove(v)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============ Reports ============ */
function ReportsScreen({ ledgers, lines, vouchers, allocations = [], business, onOpenVoucher }) {
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
        <div className="flex gap-x-4 gap-y-2 flex-wrap text-sm">
          {[["trial", "Trial Balance"], ["pl", "Profit & Loss"], ["bs", "Balance Sheet"], ["sales", "Sales by salesperson"], ["gst", "GST"], ["recv", "Receivable ageing"], ["pay", "Payable ageing"], ["sreg", "Sales register"], ["preg", "Purchase register"]].map(([k, l]) => (
            <button key={k} onClick={() => setReport(k)} className={report === k ? "font-semibold border-b-2 border-black pb-1" : "text-gray-400 pb-1"}>{l}</button>
          ))}
        </div>
        {["trial", "pl", "bs"].includes(report) && <input type="date" aria-label="As at date" className={inputCls + " !w-auto"} value={asOf} onChange={(e) => setAsOf(e.target.value)} />}
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
      {report === "gst" && <GstReport vouchers={vouchers} ledgers={ledgers} />}
      {report === "recv" && <AgeingReport kind="receivable" vouchers={vouchers} allocations={allocations} ledgers={ledgers} lines={lines} />}
      {report === "pay" && <AgeingReport kind="payable" vouchers={vouchers} allocations={allocations} ledgers={ledgers} lines={lines} />}
      {report === "sreg" && <RegisterReport side="sales" vouchers={vouchers} ledgers={ledgers} />}
      {report === "preg" && <RegisterReport side="purchase" vouchers={vouchers} ledgers={ledgers} />}
      {report === "sales" && <SalesBySalesperson vouchers={vouchers} allocations={allocations} ledgers={ledgers} onOpenVoucher={onOpenVoucher} />}
      <p className="text-[11px] text-gray-400 mt-6">TDS and TCS reports are not available yet.</p>
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
