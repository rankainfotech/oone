import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { Landmark, Calculator, Boxes, Users2, ArrowRight, CheckCircle2 } from "lucide-react";
import { LOGO_DATA_URI } from "./logo";

const PRODUCTS = [
  {
    key: "mortgage",
    name: "Money Lending",
    tagline: "Mortgage & interest ledger software for lenders and pawnbrokers",
    icon: Landmark,
    status: "live",
    bullets: [
      "Customer-wise dashboard with cash & bank balances",
      "Simple and compound interest, 365 or 360-day calculation",
      "WhatsApp payment reminders in one tap",
      "Bank ledgers, Excel backups, full audit trail",
    ],
  },
  {
    key: "accounts",
    name: "myaccountsbook",
    tagline: "GST-ready accounting & invoicing software for Indian businesses",
    icon: Calculator,
    status: "coming_soon",
    bullets: ["GST invoicing & e-invoice", "Purchases, ledgers & journal entries", "Balance Sheet, P&L, GST reports"],
  },
  {
    key: "inventory",
    name: "Inventorybook",
    tagline: "Inventory and stock management software",
    icon: Boxes,
    status: "coming_soon",
    bullets: ["Stock tracking across locations", "Purchase & sales integration", "Low-stock alerts"],
  },
  {
    key: "payroll",
    name: "Payrollbook",
    tagline: "Payroll and statutory compliance software",
    icon: Users2,
    status: "coming_soon",
    bullets: ["Salary processing", "PF/ESI/TDS compliance", "Payslips & Form 16"],
  },
];

export default function LandingPage() {
  useEffect(() => {
    document.title = "OONE — Business Management Software for Money Lending, Accounting, Inventory & Payroll | India";
    const setMeta = (name, content) => {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("description", "OONE is a multi-product business management platform from India — money lending software, GST accounting software, inventory management, and payroll, built for small and growing businesses. Start free with Money Lending.");
    setMeta("keywords", "money lending software, mortgage accounting software, pawn shop software, GST accounting software India, online accounting software, inventory management software, payroll software India, business management platform, SaaS ERP India");
  }, []);

  return (
    <div className="min-h-screen bg-white font-body" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');`}</style>

      <header className="border-b border-gray-200 sticky top-0 bg-white/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <img src={LOGO_DATA_URI} alt="OONE — business management platform" className="h-9 object-contain" />
          <nav className="flex items-center gap-6 text-sm">
            <a href="#products" className="text-gray-600 hover:text-black hidden sm:inline">Products</a>
            <Link to="/products/mortgage" className="bg-black text-white rounded px-4 py-2 font-medium">Log in / Sign up</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="max-w-4xl mx-auto px-4 pt-16 pb-14 text-center">
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900">
            One platform. Every part of running your business.
          </h1>
          <p className="mt-5 text-lg text-gray-600 max-w-2xl mx-auto">
            OONE brings money lending, accounting, inventory, and payroll software together under one login —
            built in India, for Indian businesses that need software that actually fits how they work.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/products/mortgage" className="bg-black text-white rounded-lg px-6 py-3 font-medium flex items-center gap-2 hover:opacity-90">
              Start with Money Lending <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section id="products" className="max-w-6xl mx-auto px-4 pb-20">
          <h2 style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-2xl font-semibold text-center mb-2">Our products</h2>
          <p className="text-center text-gray-500 mb-10">Independent apps, one platform, one login.</p>
          <div className="grid sm:grid-cols-2 gap-5">
            {PRODUCTS.map((p) => (
              <div key={p.key} className="border border-gray-200 rounded-xl p-6 relative">
                {p.status === "coming_soon" && (
                  <span className="absolute top-4 right-4 text-[10px] font-medium bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Coming soon</span>
                )}
                <p.icon size={26} className="text-gray-800 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
                <p className="text-sm text-gray-500 mb-4">{p.tagline}</p>
                <ul className="space-y-1.5 mb-5">
                  {p.bullets.map((b) => (
                    <li key={b} className="text-sm text-gray-700 flex items-start gap-2"><CheckCircle2 size={15} className="text-gray-400 mt-0.5 shrink-0" /> {b}</li>
                  ))}
                </ul>
                {p.status === "live" ? (
                  <Link to="/products/mortgage" className="text-sm font-medium text-black underline">Get started →</Link>
                ) : (
                  <span className="text-sm text-gray-400">Notify me when it launches</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-gray-50 border-y border-gray-200 py-16">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-2xl font-semibold mb-3">Why lending businesses and accountants choose OONE</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Every OONE product is built around how Indian small businesses actually operate — mobile-first,
              WhatsApp-native, and priced for a business that's just getting started, not just enterprise budgets.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <span>© {new Date().getFullYear()}, Ranka Infotech LLP. All Rights Reserved.</span>
          <div className="flex gap-4">
            <Link to="/products/mortgage" className="hover:text-black">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
