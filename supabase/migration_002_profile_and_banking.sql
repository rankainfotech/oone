-- ============================================================
-- OONE — Migration 002 (SAFE / ADDITIVE ONLY)
-- Run this once in: Supabase Dashboard → SQL Editor → New query
--
-- This migration only ADDS new columns and one new table.
-- It never drops, deletes, or overwrites anything you've
-- already recorded. Safe to run on a live database with
-- real customers already in it.
-- ============================================================

-- ---- Company profile fields on tenants ----
alter table tenants add column if not exists email text;
alter table tenants add column if not exists contact_no text;
alter table tenants add column if not exists pan text;
alter table tenants add column if not exists gstn text;
alter table tenants add column if not exists office_no text;
alter table tenants add column if not exists building_name text;
alter table tenants add column if not exists road_name text;
alter table tenants add column if not exists area text;
alter table tenants add column if not exists city text;
alter table tenants add column if not exists state text;
alter table tenants add column if not exists country text;
alter table tenants add column if not exists pin_code text;

-- Groundwork for future monetization — manually toggled by you for now
alter table tenants add column if not exists is_paid boolean not null default false;

-- Let a business owner edit their own company profile
-- (previously only a super admin could update the tenants row)
drop policy if exists "tenant owner update" on tenants;
create policy "tenant owner update" on tenants for update
  using (id = current_tenant_id())
  with check (id = current_tenant_id());

-- ---- Structured address + Govt ID on customers ----
-- (existing "address" text column is left exactly as-is)
alter table customers add column if not exists govt_id_number text;
alter table customers add column if not exists govt_id_photo text;
alter table customers add column if not exists flat_no text;
alter table customers add column if not exists building_name text;
alter table customers add column if not exists road_name text;
alter table customers add column if not exists area text;
alter table customers add column if not exists city text;
alter table customers add column if not exists state text;
alter table customers add column if not exists country text;
alter table customers add column if not exists pin_code text;

-- ---- Bank accounts (new table) ----
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id),
  bank_name text not null,
  account_number text not null,
  ifsc text,
  branch text,
  created_at timestamptz default now()
);
alter table bank_accounts enable row level security;
drop policy if exists "bank accounts tenant isolation" on bank_accounts;
create policy "bank accounts tenant isolation" on bank_accounts for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id());

-- ---- Cash / Bank mode on transactions ----
alter table items add column if not exists payment_mode text not null default 'cash';
alter table items add column if not exists bank_account_id uuid references bank_accounts(id);
alter table receipts add column if not exists payment_mode text not null default 'cash';
alter table receipts add column if not exists bank_account_id uuid references bank_accounts(id);

-- ============================================================
-- Done. Nothing above deletes or overwrites existing rows —
-- every existing customer, loan, and receipt is untouched.
-- ============================================================
