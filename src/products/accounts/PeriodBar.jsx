import React from "react";
import { todayISO, inputCls } from "../../shared";
import { periodRange } from "./calc";

export const PERIOD_PRESETS = [["thisFY", "This FY"], ["lastFY", "Last FY"], ["thisMonth", "This month"], ["lastMonth", "Last month"], ["last30", "Last 30 days"], ["all", "All time"], ["custom", "Custom"]];
export const initialPeriod = (today = todayISO()) => ({ preset: "thisFY", ...periodRange("thisFY", today) });
const dmy = (s) => (s ? s.split("-").reverse().join("-") : "");
export const periodLabel = (p) => (p.from || p.to ? `${dmy(p.from) || "…"} to ${dmy(p.to) || "…"}` : "All time");

/** Date filter used on the Dashboard and in reports. `value` = {preset, from, to}. */
export function PeriodBar({ value, onChange }) {
  const pick = (preset) => onChange({ preset, ...periodRange(preset, todayISO(), value) });
  return (
    <div className="flex items-center gap-2 flex-wrap" aria-label="Date filter">
      <div className="flex gap-1 flex-wrap">
        {PERIOD_PRESETS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={value.preset === k} onClick={() => pick(k)}
            className={`text-xs rounded px-2.5 py-1.5 border ${value.preset === k ? "bg-black text-white border-black" : "border-gray-300 text-gray-600 hover:border-black"}`}>{label}</button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="date" aria-label="Period from" className={inputCls + " !w-auto !py-1"} value={value.from || ""} onChange={(e) => onChange({ preset: "custom", from: e.target.value || null, to: value.to })} />
          to
          <input type="date" aria-label="Period to" className={inputCls + " !w-auto !py-1"} value={value.to || ""} onChange={(e) => onChange({ preset: "custom", from: value.from, to: e.target.value || null })} />
        </div>
      )}
      <span className="text-xs text-gray-400" aria-label="Selected period">{periodLabel(value)}</span>
    </div>
  );
}
