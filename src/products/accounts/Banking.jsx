import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import * as api from "./data";
import { inputCls, Field } from "../../shared";
import { BankPicker, Modal } from "./invoiceParts";
import { LedgerPicker } from "./Journal";
import { parseStatementRows, bankRowKey, matchBankRows, suggestBankLedger, confidenceLabel, buildReceiptLines, buildPaymentLines, round2 } from "./calc";

const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");
const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LEVEL = { strong: ["Strong match", "bg-green-100 text-green-800"], possible: ["Possible match", "bg-yellow-100 text-yellow-800"], weak: ["Weak match", "bg-orange-100 text-orange-800"], none: ["No match", "bg-red-100 text-red-800"] };

/** Reads the first sheet of a CSV / Excel file into rows of cells. */
export async function readStatementFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}

export default function BankingScreen({ businessId, ledgers, vouchers, lines, business, reload, showToast }) {
  const banks = ledgers.filter((l) => l.group_key === "bank_accounts");
  const [bankId, setBankId] = useState(banks[0]?.id || "");
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState(null);       // the row being turned into an entry
  const fileRef = useRef(null);
  const settings = business?.settings || {};
  useEffect(() => { if (!bankId && banks[0]) setBankId(banks[0].id); }, [banks.length]);

  const load = async () => { if (!bankId) { setRows([]); return; } try { setRows(await api.fetchBankRows(businessId, bankId)); } catch (e) { showToast(e.message); setRows([]); } };
  useEffect(() => { setRows(null); load(); }, [bankId, businessId]);

  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "—";
  const vById = useMemo(() => Object.fromEntries(vouchers.map((v) => [v.id, v])), [vouchers]);
  const pending = useMemo(() => (rows || []).filter((r) => r.status === "pending").map((r) => ({ ...r, date: r.txn_date, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 })), [rows]);
  const linkedIds = useMemo(() => new Set((rows || []).map((r) => r.voucher_id).filter(Boolean)), [rows]);

  // book entries that touch this bank and are not yet matched to a statement row
  const candidates = useMemo(() => {
    const by = {};
    for (const l of lines) { if (l.ledger_id !== bankId) continue; by[l.voucher_id] = (by[l.voucher_id] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0); }
    return Object.entries(by).filter(([id]) => vById[id] && !linkedIds.has(id)).map(([id, amount]) => { const v = vById[id]; return { voucherId: id, date: v.vdate, amount: round2(amount), voucherNo: v.voucher_no, party: nameOf(v.party_ledger_id), narration: v.narration || "", reference: v.reference || "", vtype: v.vtype }; });
  }, [lines, bankId, vById, linkedIds, ledgers]);
  const matches = useMemo(() => matchBankRows(pending, candidates), [pending, candidates]);

  // how rows like this were booked before (from rows already entered or matched)
  const history = useMemo(() => {
    const out = [];
    for (const r of rows || []) {
      if (r.status !== "matched" || !r.voucher_id) continue;
      const other = lines.filter((l) => l.voucher_id === r.voucher_id && l.ledger_id !== bankId).sort((a, b) => (Number(b.debit) + Number(b.credit)) - (Number(a.debit) + Number(a.credit)))[0];
      if (other) out.push({ description: r.description, ledgerId: other.ledger_id, direction: Number(r.credit) > 0 ? "in" : "out" });
    }
    return out;
  }, [rows, lines, bankId]);

  const counts = { pending: pending.length, matched: (rows || []).filter((r) => r.status === "matched").length, ignored: (rows || []).filter((r) => r.status === "ignored").length };
  const shown = (rows || []).filter((r) => filter === "all" || r.status === filter);
  const strong = pending.filter((r) => matches[r.id]?.level === "strong");

  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const parsed = parseStatementRows(await readStatementFile(f));
      if (parsed.error) { showToast(parsed.error); return; }
      const have = new Set((rows || []).map((r) => bankRowKey({ date: r.txn_date, description: r.description, debit: Number(r.debit), credit: Number(r.credit), reference: r.reference })));
      const fresh = parsed.rows.filter((r) => !have.has(bankRowKey(r)));
      setPreview({ file: f.name, ...parsed, fresh, dupes: parsed.rows.length - fresh.length });
    } catch (x) { showToast(`That file could not be read: ${x.message}`); }
  };
  const doImport = async () => {
    setBusy(true);
    try {
      await api.insertBankRows(preview.fresh.map((r) => ({ business_id: businessId, bank_ledger_id: bankId, txn_date: r.date, description: r.description, reference: r.reference, debit: r.debit, credit: r.credit })));
      showToast(`${preview.fresh.length} row${preview.fresh.length === 1 ? "" : "s"} imported${preview.dupes ? `, ${preview.dupes} already there were skipped` : ""}`);
      setPreview(null); await load();
    } catch (e) { showToast(e.message); } finally { setBusy(false); }
  };

  const accept = async (row, m) => { await api.updateBankRow(row.id, { status: "matched", voucher_id: m.voucherId }); };
  const acceptOne = async (row) => { try { await accept(row, matches[row.id]); await load(); showToast("Matched"); } catch (e) { showToast(e.message); } };
  const approveStrong = async () => {
    setBusy(true);
    try { for (const r of strong) await accept(r, matches[r.id]); await load(); showToast(`${strong.length} matched`); } catch (e) { showToast(e.message); } finally { setBusy(false); }
  };
  const setStatus = async (row, status) => { try { await api.updateBankRow(row.id, { status, voucher_id: null }); await load(); } catch (e) { showToast(e.message); } };

  const createEntry = async (row, ledgerId, narration) => {
    const isIn = Number(row.credit) > 0; const amount = isIn ? Number(row.credit) : Number(row.debit); const vtype = isIn ? "receipt" : "payment";
    const no = await api.nextVoucherNumber(businessId, vtype, isIn ? "RCT-" : "PMT-", settings.numbering?.[vtype], row.txn_date);
    const entryLines = isIn ? buildReceiptLines({ cashBankLedgerId: bankId, partyLedgerId: ledgerId, amount }) : buildPaymentLines({ cashBankLedgerId: bankId, partyLedgerId: ledgerId, amount });
    const voucher = { business_id: businessId, vtype, voucher_no: no, vdate: row.txn_date, party_ledger_id: ledgerId, cash_bank_ledger_id: bankId, narration: narration || row.description, reference: row.reference || null, total: amount, meta: { from_bank_statement: true } };
    const id = await api.saveVoucher(voucher, [], entryLines);
    await api.updateBankRow(row.id, { status: "matched", voucher_id: id });
  };
  const saveEntry = async (ledgerId, narration) => {
    if (!ledgerId) { showToast("Choose the ledger this belongs to."); return; }
    setBusy(true);
    try { await createEntry(entry.row, ledgerId, narration); setEntry(null); await reload(); await load(); showToast("Entry created and matched"); } catch (e) { showToast(e.message); } finally { setBusy(false); }
  };

  if (banks.length === 0) return (
    <div className="max-w-md"><h2 className="font-display text-xl mb-2">Banking</h2><p className="text-sm text-gray-500 mb-4">Add your bank account first, then import its statement here.</p>
      <BankPicker ledgers={ledgers} value="" onChange={(id) => setBankId(id)} businessId={businessId} reload={reload} showToast={showToast} /></div>);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-xl">Banking</h2>
        <div className="flex items-center gap-2">
          <select aria-label="Bank account" className={inputCls + " !w-auto"} value={bankId} onChange={(e) => setBankId(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" aria-label="Statement file" className="hidden" onChange={onFile} />
          <button onClick={() => fileRef.current?.click()} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium">Import statement</button>
        </div>
      </div>

      {preview && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 mb-5" aria-label="Import preview">
          <p className="text-sm font-medium">{preview.file}</p>
          <p className="text-sm text-gray-700 mt-1">Found <b>{preview.rows.length}</b> transactions ({dmy(preview.rows[0].date)} to {dmy(preview.rows[preview.rows.length - 1].date)}). <b>{preview.fresh.length}</b> are new{preview.dupes ? `, ${preview.dupes} are already in OONE and will be skipped` : ""}{preview.skipped ? `. ${preview.skipped} line${preview.skipped === 1 ? "" : "s"} without a date or amount were ignored` : ""}.</p>
          <div className="flex gap-2 mt-3"><button disabled={busy || !preview.fresh.length} onClick={doImport} className="bg-black text-white rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40">Import {preview.fresh.length}</button><button onClick={() => setPreview(null)} className="border border-gray-300 rounded px-4 py-1.5 text-sm bg-white">Cancel</button></div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {[["pending", "To do"], ["matched", "Matched"], ["ignored", "Ignored"], ["all", "All"]].map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={`text-xs rounded px-3 py-1.5 border ${filter === k ? "bg-black text-white border-black" : "border-gray-300 text-gray-600 hover:border-black"}`}>{l}{k !== "all" ? ` (${counts[k]})` : ""}</button>
        ))}
        {strong.length > 0 && <button disabled={busy} onClick={approveStrong} className="ml-auto text-sm bg-green-600 text-white rounded px-3.5 py-1.5 font-medium disabled:opacity-50">Approve {strong.length} strong match{strong.length === 1 ? "" : "es"}</button>}
      </div>

      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : shown.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">{filter === "pending" ? (rows.length ? "Everything is matched. Nothing left to do." : "No statement imported yet. Click Import statement and choose the CSV or Excel file from your bank.") : "Nothing here."}</p> : (
        <div className="space-y-2" aria-label="Bank statement rows">
          {shown.map((r) => {
            const m = matches[r.id]; const isIn = Number(r.credit) > 0; const amt = isIn ? Number(r.credit) : Number(r.debit);
            const sug = r.status === "pending" && (!m || m.level === "none" || m.level === "weak") ? suggestBankLedger({ description: r.description, debit: Number(r.debit), credit: Number(r.credit) }, history) : null;
            const linked = r.voucher_id ? vById[r.voucher_id] : null;
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg p-3" data-testid={`bank-row-${r.id}`}>
                <div className="flex justify-between gap-3 flex-wrap">
                  <div className="min-w-0"><div className="text-sm font-medium break-words">{r.description || "(no description)"}</div><div className="text-xs text-gray-400">{dmy(r.txn_date)}{r.reference ? ` · Ref ${r.reference}` : ""}</div></div>
                  <div className={`text-sm font-semibold tabnum ${isIn ? "text-green-700" : "text-red-700"}`}>{isIn ? "+" : "−"} ₹{fmt(amt)}<div className="text-[10px] font-normal text-gray-400 text-right">{isIn ? "money in" : "money out"}</div></div>
                </div>
                {r.status === "pending" && (
                  <div className="mt-2 pt-2 border-t border-gray-100 text-sm">
                    {m && m.level !== "none" ? (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${LEVEL[m.level][1]}`}>{LEVEL[m.level][0]}</span> <span className="text-gray-700">{m.candidate.vtype === "receipt" ? "Receipt" : m.candidate.vtype === "payment" ? "Payment" : "Entry"} {m.candidate.voucherNo} · {m.candidate.party} · {dmy(m.candidate.date)}</span><div className="text-[11px] text-gray-400">{m.reasons.join(", ")}</div></div>
                        <div className="flex gap-2"><button disabled={busy} onClick={() => acceptOne(r)} className="text-xs bg-black text-white rounded px-3 py-1.5">Accept match</button><button onClick={() => setEntry({ row: r })} className="text-xs border border-gray-300 rounded px-3 py-1.5">New entry instead</button><button onClick={() => setStatus(r, "ignored")} className="text-xs text-gray-500 underline">Ignore</button></div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${LEVEL.none[1]}`}>{LEVEL.none[0]}</span>{sug && <span className="ml-2 text-gray-700" aria-label="Suggested ledger">Suggested: <b>{nameOf(sug.ledgerId)}</b> · {Math.round(sug.confidence * 100)}% ({confidenceLabel(sug.confidence)} confidence)</span>}</div>
                        <div className="flex gap-2"><button onClick={() => setEntry({ row: r, ledgerId: sug?.ledgerId || "", confidence: sug?.confidence })} className="text-xs bg-black text-white rounded px-3 py-1.5">Create entry</button><button onClick={() => setStatus(r, "ignored")} className="text-xs text-gray-500 underline">Ignore</button></div>
                      </div>
                    )}
                  </div>
                )}
                {r.status === "matched" && <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-600 flex justify-between"><span><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800 mr-2">Matched</span>{linked ? `${linked.voucher_no} · ${nameOf(linked.party_ledger_id)}` : "entry"}</span><button onClick={() => setStatus(r, "pending")} className="text-gray-500 underline">Undo</button></div>}
                {r.status === "ignored" && <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 flex justify-between"><span>Ignored</span><button onClick={() => setStatus(r, "pending")} className="underline">Undo</button></div>}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-5">A match needs the exact same amount. The date, cheque / UTR number, voucher number and party name add confidence. Nothing is posted until you accept a match or save a new entry.</p>
      {entry && <EntryModal entry={entry} ledgers={ledgers.filter((l) => l.id !== bankId)} busy={busy} onClose={() => setEntry(null)} onSave={saveEntry} />}
    </div>
  );
}

function EntryModal({ entry, ledgers, busy, onClose, onSave }) {
  const r = entry.row; const isIn = Number(r.credit) > 0; const amt = isIn ? Number(r.credit) : Number(r.debit);
  const [ledgerId, setLedgerId] = useState(entry.ledgerId || "");
  const [narration, setNarration] = useState(r.description || "");
  return (
    <Modal title={isIn ? "Receipt for this deposit" : "Payment for this withdrawal"} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{dmy(r.txn_date)} · <b>₹{fmt(amt)}</b> {isIn ? "received" : "paid"} · {r.description}</p>
        {entry.confidence ? <p className="text-xs text-gray-500" aria-label="Suggestion note">Suggested from similar past entries ({Math.round(entry.confidence * 100)}%). Please confirm or change it.</p> : null}
        <Field label={isIn ? "Received from / credited to" : "Paid to / debited to"}><LedgerPicker ledgers={ledgers} value={ledgerId} onChange={setLedgerId} placeholder="Choose a customer, vendor or ledger" /></Field>
        <Field label="Narration"><input aria-label="Entry narration" className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        <button disabled={busy} onClick={() => onSave(ledgerId, narration)} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">Save entry and match</button>
      </div>
    </Modal>
  );
}
