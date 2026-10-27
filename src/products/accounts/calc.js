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
 * Computes line-item and invoice-level totals for a Sales/Purchase style voucher.
 * Order of operations (same as standard Indian invoicing):
 *   qty x rate  ->  discount  ->  taxable value  ->  GST + other taxes  ->  rounding.
 * Options:
 *   discountType 'percent' | 'amount', discountValue
 *   extraTaxes [{name, rate}]  invoice-level other taxes, charged on the net taxable value
 */
export function computeInvoiceTotals(lineItems, { supplyType = "intra", roundTotal = true, discountType = "percent", discountValue = 0, extraTaxes = [] } = {}) {
  const grossAmounts = lineItems.map((li) => round2((Number(li.qty) || 0) * (Number(li.rate) || 0)));
  const gross = round2(grossAmounts.reduce((a, b) => a + b, 0));

  // --- discount, spread across lines so each line's tax is computed on what is really charged ---
  const dv = Math.max(0, Number(discountValue) || 0);
  let lineDiscounts;
  if (discountType === "amount") {
    const D = Math.min(dv, gross);
    lineDiscounts = [];
    let used = 0;
    grossAmounts.forEach((amt, i) => {
      if (i === grossAmounts.length - 1) lineDiscounts.push(round2(D - used));
      else { const d = gross > 0 ? round2((D * amt) / gross) : 0; lineDiscounts.push(d); used = round2(used + d); }
    });
  } else {
    const pct = Math.min(dv, 100);
    lineDiscounts = grossAmounts.map((amt) => round2((amt * pct) / 100));
  }

  let subtotal = 0, cgst = 0, sgst = 0, igst = 0, otherTax = 0, discountTotal = 0;
  const otherByName = {};
  const computedLines = lineItems.map((li, idx) => {
    const amount = grossAmounts[idx];
    const discountAmt = Math.min(lineDiscounts[idx], amount);
    const taxable = round2(amount - discountAmt);
    const { cgst: c, sgst: s, igst: i } = splitGst(taxable, li.gstRate, supplyType);
    // Several named other-taxes per line (e.g. Cess, TCS), each rounded on its own like GST.
    const taxList = Array.isArray(li.otherTaxes) ? li.otherTaxes : [];
    const otherBreakdown = taxList
      .filter((t) => Number(t.rate) > 0)
      .map((t) => ({ name: t.name || "Other tax", rate: Number(t.rate), amount: round2((taxable * Number(t.rate)) / 100) }));
    if (!otherBreakdown.length && Number(li.otherTaxRate) > 0) {
      otherBreakdown.push({ name: "Other tax", rate: Number(li.otherTaxRate), amount: round2((taxable * Number(li.otherTaxRate)) / 100) });
    }
    const other = round2(otherBreakdown.reduce((s2, t) => s2 + t.amount, 0));
    otherBreakdown.forEach((t) => { otherByName[t.name] = round2((otherByName[t.name] || 0) + t.amount); });
    subtotal += taxable; cgst += c; sgst += s; igst += i; otherTax += other; discountTotal += discountAmt;
    return { ...li, amount, discountAmt, taxable, cgstAmt: c, sgstAmt: s, igstAmt: i, otherTaxAmt: other, otherTaxBreakdown: otherBreakdown };
  });
  subtotal = round2(subtotal); cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst); otherTax = round2(otherTax); discountTotal = round2(discountTotal);

  // invoice-level other taxes, charged on the net taxable value
  const extraBreakdown = (extraTaxes || [])
    .filter((t) => Number(t.rate) > 0)
    .map((t) => ({ name: t.name || "Other tax", rate: Number(t.rate), amount: round2((subtotal * Number(t.rate)) / 100) }));
  extraBreakdown.forEach((t) => { otherByName[t.name] = round2((otherByName[t.name] || 0) + t.amount); otherTax = round2(otherTax + t.amount); });

  const preRound = round2(subtotal + cgst + sgst + igst + otherTax);
  const total = roundTotal ? Math.round(preRound) : preRound;
  const roundOff = round2(total - preRound);
  const otherTaxSummary = Object.entries(otherByName).map(([name, amount]) => ({ name, amount }));
  // `subtotal` is the NET taxable value (after discount) - this is what is posted to the Sales ledger.
  return { lines: computedLines, grossSubtotal: gross, discountTotal, subtotal, cgst, sgst, igst, otherTax, otherTaxSummary, roundOff, total };
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
