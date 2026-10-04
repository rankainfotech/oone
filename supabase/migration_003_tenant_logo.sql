-- ============================================================
-- OONE — Migration 003 (SAFE / ADDITIVE ONLY)
-- Adds one new column so each company can upload its own logo.
-- Does not touch or delete any existing data.
-- ============================================================

alter table tenants add column if not exists logo text;
