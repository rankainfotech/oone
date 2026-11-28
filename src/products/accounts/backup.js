import * as XLSX from "xlsx";
import * as api from "./data";
import { buildBackupSheets, safeFileName } from "./calc";

function saveBlob(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Reads everything in the business and downloads it as an Excel workbook or a JSON file. */
export async function downloadBackup(business, kind = "excel") {
  const id = business.id;
  const [ledgers, items, vouchers, lines, allocations, voucherItems, timesheets, bankRows] = await Promise.all([
    api.fetchLedgers(id), api.fetchItems(id), api.fetchVouchers(id), api.fetchVoucherLines(id), api.fetchAllocations(id),
    api.fetchAllVoucherItems(id), api.fetchTimesheetsPaged(id).catch(() => []), api.fetchBankRows(id).catch(() => []),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = safeFileName(`${business.name} backup`, stamp);
  if (kind === "json") {
    saveBlob(`${name}.json`, JSON.stringify({ app: "OONE", version: 1, exported_at: new Date().toISOString(), business, ledgers, items, vouchers, lines, allocations, voucher_items: voucherItems, timesheets, bank_rows: bankRows }, null, 2), "application/json");
  } else {
    const sheets = buildBackupSheets({ business, ledgers, items, vouchers, lines, allocations, voucherItems, timesheets, bankRows, exportedAt: stamp });
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([n, aoa]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n.slice(0, 31)));
    XLSX.writeFile(wb, `${name}.xlsx`);
  }
  return { ledgers: ledgers.length, vouchers: vouchers.length };
}
