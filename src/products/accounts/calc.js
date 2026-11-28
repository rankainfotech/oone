// ============================================================
// myaccountsbook — pure accounting engine.
// No React, no Supabase — every function here takes plain data
// in and returns plain data out, so it can be unit-tested
// directly with Node before any UI is trusted to use it.
// ============================================================

export const round2 = (n) => {
  const num = Number(n) || 0;
  // Naive Math.round(n*100)/100 misrounds exact-half-paisa values (e.g. Rs 4.975)
  // roughly 1 in ~6500 times, because binary floating point can't represent many
  // decimals exactly and the scaled value lands a hair below the true .5 boundary.
  // Snapping to 12 significant digits first removes that representation noise
  // before rounding — verified against an independent decimal-string oracle
  // across 200,000 values with zero mismatches.
  return Math.round(Number((num * 100).toPrecision(12))) / 100;
};

/**
 * Splits a tax rate into CGST+SGST (intra-state) or IGST (inter-state).
 */
export function splitGst(amount, gstRate, supplyType) {
  const amt = Number(amount) || 0;
  const rate = Number(gstRate) || 0;
  const tax = round2((amt * rate) / 100);
  if (supplyType === "inter") return { cgst: 0, sgst: 0, igst: tax };
  const half = round2(tax / 2);
  return { cgst: half, sgst: round2(tax - half), igst: 0 };
}

/**
 * Line total <-> rate. When a user types the line TOTAL, the rate is derived from the quantity
 * (and stays exact, so qty x rate gives the typed total back). Returns null when qty is 0.
 */
export function rateFromTotal(total, qty) {
  const q = Number(qty) || 0;
  if (!q) return null;
  return (Number(total) || 0) / q;
}

/**
 * Computes line-item and invoice-level totals for a Sales/Purchase style voucher.
 * Order of operations (standard Indian invoicing):
 *   qty x rate -> discounts -> taxable value (+ additional charges) -> GST + other taxes -> rounding.
 * Options:
 *   discountType 'percent'|'amount', discountValue         the main discount
 *   extraDiscounts [{name, mode:'percent'|'fixed', value}]  further named discounts
 *   charges        [{name, mode:'percent'|'fixed', value, gstRate}]  additional charges (freight, packing...)
 *   extraTaxes     [{name, type:'percent'|'fixed_invoice'|'fixed_unit', value}]  invoice-level other taxes
 */
export function computeInvoiceTotals(lineItems, { supplyType = "intra", roundTotal = true, discountType = "percent", discountValue = 0, extraDiscounts = [], charges = [], extraTaxes = [] } = {}) {
  const grossAmounts = lineItems.map((li) => round2((Number(li.qty) || 0) * (Number(li.rate) || 0)));
  const gross = round2(grossAmounts.reduce((a, b) => a + b, 0));
  const qtyTotal = round2(lineItems.reduce((a, li) => a + (Number(li.qty) || 0), 0));

  // --- all discounts combined, then spread across lines so each line's tax is on what is really charged ---
  const dv = Math.max(0, Number(discountValue) || 0);
  const mainD = discountType === "amount" ? dv : round2((gross * Math.min(dv, 100)) / 100);
  const extraDiscountBreakdown = (extraDiscounts || [])
    .map((d) => ({ name: d.name || "Discount", amount: d.mode === "percent" ? round2((gross * Math.min(Math.max(Number(d.value) || 0, 0), 100)) / 100) : round2(Math.max(Number(d.value) || 0, 0)) }))
    .filter((d) => d.amount > 0);
  const D = Math.min(gross, round2(mainD + extraDiscountBreakdown.reduce((a, d) => a + d.amount, 0)));
  const lineDiscounts = [];
  let used = 0;
  grossAmounts.forEach((amt, i) => {
    if (i === grossAmounts.length - 1) lineDiscounts.push(Math.min(amt, round2(D - used)));
    else { const d = gross > 0 ? round2((D * amt) / gross) : 0; lineDiscounts.push(Math.min(amt, d)); used = round2(used + d); }
  });

  let subtotal = 0, cgst = 0, sgst = 0, igst = 0, otherTax = 0, discountTotal = 0;
  const otherByName = {};
  const computedLines = lineItems.map((li, idx) => {
    const amount = grossAmounts[idx];
    const discountAmt = lineDiscounts[idx];
    const taxable = round2(amount - discountAmt);
    const { cgst: c, sgst: s, igst: i } = splitGst(taxable, li.gstRate, supplyType);
    // Several named other-taxes per line (e.g. Cess), each rounded on its own like GST.
    const taxList = Array.isArray(li.otherTaxes) ? li.otherTaxes : [];
    const otherBreakdown = taxList
      .filter((t) => Number(t.rate) > 0)
      .map((t) => ({ name: t.name || "Other tax", rate: Number(t.rate), amount: round2((taxable * Number(t.rate)) / 100) }));
    if (!otherBreakdown.length && Number(li.otherTaxRate) > 0) {
      otherBreakdown.push({ name: "Other tax", rate: Number(li.otherTaxRate), amount: round2((taxable * Number(li.otherTaxRate)) / 100) });
    }
    const other = round2(otherBreakdown.reduce((s2, t) => s2 + t.amount, 0));
    otherBreakdown.forEach((t) => { otherByName[t.name] = round2((otherByName[t.name] || 0) + t.amount); });
    subtotal += amount - discountAmt; cgst += c; sgst += s; igst += i; otherTax += other; discountTotal += discountAmt;
    return { ...li, amount, discountAmt, taxable, cgstAmt: c, sgstAmt: s, igstAmt: i, otherTaxAmt: other, otherTaxBreakdown: otherBreakdown };
  });
  subtotal = round2(subtotal); cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst); otherTax = round2(otherTax); discountTotal = round2(discountTotal);

  // --- additional charges: added to the taxable value, with their own GST rate if any ---
  const lineNet = subtotal;
  const chargeBreakdown = [];
  let chargesTotal = 0;
  (charges || []).forEach((ch) => {
    const v = Math.max(Number(ch.value) || 0, 0);
    const amount = ch.mode === "percent" ? round2((lineNet * v) / 100) : round2(v);
    if (amount <= 0) return;
    const t = splitGst(amount, ch.gstRate, supplyType);
    chargeBreakdown.push({ name: ch.name || "Charge", amount, gstRate: Number(ch.gstRate) || 0, cgst: t.cgst, sgst: t.sgst, igst: t.igst });
    chargesTotal = round2(chargesTotal + amount);
    subtotal = round2(subtotal + amount); cgst = round2(cgst + t.cgst); sgst = round2(sgst + t.sgst); igst = round2(igst + t.igst);
  });

  // --- invoice-level other taxes, chosen from the Other Taxes master ---
  (extraTaxes || []).forEach((t) => {
    const v = Math.max(Number(t.value ?? t.rate) || 0, 0);
    if (!v) return;
    const type = t.type || "percent";
    const amount = type === "fixed_invoice" ? round2(v) : type === "fixed_unit" ? round2(v * qtyTotal) : round2((subtotal * v) / 100);
    if (amount <= 0) return;
    otherByName[t.name || "Other tax"] = round2((otherByName[t.name || "Other tax"] || 0) + amount);
    otherTax = round2(otherTax + amount);
  });

  const preRound = round2(subtotal + cgst + sgst + igst + otherTax);
  const total = roundTotal ? Math.round(preRound) : preRound;
  const roundOff = round2(total - preRound);
  const otherTaxSummary = Object.entries(otherByName).map(([name, amount]) => ({ name, amount }));
  // `subtotal` = net taxable value (after discounts, including additional charges): what is posted to the Sales ledger.
  return { lines: computedLines, grossSubtotal: gross, qtyTotal, discountTotal, extraDiscountBreakdown, chargeBreakdown, chargesTotal, subtotal, cgst, sgst, igst, otherTax, otherTaxSummary, roundOff, total };
}

/**
 * Builds the balanced double-entry ledger lines for a Sales Invoice.
 * Dr Party (total) ... Cr Sales, Cr GST output ledgers.
 * A TCS/TDS amount, if any, nets against the party's receivable.
 */
export function buildSalesInvoiceLines({ partyLedgerId, salesLedgerId, gstLedgers, invoiceTotals, tcsAmount = 0, tdsAmount = 0, tcsPayableLedgerId, tdsReceivableLedgerId }) {
  const { subtotal, cgst, sgst, igst, otherTax, roundOff, total } = invoiceTotals;
  const lines = [];
  const netReceivable = round2(total + (Number(tcsAmount) || 0) - (Number(tdsAmount) || 0));
  lines.push({ ledgerId: partyLedgerId, debit: netReceivable, credit: 0 });
  lines.push({ ledgerId: salesLedgerId, debit: 0, credit: subtotal });
  if (cgst) lines.push({ ledgerId: gstLedgers.cgst_out, debit: 0, credit: cgst });
  if (sgst) lines.push({ ledgerId: gstLedgers.sgst_out, debit: 0, credit: sgst });
  if (igst) lines.push({ ledgerId: gstLedgers.igst_out, debit: 0, credit: igst });
  if (otherTax) lines.push({ ledgerId: gstLedgers.other_tax_out, debit: 0, credit: otherTax });
  if (roundOff > 0) lines.push({ ledgerId: gstLedgers.round_off, debit: 0, credit: roundOff });
  if (roundOff < 0) lines.push({ ledgerId: gstLedgers.round_off, debit: -roundOff, credit: 0 });
  if (tcsAmount) lines.push({ ledgerId: tcsPayableLedgerId, debit: 0, credit: round2(tcsAmount) });
  if (tdsAmount) lines.push({ ledgerId: tdsReceivableLedgerId, debit: round2(tdsAmount), credit: 0 });
  return lines.filter((l) => l.debit || l.credit);
}

