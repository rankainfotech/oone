-- ============================================================
-- OONE — Migration 007 (SAFE / ADDITIVE ONLY)
-- Adds optional Quantity and Rate-per-unit fields to mortgaged
-- items (useful for gold/weight-based collateral), so the app
-- can show a collateral value and help judge top-up feasibility.
-- Does not touch or delete any existing data. Existing items
-- simply have these left blank until you fill them in.
-- ============================================================

alter table items add column if not exists quantity numeric;
alter table items add column if not exists rate_per_unit numeric;
