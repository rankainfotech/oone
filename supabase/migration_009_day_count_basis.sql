-- ============================================================
-- OONE — Migration 009 (SAFE / ADDITIVE ONLY)
-- Adds a choice between a 365-day year or a 360-day year
-- (30-day month convention) for simple-interest calculations.
-- Existing customers and items default to 365 days, so nothing
-- about their existing interest figures changes unless you
-- explicitly pick 360 days for them.
-- ============================================================

alter table customers add column if not exists day_count_basis text not null default '365';
alter table items add column if not exists day_count_basis text not null default '365';