/** Mirror of buildSalesInvoiceLines for a Purchase Invoice / Expense (reversed Dr/Cr). */
export function buildPurchaseInvoiceLines({ partyLedgerId, purchaseLedgerId, gstLedgers, invoiceTotals, tdsAmount = 0, tdsPayableLedgerId }) {
  const { subtotal, cgst, sgst, igst, otherTax, roundOff, total } = invoiceTotals;
  const lines = [];
  const netPayable = round2(total - (Number(tdsAmount) || 0));
  lines.push({ ledgerId: purchaseLedgerId, debit: subtotal, credit: 0 });
  if (cgst) lines.push({ ledgerId: gstLedgers.cgst_in, debit: cgst, credit: 0 });
  if (sgst) lines.push({ ledgerId: gstLedgers.sgst_in, debit: sgst, credit: 0 });
  if (igst) lines.push({ ledgerId: gstLedgers.igst_in, debit: igst, credit: 0 });
  if (otherTax) lines.push({ ledgerId: gstLedgers.other_tax_in, debit: otherTax, credit: 0 });
  if (roundOff > 0) lines.push({ ledgerId: gstLedgers.round_off, debit: roundOff, credit: 0 });
  if (roundOff < 0) lines.push({ ledgerId: gstLedgers.round_off, debit: 0, credit: -roundOff });
  if (tdsAmount) lines.push({ ledgerId: tdsPayableLedgerId, debit: 0, credit: round2(tdsAmount) });
  lines.push({ ledgerId: partyLedgerId, debit: 0, credit: netPayable });
  return lines.filter((l) => l.debit || l.credit);
}

/** A Receipt: Dr Cash/Bank, Cr Customer (money coming in). */
export function buildReceiptLines({ cashBankLedgerId, partyLedgerId, amount }) {
  const amt = round2(amount);
  return [
    { ledgerId: cashBankLedgerId, debit: amt, credit: 0 },
    { ledgerId: partyLedgerId, debit: 0, credit: amt },
  ];
}
/** A Payment: Dr Vendor, Cr Cash/Bank (money going out). */
export function buildPaymentLines({ cashBankLedgerId, partyLedgerId, amount }) {
  const amt = round2(amount);
  return [
    { ledgerId: partyLedgerId, debit: amt, credit: 0 },
    { ledgerId: cashBankLedgerId, debit: 0, credit: amt },
  ];
}

/** True if a set of {debit,credit} lines is balanced within rounding tolerance. */
export function linesAreBalanced(lines) {
  const dr = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const cr = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  return Math.abs(dr - cr) < 0.01;
}

// ---------------- Ledger groups & report classification ----------------

export const LEDGER_GROUPS = [
  { key: "capital_account", name: "Capital Account", nature: "liability", statement: "bs" },
  { key: "loans_liability", name: "Loans (Liability)", nature: "liability", statement: "bs" },
  { key: "current_liabilities", name: "Current Liabilities", nature: "liability", statement: "bs" },
  { key: "duties_taxes", name: "Duties & Taxes", nature: "liability", statement: "bs" },
  { key: "sundry_creditors", name: "Sundry Creditors (Vendors)", nature: "liability", statement: "bs" },
  { key: "fixed_assets", name: "Fixed Assets", nature: "asset", statement: "bs" },
  { key: "investments", name: "Investments", nature: "asset", statement: "bs" },
  { key: "loans_advances", name: "Loans & Advances (Asset)", nature: "asset", statement: "bs" },
  { key: "sundry_debtors", name: "Sundry Debtors (Customers)", nature: "asset", statement: "bs" },
  { key: "cash_in_hand", name: "Cash-in-Hand", nature: "asset", statement: "bs" },
  { key: "bank_accounts", name: "Bank Accounts", nature: "asset", statement: "bs" },
  { key: "stock_in_hand", name: "Stock-in-Hand", nature: "asset", statement: "bs" },
  { key: "direct_income", name: "Direct Income", nature: "income", statement: "pl" },
  { key: "indirect_income", name: "Indirect Income", nature: "income", statement: "pl" },
  { key: "sales_accounts", name: "Sales Accounts", nature: "income", statement: "pl" },
  { key: "direct_expenses", name: "Direct Expenses", nature: "expense", statement: "pl" },
  { key: "indirect_expenses", name: "Indirect Expenses", nature: "expense", statement: "pl" },
  { key: "purchase_accounts", name: "Purchase Accounts", nature: "expense", statement: "pl" },
];
export const groupInfo = (key) => LEDGER_GROUPS.find((g) => g.key === key) || { key, name: key, nature: "asset", statement: "bs" };

/**
 * Given ledgers (with opening_balance/opening_side/group_key) and all
 * voucher_lines (debit/credit), computes each ledger's closing balance
 * as of a date, expressed as {ledgerId, debit, credit, net, side}.
 * net > 0 means a debit balance, net < 0 means a credit balance.
 */
export function computeLedgerBalances(ledgers, lines, asOfDate, lineDatesByVoucher) {
  const totals = {};
  for (const l of ledgers) {
    const opening = Number(l.opening_balance) || 0;
    totals[l.id] = l.opening_side === "Cr" ? -opening : opening;
  }
  for (const line of lines) {
    if (asOfDate && lineDatesByVoucher && lineDatesByVoucher[line.voucher_id] > asOfDate) continue;
    if (!(line.ledger_id in totals)) totals[line.ledger_id] = 0;
    totals[line.ledger_id] += (Number(line.debit) || 0) - (Number(line.credit) || 0);
  }
  return ledgers.map((l) => {
    const net = round2(totals[l.id] || 0);
    return { ledgerId: l.id, name: l.name, groupKey: l.group_key, net, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
}

/** Trial Balance: every ledger's Dr/Cr closing balance. Must always sum equal. */
export function trialBalance(ledgers, lines, asOfDate, lineDatesByVoucher) {
  const rows = computeLedgerBalances(ledgers, lines, asOfDate, lineDatesByVoucher).filter((r) => r.debit || r.credit);
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

/** Profit & Loss between two dates: income ledgers minus expense ledgers. */
export function profitAndLoss(ledgers, lines, start, end, lineDatesByVoucher) {
  const inRange = lines.filter((l) => {
    const d = lineDatesByVoucher[l.voucher_id];
    return d && d >= start && d <= end;
  });
  const balances = computeLedgerBalances(ledgers.map((l) => ({ ...l, opening_balance: 0, opening_side: "Dr" })), inRange, end, lineDatesByVoucher);
  const byLedger = Object.fromEntries(balances.map((b) => [b.ledgerId, b.net]));
  const income = [], expense = [];
  let totalIncome = 0, totalExpense = 0;
  for (const l of ledgers) {
    const info = groupInfo(l.group_key);
    const net = byLedger[l.id] || 0;
    if (info.nature === "income" && net < 0) { income.push({ name: l.name, amount: -net }); totalIncome += -net; }
    if (info.nature === "expense" && net > 0) { expense.push({ name: l.name, amount: net }); totalExpense += net; }
  }
  totalIncome = round2(totalIncome); totalExpense = round2(totalExpense);
  return { income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) };
}

/** Balance Sheet as of a date: assets vs (liabilities + capital + retained P&L). */
export function balanceSheet(ledgers, lines, asOfDate, booksStartDate, lineDatesByVoucher) {
  const balances = computeLedgerBalances(ledgers, lines, asOfDate, lineDatesByVoucher);
  const byLedger = Object.fromEntries(balances.map((b) => [b.ledgerId, b.net]));
  const assets = [], liabilities = [];
  let totalAssets = 0, totalLiabilities = 0;
  for (const l of ledgers) {
    const info = groupInfo(l.group_key);
    const net = byLedger[l.id] || 0;
    if (info.statement !== "bs") continue;
    if (info.nature === "asset" && net !== 0) { assets.push({ name: l.name, amount: net }); totalAssets += net; }
    if (info.nature === "liability" && net !== 0) { liabilities.push({ name: l.name, amount: -net }); totalLiabilities += -net; }
  }
  const pl = profitAndLoss(ledgers, lines, booksStartDate, asOfDate, lineDatesByVoucher);
  if (pl.netProfit !== 0) liabilities.push({ name: "Profit & Loss (current period)", amount: pl.netProfit });
  totalAssets = round2(totalAssets);
  totalLiabilities = round2(totalLiabilities + pl.netProfit);
  return { assets, liabilities, totalAssets, totalLiabilities, balanced: Math.abs(totalAssets - totalLiabilities) < 0.01, netProfit: pl.netProfit };
}


/**
 * Converts engine ledger lines ({ledgerId,...}) into the shape the database
 * function expects ({ledger_id,...}). Refuses to send a line with no ledger.
 */
export function toDbLines(lines) {
  return lines.map((l, i) => {
    const ledger_id = l.ledgerId ?? l.ledger_id;
    if (!ledger_id) throw new Error("A ledger needed to post this entry was not found. Please reload the page; if it continues, the business's built-in ledgers may be missing.");
    return { line_no: i + 1, ledger_id, debit: round2(l.debit || 0), credit: round2(l.credit || 0), narration: l.narration || null };
  });
}

// ---------------- Place of supply (decides IGST vs CGST+SGST automatically) ----------------

export const STATE_CODES = {
  "Jammu & Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03", "Chandigarh": "04", "Uttarakhand": "05", "Haryana": "06",
  "Delhi": "07", "Rajasthan": "08", "Uttar Pradesh": "09", "Bihar": "10", "Sikkim": "11", "Arunachal Pradesh": "12", "Nagaland": "13",
  "Manipur": "14", "Mizoram": "15", "Tripura": "16", "Meghalaya": "17", "Assam": "18", "West Bengal": "19", "Jharkhand": "20",
  "Odisha": "21", "Chhattisgarh": "22", "Madhya Pradesh": "23", "Gujarat": "24", "Dadra & Nagar Haveli and Daman & Diu": "26",
  "Maharashtra": "27", "Karnataka": "29", "Goa": "30", "Lakshadweep": "31", "Kerala": "32", "Tamil Nadu": "33", "Puducherry": "34",
  "Andaman & Nicobar Islands": "35", "Telangana": "36", "Andhra Pradesh": "37", "Ladakh": "38",
};
export const INDIAN_STATES = Object.keys(STATE_CODES).sort();
const STATE_ALIASES = {
  "orissa": "21", "new delhi": "07", "nct of delhi": "07", "delhi ncr": "07", "pondicherry": "34", "uttaranchal": "05",
  "jammu and kashmir": "01", "dadra and nagar haveli": "26", "daman and diu": "26", "dadra & nagar haveli": "26", "daman & diu": "26",
  "andaman and nicobar islands": "35", "andaman & nicobar": "35", "andaman and nicobar": "35",
  "dadra and nagar haveli and daman and diu": "26",
};
const normState = (n) => String(n || "").toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATE_CODES).map(([n, c]) => [normState(n), c]));
const VALID_CODES = new Set(Object.values(STATE_CODES));

/** GST state code from a GSTIN's first two digits, else from the state name. null if unknown. */
export function stateCodeOf(gstin, stateName) {
  const g = String(gstin || "").trim();
  if (/^\d{2}/.test(g) && VALID_CODES.has(g.slice(0, 2))) return g.slice(0, 2);
  const key = normState(stateName);
  return NAME_TO_CODE[key] || STATE_ALIASES[key] || null;
}
export const stateNameOfCode = (code) => Object.keys(STATE_CODES).find((n) => STATE_CODES[n] === code) || "";

/** Same state -> CGST+SGST ('intra'); different state -> IGST ('inter'). Unknown -> 'intra' with known:false. */
export function detectSupplyType(business, party) {
  const b = stateCodeOf(business?.gstin, business?.state);
  const c = stateCodeOf(party?.gstin, party?.state);
  if (!b || !c) return { type: "intra", known: false, businessState: stateNameOfCode(b), partyState: stateNameOfCode(c) };
  return { type: b === c ? "intra" : "inter", known: true, businessState: stateNameOfCode(b), partyState: stateNameOfCode(c) };
}

// ---------------- Amount in words (Indian system) ----------------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function below1000(n) {
  let out = "";
  if (n >= 100) { out += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) out += " "; }
  if (n >= 20) { out += TENS[Math.floor(n / 10)]; if (n % 10) out += " " + ONES[n % 10]; }
  else if (n > 0) out += ONES[n];
  return out;
}
export function amountInWords(amount) {
  const abs = Math.abs(Number(amount) || 0);
  let rupees = Math.floor(abs + 1e-9);
  let paise = Math.round((abs - rupees) * 100);
  if (paise === 100) { rupees += 1; paise = 0; }
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(below1000(crore) + " Crore");
  if (lakh) parts.push(below1000(lakh) + " Lakh");
  if (thousand) parts.push(below1000(thousand) + " Thousand");
  if (rupees) parts.push(below1000(rupees));
  let words = parts.length ? "Rupees " + parts.join(" ") : "Rupees Zero";
  if (paise) words += " and " + below1000(paise) + " Paise";
  return words + " Only";
}


