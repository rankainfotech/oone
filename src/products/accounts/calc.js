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
export const PAPER_SIZES = {
  a4: { label: "A4 (210 × 297 mm)", page: "A4", margin: "12mm", font: 12, layout: "full" },
  a4l: { label: "A4 Landscape", page: "A4 landscape", margin: "10mm", font: 12, layout: "full" },
  a5: { label: "A5 (148 × 210 mm)", page: "A5", margin: "8mm", font: 10, layout: "full" },
  a5l: { label: "A5 Landscape (210 × 148 mm)", page: "A5 landscape", margin: "8mm", font: 10, layout: "full" },
  a6: { label: "A6 (105 × 148 mm)", page: "A6", margin: "5mm", font: 8.5, layout: "compact" },
  letter: { label: "Letter (8.5 × 11 in)", page: "Letter", margin: "12mm", font: 12, layout: "full" },
  thermal80: { label: "Thermal receipt, 80 mm roll", page: "80mm auto", margin: "3mm", font: 10, layout: "receipt", width: "74mm" },
  thermal58: { label: "Thermal receipt, 58 mm roll", page: "58mm auto", margin: "2mm", font: 9, layout: "receipt", width: "54mm" },
};

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
