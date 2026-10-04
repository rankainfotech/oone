-- ============================================================
-- OONE — Migration 005 (SAFE / ADDITIVE ONLY)
-- Adds support for additional money lent against an item that
-- was already mortgaged earlier (a "top-up"), instead of forcing
-- a brand new separate mortgage entry every time.
-- Does not touch or delete any existing data.
-- ============================================================

create table if not exists item_topups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id),
  item_id uuid not null references items(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  date date not null,
  amount numeric not null,
  payment_mode text not null default 'cash',
  bank_account_id uuid references bank_accounts(id),
  created_at timestamptz default now()
);

alter table item_topups enable row level security;
drop policy if exists "item topups tenant isolation" on item_topups;
create policy "item topups tenant isolation" on item_topups for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id());
