import { supabase } from "../../supabaseClient";
import { toDbLines } from "./calc";

// Supabase/Postgres rejects an explicit `id: null` on insert (violates the
// not-null id column even though a default exists) and rejects empty strings
// "" in numeric columns. This strips both problems from a row before sending.
function cleanRow(row, numericKeys = []) {
  const { id, ...rest } = row;
  const cleaned = { ...rest };
  for (const k of numericKeys) {
    if (cleaned[k] === "" || cleaned[k] === undefined) cleaned[k] = null;
  }
  return { id: id || null, cleaned };
}

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
  const { id, cleaned } = cleanRow(row, ["opening_balance"]);
  if (id) { const { error } = await supabase.from("acc_ledgers").update(cleaned).eq("id", id); if (error) throw error; return id; }
  const { data, error } = await supabase.from("acc_ledgers").insert(cleaned).select().single();
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
const ITEM_NUMERIC_KEYS = ["gst_rate", "other_tax_rate", "opening_qty", "opening_amount", "sale_rate", "purchase_rate"];
export async function saveItem(row) {
  const { id, cleaned } = cleanRow(row, ITEM_NUMERIC_KEYS);
  if (id) { const { error } = await supabase.from("acc_items").update(cleaned).eq("id", id); if (error) throw error; return id; }
  const { data, error } = await supabase.from("acc_items").insert(cleaned).select().single();
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
  // The accounting engine labels ledger lines {ledgerId}; the database expects {ledger_id}.
  const { data, error } = await supabase.rpc("acc_save_voucher", {
    p_voucher: voucher, p_items: items, p_lines: toDbLines(lines), p_allocs: allocs,
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
  const { id, cleaned } = cleanRow(row, ["hours"]);
  if (id) { const { error } = await supabase.from("acc_timesheets").update(cleaned).eq("id", id); if (error) throw error; return id; }
  const { data, error } = await supabase.from("acc_timesheets").insert(cleaned).select().single();
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

export async function updateVoucherMeta(id, meta) {
  const { error } = await supabase.from("acc_vouchers").update({ meta }).eq("id", id);
  if (error) throw error;
}

// ---------------- Salespersons ----------------
export async function fetchSalespersons(businessId) {
  const { data, error } = await supabase.from("acc_salespersons").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return data;
}
export async function saveSalesperson(row) {
  const { id, cleaned } = cleanRow(row);
  if (id) { const { error } = await supabase.from("acc_salespersons").update(cleaned).eq("id", id); if (error) throw error; return id; }
  const { data, error } = await supabase.from("acc_salespersons").insert(cleaned).select().single();
  if (error) throw error;
  return data.id;
}
export async function deleteSalesperson(id) {
  const { error } = await supabase.from("acc_salespersons").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- Invoice attachments ----------------
export async function fetchAttachments(voucherId) {
  const { data, error } = await supabase.from("acc_attachments").select("id,file_name,mime_type,size_bytes").eq("voucher_id", voucherId).order("created_at");
  if (error) throw error;
  return data;
}
export async function fetchAttachmentData(id) {
  const { data, error } = await supabase.from("acc_attachments").select("data,file_name,mime_type").eq("id", id).single();
  if (error) throw error;
  return data;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export async function uploadAttachment(businessId, voucherId, file) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const { error } = await supabase.from("acc_attachments").insert({ business_id: businessId, voucher_id: voucherId, file_name: file.name, mime_type: file.type, size_bytes: file.size, data });
  if (error) throw error;
}
export async function deleteAttachment(id) {
  const { error } = await supabase.from("acc_attachments").delete().eq("id", id);
  if (error) throw error;
}
