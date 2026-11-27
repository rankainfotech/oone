import React, { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import * as XLSX from "xlsx";
import * as api from "./data";
import { todayISO, inputCls, Field, BackHeader } from "../../shared";
import { PartyPicker } from "./Invoice";
import { PeriodBar, initialPeriod, periodLabel } from "./PeriodBar";
import { round2, safeFileName } from "./calc";

const blank = () => ({ id: null, tdate: todayISO(), project: "", task: "", user_name: "", hours: "", billable: true, customer_ledger_id: "", notes: "" });
const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");

export default function TimesheetsScreen({ businessId, ledgers, reload, showToast }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [period, setPeriod] = useState(initialPeriod());
  const [project, setProject] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => { try { setRows(await api.fetchTimesheetsPaged(businessId)); } catch (e) { showToast(e.message); setRows([]); } };
  useEffect(() => { load(); }, [businessId]);

  const shown = useMemo(() => (rows || []).filter((r) => (!period.from || r.tdate >= period.from) && (!period.to || r.tdate <= period.to) && (!project || (r.project || "") === project)), [rows, period, project]);
  const projects = useMemo(() => [...new Set((rows || []).map((r) => r.project).filter(Boolean))].sort(), [rows]);
  const total = round2(shown.reduce((s, r) => s + (Number(r.hours) || 0), 0));
  const billable = round2(shown.filter((r) => r.billable).reduce((s, r) => s + (Number(r.hours) || 0), 0));
  const byProject = useMemo(() => { const m = {}; shown.forEach((r) => { const k = r.project || "(no project)"; m[k] = round2((m[k] || 0) + (Number(r.hours) || 0)); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [shown]);
  const nameOf = (id) => ledgers.find((l) => l.id === id)?.name || "";

  const save = async () => {
    const hours = Number(editing.hours);
    if (!editing.tdate) { showToast("Choose the date."); return; }
    if (!(hours > 0) || hours > 24) { showToast("Enter the hours worked (more than 0 and not more than 24)."); return; }
    setSaving(true);
    try {
      await api.saveTimesheet({ id: editing.id, business_id: businessId, tdate: editing.tdate, project: editing.project.trim() || null, task: editing.task.trim() || null, user_name: editing.user_name.trim() || null, hours, billable: !!editing.billable, customer_ledger_id: editing.customer_ledger_id || null, notes: editing.notes.trim() || null });
      await load(); setEditing(null); showToast("Saved");
    } catch (e) { showToast(e.message); } finally { setSaving(false); }
  };
  const remove = async (r) => { if (!window.confirm("Delete this time entry?")) return; try { await api.deleteTimesheet(r.id); await load(); } catch (e) { showToast(e.message); } };
  const download = () => {
    const aoa = [["Timesheet"], [periodLabel(period)], [], ["Date", "Project", "Task", "Person", "Customer", "Hours", "Billable", "Notes"], ...shown.map((r) => [dmy(r.tdate), r.project || "", r.task || "", r.user_name || "", nameOf(r.customer_ledger_id), Number(r.hours), r.billable ? "Yes" : "No", r.notes || ""]), ["", "", "", "", "Total", total, "", ""]];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Timesheet"); XLSX.writeFile(wb, `${safeFileName("Timesheet", periodLabel(period))}.xlsx`);
  };

  if (editing) {
    const set = (k, v) => setEditing((p) => ({ ...p, [k]: v }));
    return (
      <div className="max-w-lg">
        <BackHeader title={editing.id ? "Edit time entry" : "Log time"} onBack={() => setEditing(null)} />
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date *"><input type="date" aria-label="Date" className={inputCls} value={editing.tdate} onChange={(e) => set("tdate", e.target.value)} /></Field>
            <Field label="Hours *"><input type="number" step="0.25" min="0" aria-label="Hours" className={inputCls} value={editing.hours} onChange={(e) => set("hours", e.target.value)} placeholder="e.g. 2.5" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project"><input aria-label="Project" list="ts-projects" className={inputCls} value={editing.project} onChange={(e) => set("project", e.target.value)} /><datalist id="ts-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist></Field>
            <Field label="Task"><input aria-label="Task" className={inputCls} value={editing.task} onChange={(e) => set("task", e.target.value)} /></Field>
          </div>
          <Field label="Person"><input aria-label="Person" className={inputCls} value={editing.user_name} onChange={(e) => set("user_name", e.target.value)} placeholder="Who did the work" /></Field>
          <Field label="Customer (optional)"><PartyPicker kind="customer" ledgers={ledgers} value={editing.customer_ledger_id} onChange={(id) => set("customer_ledger_id", id)} businessId={businessId} reload={reload} showToast={showToast} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Billable" checked={editing.billable} onChange={(e) => set("billable", e.target.checked)} /> Billable to the customer</label>
          <Field label="Notes"><textarea aria-label="Notes" rows={2} className={inputCls} value={editing.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <button disabled={saving} onClick={save} className="w-full bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-xl">Timesheets</h2>
        <div className="flex gap-2"><button onClick={download} className="border border-gray-300 rounded px-3 py-2 text-sm flex items-center gap-1.5 hover:border-black"><Download size={14} /> Excel</button>
          <button onClick={() => setEditing(blank())} className="bg-black text-white rounded px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Log time</button></div>
      </div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <PeriodBar value={period} onChange={setPeriod} />
        <select aria-label="Filter by project" className={inputCls + " !w-auto"} value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5 text-sm">
        <div className="bg-gray-50 rounded-lg p-3"><div className="text-[11px] text-gray-500">Total hours</div><div className="font-display text-xl tabnum" aria-label="Total hours">{total}</div></div>
        <div className="bg-green-50 rounded-lg p-3"><div className="text-[11px] text-green-700">Billable</div><div className="font-display text-xl tabnum" aria-label="Billable hours">{billable}</div></div>
        <div className="bg-gray-50 rounded-lg p-3"><div className="text-[11px] text-gray-500">Not billable</div><div className="font-display text-xl tabnum" aria-label="Non-billable hours">{round2(total - billable)}</div></div>
      </div>
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : shown.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">No time logged in this period.</p> : (
        <>
          <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Time entries">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Project / task</th><th className="py-2 pr-2">Person</th><th className="py-2 pr-2">Customer</th><th className="py-2 pr-2 text-right">Hours</th><th /></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEditing({ ...blank(), ...r, hours: r.hours, project: r.project || "", task: r.task || "", user_name: r.user_name || "", customer_ledger_id: r.customer_ledger_id || "", notes: r.notes || "" })}>
                <td className="py-2.5 pr-2 whitespace-nowrap">{dmy(r.tdate)}</td><td className="py-2.5 pr-2">{r.project || "—"}{r.task && <div className="text-xs text-gray-400">{r.task}</div>}</td>
                <td className="py-2.5 pr-2">{r.user_name || "—"}</td><td className="py-2.5 pr-2">{nameOf(r.customer_ledger_id) || "—"}</td>
                <td className="py-2.5 pr-2 text-right tabnum">{Number(r.hours)}{!r.billable && <span className="ml-1 text-[10px] text-gray-400">non-billable</span>}</td>
                <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}><button aria-label={`Delete entry ${dmy(r.tdate)}`} onClick={() => remove(r)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>))}</tbody>
          </table></div>
          <h3 className="font-display text-base mt-6 mb-2">Hours by project</h3>
          <table className="w-full text-sm max-w-sm" aria-label="Hours by project"><tbody>{byProject.map(([p, h]) => <tr key={p} className="border-b border-gray-100"><td className="py-1.5">{p}</td><td className="py-1.5 text-right tabnum">{h}</td></tr>)}</tbody></table>
        </>
      )}
    </div>
  );
}
