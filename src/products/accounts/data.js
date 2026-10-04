import { supabase } from "../../supabaseClient";

// ---------------- Businesses ----------------
export async function fetchBusinesses() {
  const { data, error } = await supabase.from("acc_businesses").select("*").order("created_at");
  if (error) throw error;
  return data;
}
export async function createBusiness(fields) {
  const { data, error } = await supabase.rpc("acc_create_business", { p: fields });
  if (error) throw error;
  return data;
}
export async function updateBusiness(id, fields) {
  const { error } = await supabase.from("acc_businesses").update(fields).eq("id", id);
  if (error) throw error;
}

// ---------------- Entitlement ----------------
export async function fetchAccountsEntitlement(tenantId) {
  const { data, error } = await supabase.from("organization_products").select("*").eq("tenant_id", tenantId).eq("product_key", "accounts").maybeSingle();
  if (error) throw error;
  return data;
}
export async function startAccountsTrial(tenantId) {
  const { error } = await supabase.from("organization_products").insert({ tenant_id: tenantId, product_key: "accounts", status: "trial", max_businesses: 1 });
  if (error) throw error;
}

// ---------------- Ledgers ----------------
export async function fetchLedgers(businessId) {
  const { data, error } = await supabase.from("acc_ledgers").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return data;
}
export async function saveLedger(row) {
  if (row.id) { const { error } = await supabase.from("acc_ledgers").update(row).eq("id", row.id); if (error) throw error; return row.id; }
  const { data, error } = await supabase.from("acc_ledgers").insert(row).select().single();
  if (error) throw error;
  return data.id;
}
export async function deleteLedgerSafely(id) {
  const { data: lines } = await supabase.from("acc_voucher_lines").select("id").eq("ledger_id", id).limit(1);
  if (lines && lines.length > 0) return { blocked: true };
  const { error } = await supabase.from("acc_ledgers").delete().eq("id", id);
  if (error) throw error;
  return { blocked: false };
}

// ---------------- Items ----------------
export async function fetchItems(businessId) {
  const { data, error } = await supabase.from("acc_items").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return data;
}
export async function saveItem(row) {
  if (row.id) { const { error } = await supabase.from("acc_items").update(row).eq("id", row.id); if (error) throw error; return row.id; }
  const { data, error } = await supabase.from("acc_items").insert(row).select().single();
  if (error) throw error;
  return data.id;
}
export async function deleteItemSafely(id) {
  const { data: lines } = await supabase.from("acc_voucher_items").select("id").eq("item_id", id).limit(1);
  if (lines && lines.length > 0) return { blocked: true };
  const { error } = await supabase.from("acc_items").delete().eq("id", id);
  if (error) throw error;
  return { blocked: false };
}

// ---------------- Vouchers (invoices, receipts, payments, journals...) ----------------
export async function fetchVouchers(businessId, vtypes) {
  let q = supabase.from("acc_vouchers").select("*").eq("business_id", businessId).order("vdate", { ascending: false });
  if (vtypes) q = q.in("vtype", vtypes);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
export async function fetchVoucherLines(businessId) {
  const { data, error } = await supabase.from("acc_voucher_lines").select("*").eq("business_id", businessId);
  if (error) throw error;
  return data;
}
export async function fetchVoucherItems(voucherId) {
  const { data, error } = await supabase.from("acc_voucher_items").select("*").eq("voucher_id", voucherId).order("line_no");
  if (error) throw error;
  return data;
}
export async function fetchAllocations(businessId) {
  const { data, error } = await supabase.from("acc_allocations").select("*").eq("business_id", businessId);
  if (error) throw error;
  return data;
}
export async function saveVoucher(voucher, items, lines, allocs = []) {
  const { data, error } = await supabase.rpc("acc_save_voucher", {
    p_voucher: voucher, p_items: items, p_lines: lines, p_allocs: allocs,
  });
  if (error) throw error;
  return data;
}
export async function deleteVoucher(id) {
  const { error } = await supabase.from("acc_vouchers").delete().eq("id", id);
  if (error) throw error;
}

export async function nextVoucherNumber(businessId, vtype, prefix = "") {
  const { data, error } = await supabase.from("acc_vouchers").select("voucher_no").eq("business_id", businessId).eq("vtype", vtype).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return `${prefix}0001`;
  const last = data[0].voucher_no;
  const m = last.match(/(\d+)$/);
  if (!m) return `${prefix}0001`;
  const nextNum = String(Number(m[1]) + 1).padStart(m[1].length, "0");
  return last.slice(0, last.length - m[1].length) + nextNum;
}

// ---------------- Timesheets ----------------
export async function fetchTimesheets(businessId) {
  const { data, error } = await supabase.from("acc_timesheets").select("*").eq("business_id", businessId).order("tdate", { ascending: false });
  if (error) throw error;
  return data;
}
export async function saveTimesheet(row) {
  if (row.id) { const { error } = await supabase.from("acc_timesheets").update(row).eq("id", row.id); if (error) throw error; return row.id; }
  const { data, error } = await supabase.from("acc_timesheets").insert(row).select().single();
  if (error) throw error;
  return data.id;
}
export async function deleteTimesheet(id) {
  const { error } = await supabase.from("acc_timesheets").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- Bank import ----------------
export async function fetchBankRows(businessId, bankLedgerId) {
  let q = supabase.from("acc_bank_rows").select("*").eq("business_id", businessId).order("txn_date", { ascending: false });
  if (bankLedgerId) q = q.eq("bank_ledger_id", bankLedgerId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
export async function insertBankRows(rows) {
  const { error } = await supabase.from("acc_bank_rows").insert(rows);
  if (error) throw error;
}
export async function updateBankRow(id, fields) {
  const { error } = await supabase.from("acc_bank_rows").update(fields).eq("id", id);
  if (error) throw error;
}