/** A receipt split across several Cash / Bank ledgers: Dr each part, Cr the customer for the sum. */
export function buildSplitReceiptLines({ partyLedgerId, parts }) {
  const clean = (parts || []).map((p) => ({ ledgerId: p.ledgerId ?? p.ledger_id, amount: round2(p.amount) })).filter((p) => p.amount > 0);
  if (!clean.length) throw new Error("Enter an amount to receive.");
  if (clean.some((p) => !p.ledgerId)) throw new Error("Choose a bank account for every Bank amount.");
  const total = round2(clean.reduce((s, p) => s + p.amount, 0));
  return [...clean.map((p) => ({ ledgerId: p.ledgerId, debit: p.amount, credit: 0 })), { ledgerId: partyLedgerId, debit: 0, credit: total }];
}

/** Signed ledger balance: positive = Dr (receivable), negative = Cr. Includes the opening balance. */
export function ledgerBalanceOf(ledger, lines) {
  if (!ledger) return 0;
  const opening = Number(ledger.opening_balance) || 0;
  let bal = ledger.opening_side === "Cr" ? -opening : opening;
  for (const l of lines) if (l.ledger_id === ledger.id) bal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  return round2(bal);
}

// ---------------- configurable fields: safe formula evaluator ----------------
// A tiny arithmetic parser (numbers, field names, + - * / ( ) and %). It NEVER uses eval or Function,
// so a formula typed into Settings can only ever do arithmetic on known fields.
export function slugKey(label) {
  let k = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!k) k = "field";
  if (/^[0-9]/.test(k)) k = "f_" + k;
  return k;
}

function tokenize(expr) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy;
  let m;
  while (re.lastIndex < expr.length && (m = re.exec(expr))) {
    if (m[1] !== undefined) tokens.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "id", v: m[2] });
    else if ("+-*/()%".includes(m[3])) tokens.push({ t: "op", v: m[3] });
    else if (m[3].trim() !== "") throw new Error(`Unexpected character "${m[3]}"`);
  }
  return tokens;
}

function parseAndEval(expr, vars) {
  const tokens = tokenize(String(expr || ""));
  if (!tokens.length) throw new Error("Formula is empty");
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  function primary() {
    const t = take();
    if (!t) throw new Error("Formula ended unexpectedly");
    if (t.t === "num") return t.v;
    if (t.t === "id") {
      if (!Object.prototype.hasOwnProperty.call(vars, t.v)) throw new Error(`Unknown field "${t.v}"`);
      const v = Number(vars[t.v]);
      return Number.isFinite(v) ? v : 0;
    }
    if (t.v === "(") { const v = expr_(); const c = take(); if (!c || c.v !== ")") throw new Error("Missing )"); return v; }
    throw new Error(`Unexpected "${t.v}"`);
  }
  function factor() {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) { take(); const v = factor(); return t.v === "-" ? -v : v; }
    let v = primary();
    while (peek() && peek().t === "op" && peek().v === "%") { take(); v = v / 100; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = take().v; const r = factor();
      if (op === "/") { if (r === 0) throw new Error("Division by zero"); v = v / r; } else v = v * r;
    }
    return v;
  }
  function expr_() {
    let v = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) { const op = take().v; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  const result = expr_();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].v}"`);
  return result;
}

/** Evaluates a formula with the given field values. Returns a number, or null if it cannot be evaluated. */
export function evalFormula(expr, vars) {
  try { const v = parseAndEval(expr, vars || {}); return Number.isFinite(v) ? v : null; } catch (e) { return null; }
}
/** Returns null if the formula is valid for these field names, else a readable error message. */
export function validateFormula(expr, allowedKeys) {
  const vars = {}; (allowedKeys || []).forEach((k) => { vars[k] = 1; });
  try { parseAndEval(expr, vars); return null; } catch (e) { return e.message === "Division by zero" ? null : e.message; }
}
/** Evaluates calculated fields in order (later fields may use earlier ones). */
export function computeCalculatedFields(defs, vars) {
  const out = {}; const scope = { ...vars };
  for (const d of defs || []) {
    if (d.type !== "calculated") continue;
    const v = evalFormula(d.formula || "", scope);
    out[d.key] = v === null ? null : Math.round(v * 10000) / 10000;
    if (v !== null) scope[d.key] = out[d.key];
  }
  return out;
}


// ---------------- financial year (Indian: 1 April - 31 March) ----------------
export function fyStartYear(dateISO) { const [y, m] = String(dateISO).split("-").map(Number); return m >= 4 ? y : y - 1; }
/** "26-27" for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYearLabel(dateISO) { const y = fyStartYear(dateISO); return `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`; }
export function fyRange(dateISO) { const y = fyStartYear(dateISO); return { from: `${y}-04-01`, to: `${y + 1}-03-31` }; }

// ---------------- customised bill numbering ----------------
// number = prefix + zero-padded sequence + suffix. The token {FY} in the prefix or suffix becomes the
// financial year of the invoice date (e.g. "SJ/{FY}/" -> "SJ/26-27/"), so numbering restarts every April.
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const resolveAffix = (text, dateISO) => String(text || "").replace(/\{FY\}/gi, financialYearLabel(dateISO));
export const defaultNumbering = (prefix = "") => ({ prefix, suffix: "", start: 1, pad: 4 });
export function normalizeNumbering(cfg, defaultPrefix = "") {
  const d = defaultNumbering(defaultPrefix);
  const c = { ...d, ...(cfg || {}) };
  c.start = Math.max(1, Math.floor(Number(c.start)) || 1);
  c.pad = Math.min(10, Math.max(1, Math.floor(Number(c.pad)) || 1));
  c.prefix = String(c.prefix ?? ""); c.suffix = String(c.suffix ?? "");
  return c;
}
export function formatVoucherNo(cfg, seq, dateISO) {
  const c = normalizeNumbering(cfg);
  return resolveAffix(c.prefix, dateISO) + String(seq).padStart(c.pad, "0") + resolveAffix(c.suffix, dateISO);
}
/** The sequence number inside a voucher number, or null if it does not follow this format (manual numbers). */
export function parseVoucherSeq(cfg, voucherNo, dateISO) {
  const c = normalizeNumbering(cfg);
  const re = new RegExp("^" + escRe(resolveAffix(c.prefix, dateISO)) + "(\\d+)" + escRe(resolveAffix(c.suffix, dateISO)) + "$");
  const m = String(voucherNo || "").match(re);
  return m ? parseInt(m[1], 10) : null;
}
/** Highest existing number in THIS format (and financial year) + 1. Manually typed numbers in other formats are ignored. */
export function nextVoucherNo(existingNos, cfg, dateISO) {
  const c = normalizeNumbering(cfg);
  let max = c.start - 1;
  for (const no of existingNos || []) { const q = parseVoucherSeq(c, no, dateISO); if (q !== null && q > max) max = q; }
  return formatVoucherNo(c, max + 1, dateISO);
}
/** GST rule: an invoice number may be at most 16 characters, using only letters, digits, "/" and "-". */
export function gstNumberProblem(no) {
  const t = String(no || "");
  if (t.length > 16) return `GST rules allow at most 16 characters in an invoice number (this has ${t.length}).`;
  if (/[^A-Za-z0-9/-]/.test(t)) return "GST rules allow only letters, digits, / and - in an invoice number.";
  return null;
}
/** Turns raw database errors into something a shop owner can act on. */
export function friendlyDbError(message, voucherNo) {
  const m = String(message || "");
  if (/acc_vouchers_no_uq|duplicate key value/i.test(m) && /voucher/i.test(m)) return `The number ${voucherNo || ""} is already used. Type a different number, or choose "Use automatic number".`.replace("  ", " ");
  return m;
}

// ---------------- file names ----------------
/** A safe file name from parts, e.g. ("SJ/26-27/0001", "Ravi Traders") -> "SJ-26-27-0001 - Ravi Traders". */
export function safeFileName(...parts) {
  return parts.map((p) => String(p ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim()).filter(Boolean).join(" - ").replace(/-{2,}/g, "-").slice(0, 120);
}

// ---------------- bill (paper) sizes ----------------
// Every bill keeps at least 1 cm of white space on all four sides, whatever the paper size.
export const MIN_MARGIN_MM = 10;
export const PAPER_SIZES = {
  a4: { label: "A4 (210 × 297 mm)", page: "A4", margin: "12mm", font: 12, layout: "full" },
  a4l: { label: "A4 Landscape", page: "A4 landscape", margin: "10mm", font: 12, layout: "full" },
  a5: { label: "A5 (148 × 210 mm)", page: "A5", margin: "10mm", font: 10, layout: "full" },
  a5l: { label: "A5 Landscape (210 × 148 mm)", page: "A5 landscape", margin: "10mm", font: 10, layout: "full" },
  a6: { label: "A6 (105 × 148 mm)", page: "A6", margin: "10mm", font: 8.5, layout: "compact" },
  letter: { label: "Letter (8.5 × 11 in)", page: "Letter", margin: "12mm", font: 12, layout: "full" },
  thermal80: { label: "Thermal receipt, 80 mm roll", page: "80mm auto", margin: "10mm", font: 9.5, layout: "receipt", width: "60mm" },
  thermal58: { label: "Thermal receipt, 58 mm roll", page: "58mm auto", margin: "10mm", font: 8, layout: "receipt", width: "38mm" },
};
/** The page margin actually used: never less than 1 cm. */
export const pageMarginMm = (P) => Math.max(MIN_MARGIN_MM, parseFloat(P?.margin) || 0);

// ---------------- ledger statement (view a customer / vendor / any ledger) ----------------
export const VOUCHER_LABELS = { sales_invoice: "Sales Invoice", proforma_invoice: "Proforma", credit_note: "Credit Note", other_income: "Other Income", purchase_invoice: "Purchase", expense: "Expense", debit_note: "Debit Note", receipt: "Receipt", payment: "Payment", journal: "Journal" };
/** Opening, every posting in [from, to] with a running balance, and closing. Positive = Dr, negative = Cr. */
export function ledgerStatement(ledger, lines, vouchers, from, to) {
  const vById = Object.fromEntries(vouchers.map((v) => [v.id, v]));
  const op = Number(ledger.opening_balance) || 0;
  let opening = ledger.opening_side === "Cr" ? -op : op;
  const mine = lines.filter((l) => l.ledger_id === ledger.id && vById[l.voucher_id]).map((l) => ({ ...l, v: vById[l.voucher_id] }));
  for (const m of mine) if (from && m.v.vdate < from) opening += (Number(m.debit) || 0) - (Number(m.credit) || 0);
  opening = round2(opening);
  const inRange = mine.filter((m) => (!from || m.v.vdate >= from) && (!to || m.v.vdate <= to))
    .sort((a, b) => (a.v.vdate === b.v.vdate ? String(a.v.voucher_no).localeCompare(String(b.v.voucher_no)) : a.v.vdate < b.v.vdate ? -1 : 1));
  let bal = opening, totalDebit = 0, totalCredit = 0;
  const rows = inRange.map((m) => {
    const debit = round2(m.debit), credit = round2(m.credit);
    bal = round2(bal + debit - credit); totalDebit = round2(totalDebit + debit); totalCredit = round2(totalCredit + credit);
    return { date: m.v.vdate, vtype: m.v.vtype, label: VOUCHER_LABELS[m.v.vtype] || m.v.vtype, voucherId: m.v.id, voucherNo: m.v.voucher_no, narration: m.v.narration || "", debit, credit, balance: bal };
  });
  return { opening, rows, totalDebit, totalCredit, closing: bal };
}

/**
 * The GST table printed on every bill: one row per GST rate with the taxable value and the tax split.
 * Built from the same lines and charges that were used for the totals, so it always agrees with them.
 */
export function gstSummaryByRate(totals) {
  const byRate = {};
  const add = (rate, taxable, cgst, sgst, igst) => {
    const k = String(Number(rate) || 0);
    byRate[k] = byRate[k] || { rate: Number(rate) || 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    const r = byRate[k];
    r.taxable = round2(r.taxable + taxable); r.cgst = round2(r.cgst + cgst); r.sgst = round2(r.sgst + sgst); r.igst = round2(r.igst + igst);
  };
  (totals.lines || []).forEach((l) => add(l.gstRate, l.taxable || 0, l.cgstAmt || 0, l.sgstAmt || 0, l.igstAmt || 0));
  (totals.chargeBreakdown || []).forEach((c) => add(c.gstRate, c.amount || 0, c.cgst || 0, c.sgst || 0, c.igst || 0));
  const rows = Object.values(byRate).sort((a, b) => a.rate - b.rate).map((r) => ({ ...r, tax: round2(r.cgst + r.sgst + r.igst) }));
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, total: { taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), tax: sum("tax") }, hasTax: rows.some((r) => r.tax > 0) };
}


// ---------------- type-ahead suggestions (item search while typing) ----------------
/**
 * Ranks options for what was typed. Every typed word must match somewhere (name, group, code, HSN, rate...).
 * Names that START with the typed text come first, then words inside the name, then the other details.
 */
export function rankOptions(options, query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const words = (t) => t.split(/[^a-z0-9]+/).filter(Boolean);
  const scored = [];
  for (const o of options) {
    const label = String(o.label || "").toLowerCase();
    const other = `${o.sublabel || ""} ${o.keywords || ""}`.toLowerCase();
    let total = 0, ok = true;
    for (const t of tokens) {
      let sc;
      if (label.startsWith(t)) sc = 0;
      else if (words(label).some((w) => w.startsWith(t))) sc = 1;
      else if (label.includes(t)) sc = 2;
      else if (words(other).some((w) => w.startsWith(t))) sc = 3;
      else if (other.includes(t)) sc = 4;
      else { ok = false; break; }
      total += sc;
    }
    if (ok) scored.push({ o, total, label });
  }
  scored.sort((a, b) => a.total - b.total || (a.o.priority || 0) - (b.o.priority || 0) || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map((x) => x.o);
}


/** Paying a vendor, split across Cash and Bank: Dr the vendor for the sum, Cr each cash / bank ledger. */
export function buildSplitPaymentLines({ partyLedgerId, parts }) {
  const clean = (parts || []).map((p) => ({ ledgerId: p.ledgerId ?? p.ledger_id, amount: round2(p.amount) })).filter((p) => p.amount > 0);
  if (!clean.length) throw new Error("Enter an amount to pay.");
  if (clean.some((p) => !p.ledgerId)) throw new Error("Choose a bank account for every Bank amount.");
  const total = round2(clean.reduce((s, p) => s + p.amount, 0));
  return [{ ledgerId: partyLedgerId, debit: total, credit: 0 }, ...clean.map((p) => ({ ledgerId: p.ledgerId, debit: 0, credit: p.amount }))];
}

// ======================= Dashboard & reports =======================
const pad2 = (n) => String(n).padStart(2, "0");
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDaysISO = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Date range for a named period. from/to are null for "all time". */
export function periodRange(preset, todayISO, custom = {}) {
  const [y, m] = todayISO.split("-").map(Number);
  switch (preset) {
    case "thisFY": return fyRange(todayISO);
    case "lastFY": return fyRange(`${fyStartYear(todayISO) - 1}-04-01`);
    case "thisMonth": return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDayOf(y, m))}` };
    case "lastMonth": { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: `${py}-${pad2(pm)}-01`, to: `${py}-${pad2(pm)}-${pad2(lastDayOf(py, pm))}` }; }
    case "last30": return { from: addDaysISO(todayISO, -29), to: todayISO };
    case "all": return { from: null, to: null };
    default: return { from: custom.from || null, to: custom.to || null };
  }
}

const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
const isFinal = (v) => (v.meta?.status ?? "final") !== "draft";

/** Debit / credit movement per ledger inside a period. */
export function ledgerMovements(lines, vouchers, from, to) {
  const date = Object.fromEntries(vouchers.map((v) => [v.id, v.vdate]));
  const out = {};
  for (const l of lines) {
    if (!inRange(date[l.voucher_id], from, to)) continue;
    const m = (out[l.ledger_id] = out[l.ledger_id] || { debit: 0, credit: 0 });
    m.debit = round2(m.debit + (Number(l.debit) || 0)); m.credit = round2(m.credit + (Number(l.credit) || 0));
  }
  return out;
}

/** Income and expenses for every month of the period (empty months included). */
export function monthlySeries(ledgers, lines, vouchers, from, to) {
  const nature = Object.fromEntries(ledgers.map((l) => [l.id, groupInfo(l.group_key).nature]));
  const date = Object.fromEntries(vouchers.map((v) => [v.id, v.vdate]));
  const buckets = {};
  for (const l of lines) {
    const d = date[l.voucher_id]; if (!inRange(d, from, to)) continue;
    const n = nature[l.ledger_id]; if (n !== "income" && n !== "expense") continue;
    const k = d.slice(0, 7); const b = (buckets[k] = buckets[k] || { income: 0, expense: 0 });
    if (n === "income") b.income += (Number(l.credit) || 0) - (Number(l.debit) || 0); else b.expense += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  const keys = Object.keys(buckets).sort();
  const start = (from || keys[0] || "").slice(0, 7), end = (to || keys[keys.length - 1] || "").slice(0, 7);
  if (!start || !end) return [];
  const out = []; let [y, m] = start.split("-").map(Number); const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const k = `${y}-${pad2(m)}`; const b = buckets[k] || { income: 0, expense: 0 };
    out.push({ month: k, label: `${MONTHS[m - 1]} ${String(y).slice(-2)}`, income: round2(b.income), expense: round2(b.expense) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out.slice(-24);
}

/** Expenses by ledger in a period, biggest first. */
export function expenseBreakdown(ledgers, lines, vouchers, from, to) {
  const mv = ledgerMovements(lines, vouchers, from, to);
  return ledgers.filter((l) => groupInfo(l.group_key).nature === "expense")
    .map((l) => ({ ledgerId: l.id, name: l.name, amount: round2((mv[l.id]?.debit || 0) - (mv[l.id]?.credit || 0)) }))
    .filter((r) => r.amount > 0.005).sort((a, b) => b.amount - a.amount);
}

/** Quantity and value of stock per item (weighted average cost), from final purchase and sales bills. */
export function stockRegister(items, voucherItems, vouchers, asOf) {
  const vById = Object.fromEntries(vouchers.map((v) => [v.id, v]));
  const tracked = items.filter((i) => i.affects_inventory);
  const state = Object.fromEntries(tracked.map((i) => { const q = Number(i.opening_qty) || 0, a = Number(i.opening_amount) || 0; return [i.id, { qty: q, value: a, avg: q > 0 ? a / q : 0 }]; }));
  const events = voucherItems.filter((x) => x.item_id && state[x.item_id] && vById[x.voucher_id])
    .map((x) => ({ x, v: vById[x.voucher_id] }))
    .filter(({ v }) => isFinal(v) && (v.vtype === "purchase_invoice" || v.vtype === "sales_invoice") && (!asOf || v.vdate <= asOf))
    .sort((a, b) => (a.v.vdate === b.v.vdate ? String(a.v.voucher_no).localeCompare(String(b.v.voucher_no)) : a.v.vdate < b.v.vdate ? -1 : 1));
  for (const { x, v } of events) {
    const s = state[x.item_id]; const q = Number(x.qty) || 0;
    if (v.vtype === "purchase_invoice") {
      const amt = (Number(x.amount) || 0) - (Number(x.extra?.discount) || 0);
      s.qty += q; s.value += amt; if (s.qty > 0) s.avg = s.value / s.qty;
    } else {
      const cost = s.qty > 0 ? s.avg * Math.min(q, s.qty) : 0;
      s.qty -= q; s.value = s.qty > 0 ? Math.max(0, s.value - cost) : 0;
    }
  }
  const rows = tracked.map((i) => { const s = state[i.id]; return { itemId: i.id, name: i.name, unit: i.unit || "", qty: round2(s.qty), avgCost: round2(s.qty > 0 ? s.value / s.qty : s.avg), value: round2(Math.max(0, s.value)), negative: s.qty < -0.0001 }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, totalValue: round2(rows.reduce((s, r) => s + r.value, 0)) };
}

const CASH_GROUPS = ["cash_in_hand", "bank_accounts"];
/** Cash flow statement: opening cash+bank, what came in and went out by purpose, closing. Always ties to the cash and bank ledgers. */
export function cashFlowStatement(ledgers, lines, vouchers, from, to) {
  const cashIds = new Set(ledgers.filter((l) => CASH_GROUPS.includes(l.group_key)).map((l) => l.id));
  const gOf = Object.fromEntries(ledgers.map((l) => [l.id, l.group_key]));
  const vById = Object.fromEntries(vouchers.map((v) => [v.id, v]));
  let opening = 0;
  for (const l of ledgers) if (cashIds.has(l.id)) { const o = Number(l.opening_balance) || 0; opening += l.opening_side === "Cr" ? -o : o; }
  const byVoucher = {};
  for (const ln of lines) { if (!vById[ln.voucher_id]) continue; (byVoucher[ln.voucher_id] = byVoucher[ln.voucher_id] || []).push(ln); }
  const rowsMap = {};
  const classify = (group, inflow) => {
    const info = groupInfo(group);
    if (group === "sundry_debtors") return ["Operating", inflow ? "Received from customers" : "Paid to customers"];
    if (group === "sundry_creditors") return ["Operating", inflow ? "Received from vendors" : "Paid to vendors"];
    if (group === "duties_taxes") return ["Operating", inflow ? "Tax refunds / collected" : "Taxes paid"];
    if (info.nature === "income") return ["Operating", "Other income received"];
    if (info.nature === "expense") return ["Operating", inflow ? "Expense refunds" : "Expenses paid"];
    if (["fixed_assets", "investments", "loans_advances"].includes(group)) return ["Investing", inflow ? `Sale / recovery of ${info.name}` : `Purchase of ${info.name}`];
    if (["capital_account", "loans_liability"].includes(group)) return ["Financing", inflow ? "Capital / loans received" : "Capital withdrawn / loans repaid"];
    return ["Operating", inflow ? "Other receipts" : "Other payments"];
  };
  for (const [vid, vl] of Object.entries(byVoucher)) {
    const d = vById[vid].vdate;
    const cashNet = round2(vl.filter((l) => cashIds.has(l.ledger_id)).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0));
    if (from && d < from) { opening += cashNet; continue; }
    if (to && d > to) continue;
    if (cashNet === 0) continue;
    const counter = vl.filter((l) => !cashIds.has(l.ledger_id));
    if (!counter.length) continue;   // moving money between cash and bank
    const main = counter.reduce((a, b) => ((Number(b.debit) || 0) + (Number(b.credit) || 0) > (Number(a.debit) || 0) + (Number(a.credit) || 0) ? b : a));
    const [section, label] = classify(gOf[main.ledger_id], cashNet > 0);
    const r = (rowsMap[`${section}|${label}`] = rowsMap[`${section}|${label}`] || { section, label, inflow: 0, outflow: 0 });
    if (cashNet > 0) r.inflow = round2(r.inflow + cashNet); else r.outflow = round2(r.outflow - cashNet);
  }
  opening = round2(opening);
  const sections = ["Operating", "Investing", "Financing"].map((name) => {
    const rows = Object.values(rowsMap).filter((r) => r.section === name).sort((a, b) => a.label.localeCompare(b.label));
    const inflow = round2(rows.reduce((s, r) => s + r.inflow, 0)), outflow = round2(rows.reduce((s, r) => s + r.outflow, 0));
    return { name, rows, inflow, outflow, net: round2(inflow - outflow) };
  });
  const inflow = round2(sections.reduce((s, x) => s + x.inflow, 0)), outflow = round2(sections.reduce((s, x) => s + x.outflow, 0));
  return { opening, sections, inflow, outflow, net: round2(inflow - outflow), closing: round2(opening + inflow - outflow) };
}

/** Sales per salesperson (final tax invoices only): invoiced, collected and still to collect. */
export function salesBySalesperson(vouchers, allocations, from, to) {
  const paid = {}; for (const a of allocations || []) paid[a.invoice_voucher_id] = round2((paid[a.invoice_voucher_id] || 0) + Number(a.amount || 0));
  const groups = {};
  for (const v of vouchers) {
    if (v.vtype !== "sales_invoice" || !isFinal(v) || !inRange(v.vdate, from, to)) continue;
    const id = v.meta?.salesperson_id || null, nm = v.meta?.salesperson_name || "";
    const key = id || (nm ? `name:${nm.toLowerCase()}` : "none");
    const g = (groups[key] = groups[key] || { key, name: nm || (id ? "(removed salesperson)" : "No salesperson"), count: 0, net: 0, tax: 0, total: 0, collected: 0, invoices: [] });
    const tax = round2((Number(v.cgst) || 0) + (Number(v.sgst) || 0) + (Number(v.igst) || 0) + (Number(v.other_tax) || 0));
    const collected = Math.min(Number(v.total) || 0, paid[v.id] || 0);
    g.count += 1; g.net = round2(g.net + (Number(v.subtotal) || 0)); g.tax = round2(g.tax + tax); g.total = round2(g.total + (Number(v.total) || 0)); g.collected = round2(g.collected + collected);
    g.invoices.push({ id: v.id, date: v.vdate, no: v.voucher_no, partyId: v.party_ledger_id, total: round2(v.total), collected: round2(collected), outstanding: round2((Number(v.total) || 0) - collected) });
  }
  const rows = Object.values(groups).map((g) => ({ ...g, outstanding: round2(g.total - g.collected), invoices: g.invoices.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
    .sort((a, b) => (a.key === "none") - (b.key === "none") || b.net - a.net);
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  const totals = { count: rows.reduce((s, r) => s + r.count, 0), net: sum("net"), tax: sum("tax"), total: sum("total"), collected: sum("collected"), outstanding: sum("outstanding") };
  return { rows: rows.map((r) => ({ ...r, share: totals.net > 0 ? round2((r.net / totals.net) * 100) : 0 })), totals };
}

/** One search box over parties, products and bills. */
export function searchAccounts(query, { ledgers = [], items = [], vouchers = [] }) {
  const q = String(query || "").trim();
  if (q.length < 2) return { ledgers: [], items: [], vouchers: [] };
  const nameOf = Object.fromEntries(ledgers.map((l) => [l.id, l.name]));
  const typeOf = (l) => (l.kind === "customer" ? "Customer" : l.kind === "vendor" ? "Vendor" : groupInfo(l.group_key).name);
  const pick = (opts) => rankOptions(opts, q, 6).map((o) => o.src);
  return {
    ledgers: pick(ledgers.filter((l) => !l.system_key).map((l) => ({ label: l.name, sublabel: typeOf(l), keywords: [l.mobile, l.email, l.gstin, l.pan, l.city].filter(Boolean).join(" "), src: l }))),
    items: pick(items.map((i) => ({ label: i.name, sublabel: i.group_name || "", keywords: [i.item_code, i.hsn_sac, i.rfid, i.group_name].filter(Boolean).join(" "), src: i }))),
    vouchers: pick(vouchers.filter((v) => v.vtype !== "journal").map((v) => ({ label: String(v.voucher_no || ""), sublabel: nameOf[v.party_ledger_id] || "", keywords: [nameOf[v.party_ledger_id], v.reference, v.narration, v.po_number, String(v.total), VOUCHER_LABELS[v.vtype]].filter(Boolean).join(" "), src: v }))),
  };
}

// ======================= Credit / debit notes =======================
/** Credit note (sales return): the reverse of a sales invoice. Dr Sales Returns + GST output, Cr Customer. */
export function buildCreditNoteLines({ partyLedgerId, salesReturnLedgerId, gstLedgers, invoiceTotals }) {
  const { subtotal, cgst, sgst, igst, otherTax, roundOff, total } = invoiceTotals;
  const lines = [{ ledgerId: salesReturnLedgerId, debit: subtotal, credit: 0 }];
  if (cgst) lines.push({ ledgerId: gstLedgers.cgst_out, debit: cgst, credit: 0 });
  if (sgst) lines.push({ ledgerId: gstLedgers.sgst_out, debit: sgst, credit: 0 });
  if (igst) lines.push({ ledgerId: gstLedgers.igst_out, debit: igst, credit: 0 });
  if (otherTax) lines.push({ ledgerId: gstLedgers.other_tax_out, debit: otherTax, credit: 0 });
  if (roundOff > 0) lines.push({ ledgerId: gstLedgers.round_off, debit: roundOff, credit: 0 });
  if (roundOff < 0) lines.push({ ledgerId: gstLedgers.round_off, debit: 0, credit: -roundOff });
  lines.push({ ledgerId: partyLedgerId, debit: 0, credit: total });
  return lines.filter((l) => l.debit || l.credit);
}
/** Debit note (purchase return): the reverse of a purchase invoice. Dr Vendor, Cr Purchase Returns + GST input. */
export function buildDebitNoteLines({ partyLedgerId, purchaseReturnLedgerId, gstLedgers, invoiceTotals }) {
  const { subtotal, cgst, sgst, igst, otherTax, roundOff, total } = invoiceTotals;
  const lines = [{ ledgerId: partyLedgerId, debit: total, credit: 0 }, { ledgerId: purchaseReturnLedgerId, debit: 0, credit: subtotal }];
  if (cgst) lines.push({ ledgerId: gstLedgers.cgst_in, debit: 0, credit: cgst });
  if (sgst) lines.push({ ledgerId: gstLedgers.sgst_in, debit: 0, credit: sgst });
  if (igst) lines.push({ ledgerId: gstLedgers.igst_in, debit: 0, credit: igst });
  if (otherTax) lines.push({ ledgerId: gstLedgers.other_tax_in, debit: 0, credit: otherTax });
  if (roundOff > 0) lines.push({ ledgerId: gstLedgers.round_off, debit: 0, credit: roundOff });
  if (roundOff < 0) lines.push({ ledgerId: gstLedgers.round_off, debit: -roundOff, credit: 0 });
  return lines.filter((l) => l.debit || l.credit);
}

/** Journal entry: free Dr / Cr lines. Returns an error message, or null if it can be posted. */
export function validateJournal(rows) {
  const has = (r) => (Number(r.debit) || 0) > 0 || (Number(r.credit) || 0) > 0;
  const all = rows || [];
  if (all.some((r) => !r.ledgerId && has(r))) return "Choose a ledger on every line that has an amount.";
  if (all.some((r) => (Number(r.debit) || 0) > 0 && (Number(r.credit) || 0) > 0)) return "A line can be either a debit or a credit, not both.";
  const used = all.filter((r) => r.ledgerId && has(r));
  if (used.length < 2) return "A journal entry needs at least two lines.";
  const dr = round2(used.reduce((s2, r) => s2 + (Number(r.debit) || 0), 0)), cr = round2(used.reduce((s2, r) => s2 + (Number(r.credit) || 0), 0));
  if (Math.abs(dr - cr) > 0.005) return `Debits (${dr}) and credits (${cr}) must be equal. The difference is ${round2(Math.abs(dr - cr))}.`;
  return null;
}
export const journalLines = (rows) => rows.filter((r) => r.ledgerId && ((Number(r.debit) || 0) > 0 || (Number(r.credit) || 0) > 0)).map((r) => ({ ledgerId: r.ledgerId, debit: round2(r.debit || 0), credit: round2(r.credit || 0), narration: r.narration || null }));

// ======================= GSTIN =======================
const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}
/** Checks a GSTIN's format, state code and check character. (This does not ask the GST portal whether it is registered.) */
export function validateGstin(raw) {
  const g = String(raw || "").trim().toUpperCase();
  if (!g) return { valid: false, empty: true };
  if (g.length !== 15) return { valid: false, reason: "A GSTIN has 15 characters." };
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: "The format is wrong: 2 digits, the 10-character PAN, a digit or letter, Z, and a check character." };
  if (!VALID_CODES.has(g.slice(0, 2))) return { valid: false, reason: "The first two digits are not a valid state code." };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: "The last character does not fit the rest, so there is a typing mistake." };
  return { valid: true, stateCode: g.slice(0, 2), state: stateNameOfCode(g.slice(0, 2)), pan: g.slice(2, 12) };
}

// ======================= bank statement import =======================
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Indian bank dates: dd/mm/yyyy, dd-mm-yy, dd-Mon-yyyy, yyyy-mm-dd, or an Excel date number. Returns yyyy-mm-dd or null. */
export function parseLooseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); return null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]*(\d{2,4})/))) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  if (y < 100) y += 2000;
  if (!mo || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** "1,23,456.78", "₹ 500 Dr", "(250.00)" ... -> {value, side:'Dr'|'Cr'|null} */
export function parseMoney(v) {
  if (v === null || v === undefined || v === "") return { value: 0, side: null };
  if (typeof v === "number") return { value: Math.abs(v), side: null };
  let s = String(v).trim(); let side = null; let neg = false;
  if (/\bdr\b\.?$/i.test(s)) { side = "Dr"; s = s.replace(/\s*dr\.?$/i, ""); } else if (/\bcr\b\.?$/i.test(s)) { side = "Cr"; s = s.replace(/\s*cr\.?$/i, ""); }
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₹,\s]|rs\.?/gi, "");
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return { value: 0, side };
  return { value: round2(Math.abs(n)), side, neg };
}
const norm = (x) => String(x ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** Reads a bank statement (rows of cells from a CSV / Excel sheet) into debit / credit rows. */
export function parseStatementRows(aoa) {
  const rows = (aoa || []).map((r) => (Array.isArray(r) ? r : []));
  let h = -1, cols = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(norm);
    const find = (re, avoid) => { let idx = cells.findIndex((c) => re.test(c) && !(avoid && avoid.test(c))); return idx; };
    const date = (() => { const a = find(/(txn|transaction|post).*date|^date$/, /value/); return a >= 0 ? a : find(/date/, /value/) >= 0 ? find(/date/, /value/) : find(/date/); })();
    const debit = find(/withdraw|debit|^dr\b|paid out|money out/), credit = find(/deposit|credit|^cr\b|paid in|money in/), amount = find(/^amount|^txn amount|^transaction amount/);
    if (date >= 0 && (debit >= 0 || credit >= 0 || amount >= 0)) {
      cols = { date, debit, credit, amount, desc: find(/narration|description|particulars|details|remarks/), balance: find(/balance/), ref: find(/ref|chq|cheque|utr|instrument/), type: find(/dr\s*\/\s*cr|^type|cr\/dr/) };
      h = i; break;
    }
  }
  if (h < 0) return { rows: [], skipped: 0, error: "Could not find the column headings. The first rows should have a Date column and Debit/Withdrawal and Credit/Deposit columns (or an Amount column)." };
  const out = []; let skipped = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r.some((c) => String(c ?? "").trim() !== "")) continue;
    const date = parseLooseDate(r[cols.date]);
    let debit = 0, credit = 0;
    if (cols.debit >= 0) debit = parseMoney(r[cols.debit]).value;
    if (cols.credit >= 0) credit = parseMoney(r[cols.credit]).value;
    if (cols.amount >= 0 && !debit && !credit) {
      const a = parseMoney(r[cols.amount]); const t = cols.type >= 0 ? norm(r[cols.type]) : (a.side || "").toLowerCase();
      if (t.startsWith("dr") || t.startsWith("d") && !t.startsWith("dep") || a.neg) debit = a.value; else if (t.startsWith("cr") || t.startsWith("c") || t.startsWith("dep")) credit = a.value; else credit = a.value;
    }
    if (!date || (!debit && !credit)) { skipped++; continue; }
    out.push({ date, description: String(r[cols.desc] ?? "").trim(), reference: cols.ref >= 0 ? String(r[cols.ref] ?? "").trim() : "", debit, credit, balance: cols.balance >= 0 ? parseMoney(r[cols.balance]).value : null });
  }
  return { rows: out, skipped, error: out.length ? null : "No transactions were found under the headings." };
}
export const bankRowKey = (r) => [r.date, norm(r.description), round2(r.debit), round2(r.credit), norm(r.reference)].join("|");

// ======================= bank reconciliation (rules, not guesswork) =======================
const dayDiff = (a, b) => Math.abs(Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000));
const tokens = (t) => String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w) && !["upi", "neft", "imps", "rtgs", "the", "and", "for", "payment", "transfer", "bank", "ref", "txn", "chq", "cheque"].includes(w));
/**
 * Matches pending bank statement rows with entries already in the books for that bank ledger.
 * The amount must be exactly equal. Date, cheque / UTR / reference, voucher number and party name add confidence.
 * candidates: [{voucherId, date, amount (+ money in, - money out), voucherNo, party, narration, reference, vtype}]
 */
export function matchBankRows(bankRows, candidates) {
  const scored = [];
  for (const row of bankRows) {
    const signed = row.credit > 0 ? row.credit : -row.debit;
    for (const c of candidates) {
      if (Math.abs(c.amount - signed) > 0.005) continue;
      const dd = dayDiff(row.date, c.date); if (dd > 30) continue;
      let score = 30; const reasons = ["amount matches"];
      if (dd === 0) { score += 40; reasons.push("same date"); } else if (dd <= 2) { score += 32; reasons.push(`${dd} day apart`); } else if (dd <= 5) { score += 15; reasons.push(`${dd} days apart`); } else if (dd <= 10) { score += 5; reasons.push(`${dd} days apart`); }
      const hay = `${row.description} ${row.reference}`.toLowerCase();
      const refs = [c.reference, c.voucherNo].filter(Boolean).map((x) => String(x).toLowerCase());
      if (refs.some((x) => x.length >= 3 && hay.includes(x))) { score += 35; reasons.push("reference / number found"); }
      const pt = tokens(c.party); if (pt.length && pt.some((w) => hay.includes(w))) { score += 20; reasons.push("party name found"); }
      scored.push({ rowId: row.id, voucherId: c.voucherId, score, reasons, candidate: c });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const usedRow = new Set(), usedV = new Set(), result = {};
  for (const s of scored) { if (usedRow.has(s.rowId) || usedV.has(s.voucherId)) continue; usedRow.add(s.rowId); usedV.add(s.voucherId); result[s.rowId] = { ...s, level: s.score >= 70 ? "strong" : s.score >= 45 ? "possible" : "weak" }; }
  for (const row of bankRows) if (!result[row.id]) result[row.id] = { rowId: row.id, level: "none", score: 0, reasons: [], candidate: null };
  return result;
}
/** Suggests the ledger for a bank row from how similar rows were booked before. conf is 0-1. */
export function suggestBankLedger(row, history) {
  const rt = new Set(tokens(row.description)); if (!rt.size) return null;
  const dir = row.credit > 0 ? "in" : "out"; const votes = {}; let total = 0, hits = 0;
  for (const h of history || []) {
    if (h.direction !== dir) continue;
    const ht = tokens(h.description); if (!ht.length) continue;
    const common = ht.filter((w) => rt.has(w)).length; if (!common) continue;
    const sim = common / Math.max(rt.size, ht.length);
    votes[h.ledgerId] = (votes[h.ledgerId] || 0) + sim; total += sim; hits++;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]; if (!best) return null;
  const conf = Math.min(0.99, (best[1] / total) * Math.min(1, 0.45 + 0.18 * hits));
  return { ledgerId: best[0], confidence: round2(conf), basedOn: hits };
}
export const confidenceLabel = (c) => (c >= 0.9 ? "High" : c >= 0.6 ? "Medium" : "Low");
/** Suggests the expense ledger from this party and description's history. history: [{partyId, description, ledgerId}] */
export function suggestExpenseLedger({ history, partyId, description }) {
  const dt = new Set(tokens(description)); const votes = {}; let total = 0, hits = 0;
  for (const h of history || []) {
    const sameParty = partyId && h.partyId === partyId; const ht = tokens(h.description);
    const common = ht.filter((w) => dt.has(w)).length; const sim = ht.length && dt.size ? common / Math.max(ht.length, dt.size) : 0;
    const w = (sameParty ? 1 : 0) + sim * 0.8; if (w <= 0) continue;
    votes[h.ledgerId] = (votes[h.ledgerId] || 0) + w; total += w; hits++;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]; if (!best) return null;
  return { ledgerId: best[0], confidence: round2(Math.min(0.99, (best[1] / total) * Math.min(1, 0.5 + 0.17 * hits))), basedOn: hits };
}

// ======================= duplicate warnings =======================
/** Looks for an entry that may already be this one. Warns, never blocks. */
export function detectDuplicates(candidate, vouchers) {
  const out = [];
  for (const v of vouchers) {
    if (v.id === candidate.id || v.vtype !== candidate.vtype || (v.meta?.status ?? "final") === "draft") continue;
    const sameParty = candidate.partyId && v.party_ledger_id === candidate.partyId;
    const sameTotal = Math.abs((Number(v.total) || 0) - (Number(candidate.total) || 0)) < 0.01 && (Number(candidate.total) || 0) > 0;
    if (candidate.reference && sameParty && v.reference && String(v.reference).trim().toLowerCase() === String(candidate.reference).trim().toLowerCase()) out.push({ id: v.id, voucherNo: v.voucher_no, level: "high", reason: "the same vendor bill number from this vendor was already entered" });
    else if (sameParty && sameTotal && v.vdate === candidate.date) out.push({ id: v.id, voucherNo: v.voucher_no, level: "high", reason: "same party, amount and date" });
    else if (sameParty && sameTotal && dayDiff(v.vdate, candidate.date) <= 7) out.push({ id: v.id, voucherNo: v.voucher_no, level: "medium", reason: "same party and amount within a week" });
  }
  return out;
}

// ======================= ageing: who owes you / whom you owe =======================
const addDaysIso = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const BUCKETS = [["current", "Not due"], ["d1_30", "1–30 days"], ["d31_60", "31–60 days"], ["d61_90", "61–90 days"], ["d90", "Over 90 days"]];
const bucketOf = (overdue) => (overdue <= 0 ? "current" : overdue <= 30 ? "d1_30" : overdue <= 60 ? "d31_60" : overdue <= 90 ? "d61_90" : "d90");
/** Open bills by party in age buckets, tied back to each party's ledger balance. kind: 'receivable' | 'payable'. */
export function ageingReport({ vouchers, allocations, ledgers, lines, asOf, kind }) {
  const type = kind === "payable" ? "purchase_invoice" : "sales_invoice";
  const vById = Object.fromEntries(vouchers.map((v) => [v.id, v]));
  const paid = {};
  for (const a of allocations || []) { const src = vById[a.source_voucher_id]; if (src && src.vdate > asOf) continue; paid[a.invoice_voucher_id] = round2((paid[a.invoice_voucher_id] || 0) + Number(a.amount || 0)); }
  const dateOf = Object.fromEntries(vouchers.map((v) => [v.id, v.vdate]));
  const bal = {}; for (const l of ledgers) { const o = Number(l.opening_balance) || 0; bal[l.id] = l.opening_side === "Cr" ? -o : o; }
  for (const ln of lines || []) if (dateOf[ln.voucher_id] && dateOf[ln.voucher_id] <= asOf) bal[ln.ledger_id] = (bal[ln.ledger_id] || 0) + (Number(ln.debit) || 0) - (Number(ln.credit) || 0);
  const parties = {};
  for (const v of vouchers) {
    if (v.vtype !== type || (v.meta?.status ?? "final") === "draft" || v.vdate > asOf) continue;
    const payable = round2((Number(v.total) || 0) - (kind === "payable" ? Number(v.tds_amount) || 0 : 0));
    const open = round2(payable - (paid[v.id] || 0)); if (open <= 0.005) continue;
    const due = v.meta?.due_date || addDaysIso(v.vdate, Number(v.meta?.terms?.days) || 0);
    const overdue = Math.round((Date.parse(asOf + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000);
    const p = (parties[v.party_ledger_id] = parties[v.party_ledger_id] || { partyId: v.party_ledger_id, name: ledgers.find((l) => l.id === v.party_ledger_id)?.name || "—", buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 }, open: 0, overdueAmount: 0, maxOverdue: 0, bills: [] });
    const b = bucketOf(overdue); p.buckets[b] = round2(p.buckets[b] + open); p.open = round2(p.open + open);
    if (overdue > 0) { p.overdueAmount = round2(p.overdueAmount + open); p.maxOverdue = Math.max(p.maxOverdue, overdue); }
    p.bills.push({ id: v.id, no: v.voucher_no, date: v.vdate, due, overdue: Math.max(0, overdue), open, bucket: b });
  }
  const rows = Object.values(parties).map((p) => {
    const ledgerBal = round2((kind === "payable" ? -1 : 1) * (bal[p.partyId] || 0));
    const priority = p.overdueAmount <= 0 ? "none" : (p.buckets.d90 > 0 || (p.maxOverdue > 60 && p.overdueAmount >= 100000)) ? "high" : (p.buckets.d61_90 > 0 || p.buckets.d31_60 > 0) ? "medium" : "low";
    return { ...p, onAccount: round2(ledgerBal - p.open), ledgerBalance: ledgerBal, priority, bills: p.bills.sort((a, b) => b.overdue - a.overdue) };
  });
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || b.overdueAmount - a.overdueAmount || b.open - a.open);
  const totals = { open: 0, overdue: 0, buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 } };
  for (const r of rows) { totals.open = round2(totals.open + r.open); totals.overdue = round2(totals.overdue + r.overdueAmount); for (const [k] of BUCKETS) totals.buckets[k] = round2(totals.buckets[k] + r.buckets[k]); }
  return { rows, totals };
}

// ======================= GST report =======================
/** Outward tax, input credit, and the net GST position for a period (final bills only; notes reduce them). */
export function gstReport(vouchers, ledgers, from, to) {
  const gstinOf = Object.fromEntries(ledgers.map((l) => [l.id, l.gstin || ""])); const nameOf = Object.fromEntries(ledgers.map((l) => [l.id, l.name]));
  const inP = (v) => (v.meta?.status ?? "final") !== "draft" && (!from || v.vdate >= from) && (!to || v.vdate <= to);
  const sign = { sales_invoice: 1, credit_note: -1, purchase_invoice: 1, debit_note: -1 };
  const mk = (v, s) => ({ id: v.id, date: v.vdate, type: v.vtype, no: v.voucher_no, party: nameOf[v.party_ledger_id] || "—", gstin: gstinOf[v.party_ledger_id] || "", place: v.meta?.place_of_supply || "", taxable: round2(s * (Number(v.subtotal) || 0)), cgst: round2(s * (Number(v.cgst) || 0)), sgst: round2(s * (Number(v.sgst) || 0)), igst: round2(s * (Number(v.igst) || 0)), other: round2(s * (Number(v.other_tax) || 0)), total: round2(s * (Number(v.total) || 0)) });
  const outward = vouchers.filter((v) => ["sales_invoice", "credit_note"].includes(v.vtype) && inP(v)).map((v) => mk(v, sign[v.vtype])).sort((a, b) => (a.date < b.date ? -1 : 1));
  const inward = vouchers.filter((v) => ["purchase_invoice", "debit_note"].includes(v.vtype) && inP(v)).map((v) => mk(v, sign[v.vtype])).sort((a, b) => (a.date < b.date ? -1 : 1));
  const sum = (rows, k) => round2(rows.reduce((s, r) => s + r[k], 0));
  const tot = (rows) => ({ taxable: sum(rows, "taxable"), cgst: sum(rows, "cgst"), sgst: sum(rows, "sgst"), igst: sum(rows, "igst"), other: sum(rows, "other"), total: sum(rows, "total") });
  const b2b = outward.filter((r) => r.gstin), b2c = outward.filter((r) => !r.gstin);
  const out = tot(outward), inn = tot(inward);
  const net = { cgst: round2(out.cgst - inn.cgst), sgst: round2(out.sgst - inn.sgst), igst: round2(out.igst - inn.igst) };
  net.total = round2(net.cgst + net.sgst + net.igst);
  return { outward, inward, b2b, b2c, totals: { outward: out, b2b: tot(b2b), b2c: tot(b2c), inward: inn }, net };
}

// ======================= registers =======================
/** Sales or purchase register: every bill in the period with its totals (credit / debit notes shown as negatives). */
export function billRegister(vouchers, ledgers, from, to, side) {
  const types = side === "purchase" ? ["purchase_invoice", "debit_note"] : ["sales_invoice", "credit_note"];
  const neg = side === "purchase" ? "debit_note" : "credit_note";
  const g = Object.fromEntries(ledgers.map((l) => [l.id, l]));
  const rows = vouchers.filter((v) => types.includes(v.vtype) && (v.meta?.status ?? "final") !== "draft" && (!from || v.vdate >= from) && (!to || v.vdate <= to))
    .sort((a, b) => (a.vdate === b.vdate ? String(a.voucher_no).localeCompare(String(b.voucher_no)) : a.vdate < b.vdate ? -1 : 1))
    .map((v) => { const s = v.vtype === neg ? -1 : 1; return { id: v.id, date: v.vdate, type: v.vtype === neg ? (side === "purchase" ? "Debit note" : "Credit note") : (side === "purchase" ? "Purchase" : "Sales"), no: v.voucher_no, party: g[v.party_ledger_id]?.name || "—", gstin: g[v.party_ledger_id]?.gstin || "", taxable: round2(s * (Number(v.subtotal) || 0)), tax: round2(s * ((Number(v.cgst) || 0) + (Number(v.sgst) || 0) + (Number(v.igst) || 0) + (Number(v.other_tax) || 0))), total: round2(s * (Number(v.total) || 0)) }; });
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, totals: { taxable: sum("taxable"), tax: sum("tax"), total: sum("total") } };
}

// ======================= recurring invoices =======================
export function nextRecurringDate(dateISO, frequency) {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (frequency === "weekly") return addDaysIso(dateISO, 7);
  const add = frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 1;
  const total = (y * 12 + (m - 1)) + add; const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
/** Dates on which a recurring invoice is due up to today (it may be several if it was not opened for a while). */
export function dueRecurringDates(rec, todayISO, max = 12) {
  const out = []; let next = rec?.next;
  while (rec?.active && next && next <= todayISO && (!rec.end || next <= rec.end) && out.length < max) { out.push(next); next = nextRecurringDate(next, rec.frequency); }
  return { dates: out, next };
}

// ======================= backup =======================
/** Everything in the business laid out as readable sheets (and a check that the books still balance). */
export function buildBackupSheets({ business, ledgers, items, vouchers, lines, allocations, voucherItems = [], timesheets = [], bankRows = [], exportedAt }) {
  const lName = Object.fromEntries(ledgers.map((l) => [l.id, l.name]));
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.name]));
  const vById = Object.fromEntries(vouchers.map((v) => [v.id, v]));
  const typeOf = (l) => (l.kind === "customer" ? "Customer" : l.kind === "vendor" ? "Vendor" : groupInfo(l.group_key).name);
  const byDate = (a, b) => (a.vdate === b.vdate ? String(a.voucher_no).localeCompare(String(b.voucher_no)) : a.vdate < b.vdate ? -1 : 1);
  const ordered = [...vouchers].sort(byDate);
  const dr = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)), cr = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  return {
    About: [["OONE backup"], ["Business", business?.name || ""], ["GSTIN", business?.gstin || ""], ["Exported on", exportedAt || ""], [],
      ["Ledgers", ledgers.length], ["Products", items.length], ["Vouchers", vouchers.length], ["Accounting entries", lines.length], ["Total debits", dr], ["Total credits", cr], ["Books balanced", Math.abs(dr - cr) < 0.005 ? "Yes" : "NO — please tell support"]],
    Ledgers: [["Name", "Type", "Group", "Mobile", "Email", "GSTIN", "PAN", "State", "City", "Opening balance", "Dr/Cr"], ...ledgers.map((l) => [l.name, typeOf(l), groupInfo(l.group_key).name, l.mobile || "", l.email || "", l.gstin || "", l.pan || "", l.state || "", l.city || "", Number(l.opening_balance) || 0, l.opening_side || ""])],
    Products: [["Name", "Code", "HSN/SAC", "Sale rate", "Purchase rate", "GST %", "Unit", "Group", "Opening qty", "Opening amount"], ...items.map((i) => [i.name, i.item_code || "", i.hsn_sac || "", Number(i.sale_rate) || 0, Number(i.purchase_rate) || 0, Number(i.gst_rate) || 0, i.unit || "", i.group_name || "", Number(i.opening_qty) || 0, Number(i.opening_amount) || 0])],
    Vouchers: [["Date", "Type", "No.", "Party", "Taxable", "CGST", "SGST", "IGST", "Round off", "Total", "Status", "Reference", "Narration"], ...ordered.map((v) => [v.vdate, VOUCHER_LABELS[v.vtype] || v.vtype, v.voucher_no, lName[v.party_ledger_id] || "", Number(v.subtotal) || 0, Number(v.cgst) || 0, Number(v.sgst) || 0, Number(v.igst) || 0, Number(v.round_off) || 0, Number(v.total) || 0, v.meta?.status === "draft" ? "Draft" : "Final", v.reference || "", v.narration || ""])],
    Entries: [["Date", "Voucher type", "Voucher no.", "Ledger", "Debit", "Credit", "Narration"], ...lines.filter((l) => vById[l.voucher_id]).map((l) => ({ l, v: vById[l.voucher_id] })).sort((a, b) => byDate(a.v, b.v)).map(({ l, v }) => [v.vdate, VOUCHER_LABELS[v.vtype] || v.vtype, v.voucher_no, lName[l.ledger_id] || "", Number(l.debit) || 0, Number(l.credit) || 0, l.narration || ""])],
    "Bill items": [["Voucher no.", "Date", "Item", "HSN/SAC", "Qty", "Rate", "GST %", "Amount"], ...voucherItems.filter((x) => vById[x.voucher_id]).map((x) => [vById[x.voucher_id].voucher_no, vById[x.voucher_id].vdate, itemName[x.item_id] || x.description || "", x.hsn_sac || "", Number(x.qty) || 0, Number(x.rate) || 0, Number(x.gst_rate) || 0, Number(x.amount) || 0])],
    Settlements: [["Bill no.", "Settled by", "Amount"], ...allocations.map((a) => [vById[a.invoice_voucher_id]?.voucher_no || "", vById[a.source_voucher_id]?.voucher_no || "", Number(a.amount) || 0])],
    Timesheets: [["Date", "Project", "Task", "Person", "Hours", "Billable", "Customer", "Notes"], ...timesheets.map((t) => [t.tdate, t.project || "", t.task || "", t.user_name || "", Number(t.hours) || 0, t.billable ? "Yes" : "No", lName[t.customer_ledger_id] || "", t.notes || ""])],
    "Bank statement rows": [["Date", "Bank", "Description", "Reference", "Debit", "Credit", "Status"], ...bankRows.map((r) => [r.txn_date, lName[r.bank_ledger_id] || "", r.description || "", r.reference || "", Number(r.debit) || 0, Number(r.credit) || 0, r.status])],
  };
}
