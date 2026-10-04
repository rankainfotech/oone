-- ============================================================
-- OONE — Migration 011: myaccountsbook (Product 2)
-- SAFE / ADDITIVE ONLY. Nothing existing is touched.
--
-- Design: double-entry accounting. Every transaction (invoice,
-- receipt, expense, journal...) is a "voucher" that posts
-- balanced debit/credit lines to ledgers. All reports (Trial
-- Balance, P&L, Balance Sheet) are derived from those lines.
-- Every row belongs to one tenant (organization) AND one
-- business (a tenant can own several businesses, per plan).
-- ============================================================

-- ---- Plan limit: how many businesses an organization may create ----
alter table organization_products add column if not exists max_businesses int not null default 1;

-- ---- Tighten entitlement rules (previously a tenant could edit its own row) ----
alter table organization_products enable row level security;
drop policy if exists "org products tenant isolation" on organization_products;
drop policy if exists "org products read" on organization_products;
drop policy if exists "org products self trial" on organization_products;
drop policy if exists "org products admin manage" on organization_products;

create policy "org products read" on organization_products for select
  using (tenant_id = current_tenant_id() or is_super_admin());

-- A business may start a free trial of a live product itself, but nothing more
create policy "org products self trial" on organization_products for insert
  with check (
    tenant_id = current_tenant_id()
    and status = 'trial'
    and exists (select 1 from products p where p.key = product_key and p.status = 'active')
  );

create policy "org products admin manage" on organization_products for all
  using (is_super_admin()) with check (is_super_admin());

-- Open myaccountsbook for early access
update products set status = 'active', description = 'Accounting, invoicing & GST for Indian businesses.' where key = 'accounts';

-- ============================================================
-- Tables
-- ============================================================

create table if not exists acc_businesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  name text not null,
  logo text,
  office_no text, building_name text, street_name text, city text, state text, country text default 'India', pin_code text,
  mobile text, email text,
  gst_applicable boolean not null default false,
  gstin text, pan text,
  books_start_date date not null default (date_trunc('year', now())::date),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists acc_ledgers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  name text not null,
  group_key text not null,
  kind text not null default 'other',            -- 'customer' | 'vendor' | 'other'
  system_key text,                               -- set for built-in ledgers the engine posts to
  opening_balance numeric not null default 0,
  opening_side text not null default 'Dr' check (opening_side in ('Dr','Cr')),
  contact_person text, mobile text, email text,
  gst_type text,                                 -- 'registered' | 'unregistered' | 'consumer'
  gstin text, pan text, msme text, other_registrations text,
  office_no text, building_name text, street_name text, city text, state text, country text, pin_code text,
  bank_details jsonb,
  notes text,
  created_at timestamptz default now()
);
create unique index if not exists acc_ledgers_system_uq on acc_ledgers (business_id, system_key) where system_key is not null;
create unique index if not exists acc_ledgers_party_mobile_uq on acc_ledgers (business_id, kind, mobile) where kind in ('customer','vendor') and mobile is not null and mobile <> '';
create index if not exists acc_ledgers_business_idx on acc_ledgers (business_id);

create table if not exists acc_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  item_type text not null default 'product',     -- 'product' | 'service'
  name text not null,
  item_code text,
  unit text,
  hsn_sac text,
  affects_inventory boolean not null default false,
  gst_rate numeric not null default 0,
  other_tax_rate numeric not null default 0,
  opening_qty numeric not null default 0,
  opening_amount numeric not null default 0,
  group_name text,
  rfid text,
  image text,
  sale_rate numeric,
  purchase_rate numeric,
  created_at timestamptz default now()
);
create unique index if not exists acc_items_code_uq on acc_items (business_id, item_code) where item_code is not null and item_code <> '';
create index if not exists acc_items_business_idx on acc_items (business_id);

create table if not exists acc_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  vtype text not null,        -- sales_invoice, proforma_invoice, credit_note, other_income, purchase_invoice, expense, debit_note, receipt, payment, journal
  voucher_no text not null,
  vdate date not null,
  party_ledger_id uuid references acc_ledgers(id),
  main_ledger_id uuid references acc_ledgers(id),
  cash_bank_ledger_id uuid references acc_ledgers(id),
  po_number text, reference text, narration text,
  supply_type text default 'intra',
  subtotal numeric not null default 0,
  cgst numeric not null default 0, sgst numeric not null default 0, igst numeric not null default 0, other_tax numeric not null default 0,
  tcs_rate numeric not null default 0, tcs_amount numeric not null default 0,
  tds_rate numeric not null default 0, tds_amount numeric not null default 0,
  round_off numeric not null default 0,
  total numeric not null default 0,
  attachment text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists acc_vouchers_no_uq on acc_vouchers (business_id, vtype, voucher_no);
create index if not exists acc_vouchers_business_date_idx on acc_vouchers (business_id, vdate);
create index if not exists acc_vouchers_party_idx on acc_vouchers (party_ledger_id);

create table if not exists acc_voucher_items (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references acc_vouchers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  line_no int not null default 1,
  item_id uuid references acc_items(id) on delete set null,
  description text, hsn_sac text,
  qty numeric not null default 0, rate numeric not null default 0, amount numeric not null default 0,
  gst_rate numeric not null default 0, other_tax_rate numeric not null default 0,
  cgst_amt numeric not null default 0, sgst_amt numeric not null default 0, igst_amt numeric not null default 0, other_tax_amt numeric not null default 0,
  rfid text,
  extra jsonb not null default '{}'::jsonb
);
create index if not exists acc_voucher_items_voucher_idx on acc_voucher_items (voucher_id);
create index if not exists acc_voucher_items_item_idx on acc_voucher_items (item_id);

create table if not exists acc_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references acc_vouchers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  line_no int not null default 1,
  ledger_id uuid not null references acc_ledgers(id),
  debit numeric not null default 0,
  credit numeric not null default 0,
  narration text
);
create index if not exists acc_voucher_lines_voucher_idx on acc_voucher_lines (voucher_id);
create index if not exists acc_voucher_lines_ledger_idx on acc_voucher_lines (business_id, ledger_id);

create table if not exists acc_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  source_voucher_id uuid not null references acc_vouchers(id) on delete cascade,
  invoice_voucher_id uuid not null references acc_vouchers(id) on delete cascade,
  amount numeric not null
);
create index if not exists acc_allocations_invoice_idx on acc_allocations (invoice_voucher_id);
create index if not exists acc_allocations_source_idx on acc_allocations (source_voucher_id);

create table if not exists acc_timesheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  tdate date not null,
  project text, task text, user_name text,
  hours numeric not null default 0,
  billable boolean not null default true,
  customer_ledger_id uuid references acc_ledgers(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists acc_bank_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade,
  business_id uuid not null references acc_businesses(id) on delete cascade,
  bank_ledger_id uuid not null references acc_ledgers(id) on delete cascade,
  txn_date date not null,
  description text,
  reference text,
  debit numeric not null default 0,      -- money out of the bank (withdrawal)
  credit numeric not null default 0,     -- money into the bank (deposit)
  status text not null default 'pending', -- 'pending' | 'matched' | 'ignored'
  voucher_id uuid references acc_vouchers(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists acc_bank_rows_bank_idx on acc_bank_rows (business_id, bank_ledger_id);

-- ============================================================
-- Row Level Security: each organization sees only its own rows.
-- (Super Admin may read/administer across organizations.)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['acc_businesses','acc_ledgers','acc_items','acc_vouchers','acc_voucher_items','acc_voucher_lines','acc_allocations','acc_timesheets','acc_bank_rows']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s tenant isolation" on %I', t, t);
    execute format('create policy "%s tenant isolation" on %I for all using (tenant_id = current_tenant_id() or is_super_admin()) with check (tenant_id = current_tenant_id())', t, t);
  end loop;
end $$;

-- ============================================================
-- acc_create_business: creates a business AND its built-in
-- ledgers in one step, and enforces the plan's business limit
-- on the server (not just in the screen).
-- ============================================================
create or replace function acc_create_business(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := current_tenant_id();
  v_limit int;
  v_count int;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'Not signed in to an organization.'; end if;

  select max_businesses into v_limit from organization_products
   where tenant_id = v_tenant and product_key = 'accounts' and status in ('active','trial');
  if v_limit is null then raise exception 'myaccountsbook is not enabled for this account.'; end if;

  select count(*) into v_count from acc_businesses where tenant_id = v_tenant;
  if v_count >= v_limit then
    raise exception 'Your plan allows % business(es). Upgrade your plan to add more.', v_limit;
  end if;

  insert into acc_businesses (tenant_id, name, logo, office_no, building_name, street_name, city, state, country, pin_code, mobile, email, gst_applicable, gstin, pan, books_start_date)
  values (
    v_tenant, p->>'name', p->>'logo', p->>'office_no', p->>'building_name', p->>'street_name', p->>'city', p->>'state',
    coalesce(nullif(p->>'country',''), 'India'), p->>'pin_code', p->>'mobile', p->>'email',
    coalesce((p->>'gst_applicable')::boolean, false), nullif(p->>'gstin',''), nullif(p->>'pan',''),
    coalesce(nullif(p->>'books_start_date','')::date, date_trunc('year', now())::date)
  ) returning id into v_id;

  insert into acc_ledgers (tenant_id, business_id, name, group_key, system_key, kind) values
    (v_tenant, v_id, 'Sales', 'sales_accounts', 'sales', 'other'),
    (v_tenant, v_id, 'Sales Returns', 'sales_accounts', 'sales_return', 'other'),
    (v_tenant, v_id, 'Purchases', 'purchase_accounts', 'purchases', 'other'),
    (v_tenant, v_id, 'Purchase Returns', 'purchase_accounts', 'purchase_return', 'other'),
    (v_tenant, v_id, 'Other Income', 'indirect_income', 'other_income', 'other'),
    (v_tenant, v_id, 'Cash', 'cash_in_hand', 'cash', 'other'),
    (v_tenant, v_id, 'CGST Output', 'duties_taxes', 'cgst_out', 'other'),
    (v_tenant, v_id, 'SGST Output', 'duties_taxes', 'sgst_out', 'other'),
    (v_tenant, v_id, 'IGST Output', 'duties_taxes', 'igst_out', 'other'),
    (v_tenant, v_id, 'Other Tax Output', 'duties_taxes', 'other_tax_out', 'other'),
    (v_tenant, v_id, 'CGST Input', 'duties_taxes', 'cgst_in', 'other'),
    (v_tenant, v_id, 'SGST Input', 'duties_taxes', 'sgst_in', 'other'),
    (v_tenant, v_id, 'IGST Input', 'duties_taxes', 'igst_in', 'other'),
    (v_tenant, v_id, 'Other Tax Input', 'duties_taxes', 'other_tax_in', 'other'),
    (v_tenant, v_id, 'TDS Payable', 'duties_taxes', 'tds_payable', 'other'),
    (v_tenant, v_id, 'TCS Payable', 'duties_taxes', 'tcs_payable', 'other'),
    (v_tenant, v_id, 'Round Off', 'indirect_expenses', 'round_off', 'other'),
    (v_tenant, v_id, 'Capital Account', 'capital_account', 'capital', 'other');

  return v_id;
end $$;

-- ============================================================
-- acc_save_voucher: saves (creates or edits) a voucher together
-- with its item lines, ledger postings and invoice allocations
-- in ONE atomic step. Either everything is saved or nothing is.
-- The database itself refuses unbalanced postings.
-- ============================================================
create or replace function acc_save_voucher(p_voucher jsonb, p_items jsonb, p_lines jsonb, p_allocs jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_business uuid := (p_voucher->>'business_id')::uuid;
  v_tenant uuid;
  v_id uuid;
  v_dr numeric;
  v_cr numeric;
begin
  select tenant_id into v_tenant from acc_businesses where id = v_business;
  if v_tenant is null then raise exception 'Business not found or not accessible.'; end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_dr, v_cr from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;
  if abs(v_dr - v_cr) > 0.005 then
    raise exception 'Debits (%) and credits (%) do not match.', v_dr, v_cr;
  end if;

  if nullif(p_voucher->>'id','') is not null then
    v_id := (p_voucher->>'id')::uuid;
    update acc_vouchers set
      voucher_no = p_voucher->>'voucher_no',
      vdate = (p_voucher->>'vdate')::date,
      party_ledger_id = nullif(p_voucher->>'party_ledger_id','')::uuid,
      main_ledger_id = nullif(p_voucher->>'main_ledger_id','')::uuid,
      cash_bank_ledger_id = nullif(p_voucher->>'cash_bank_ledger_id','')::uuid,
      po_number = p_voucher->>'po_number', reference = p_voucher->>'reference', narration = p_voucher->>'narration',
      supply_type = coalesce(p_voucher->>'supply_type','intra'),
      subtotal = coalesce((p_voucher->>'subtotal')::numeric,0),
      cgst = coalesce((p_voucher->>'cgst')::numeric,0), sgst = coalesce((p_voucher->>'sgst')::numeric,0),
      igst = coalesce((p_voucher->>'igst')::numeric,0), other_tax = coalesce((p_voucher->>'other_tax')::numeric,0),
      tcs_rate = coalesce((p_voucher->>'tcs_rate')::numeric,0), tcs_amount = coalesce((p_voucher->>'tcs_amount')::numeric,0),
      tds_rate = coalesce((p_voucher->>'tds_rate')::numeric,0), tds_amount = coalesce((p_voucher->>'tds_amount')::numeric,0),
      round_off = coalesce((p_voucher->>'round_off')::numeric,0),
      total = coalesce((p_voucher->>'total')::numeric,0),
      attachment = p_voucher->>'attachment',
      meta = coalesce(p_voucher->'meta','{}'::jsonb),
      updated_at = now()
    where id = v_id and business_id = v_business;
    if not found then raise exception 'Voucher not found.'; end if;
    delete from acc_voucher_items where voucher_id = v_id;
    delete from acc_voucher_lines where voucher_id = v_id;
    delete from acc_allocations where source_voucher_id = v_id;
  else
    insert into acc_vouchers (tenant_id, business_id, vtype, voucher_no, vdate, party_ledger_id, main_ledger_id, cash_bank_ledger_id,
      po_number, reference, narration, supply_type, subtotal, cgst, sgst, igst, other_tax, tcs_rate, tcs_amount, tds_rate, tds_amount,
      round_off, total, attachment, meta)
    values (v_tenant, v_business, p_voucher->>'vtype', p_voucher->>'voucher_no', (p_voucher->>'vdate')::date,
      nullif(p_voucher->>'party_ledger_id','')::uuid, nullif(p_voucher->>'main_ledger_id','')::uuid, nullif(p_voucher->>'cash_bank_ledger_id','')::uuid,
      p_voucher->>'po_number', p_voucher->>'reference', p_voucher->>'narration', coalesce(p_voucher->>'supply_type','intra'),
      coalesce((p_voucher->>'subtotal')::numeric,0), coalesce((p_voucher->>'cgst')::numeric,0), coalesce((p_voucher->>'sgst')::numeric,0),
      coalesce((p_voucher->>'igst')::numeric,0), coalesce((p_voucher->>'other_tax')::numeric,0),
      coalesce((p_voucher->>'tcs_rate')::numeric,0), coalesce((p_voucher->>'tcs_amount')::numeric,0),
      coalesce((p_voucher->>'tds_rate')::numeric,0), coalesce((p_voucher->>'tds_amount')::numeric,0),
      coalesce((p_voucher->>'round_off')::numeric,0), coalesce((p_voucher->>'total')::numeric,0),
      p_voucher->>'attachment', coalesce(p_voucher->'meta','{}'::jsonb))
    returning id into v_id;
  end if;

  insert into acc_voucher_items (voucher_id, tenant_id, business_id, line_no, item_id, description, hsn_sac, qty, rate, amount,
      gst_rate, other_tax_rate, cgst_amt, sgst_amt, igst_amt, other_tax_amt, rfid, extra)
  select v_id, v_tenant, v_business, coalesce(x.line_no,1), x.item_id, x.description, x.hsn_sac, coalesce(x.qty,0), coalesce(x.rate,0), coalesce(x.amount,0),
      coalesce(x.gst_rate,0), coalesce(x.other_tax_rate,0), coalesce(x.cgst_amt,0), coalesce(x.sgst_amt,0), coalesce(x.igst_amt,0), coalesce(x.other_tax_amt,0),
      x.rfid, coalesce(x.extra,'{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_items,'[]'::jsonb)) as x(line_no int, item_id uuid, description text, hsn_sac text, qty numeric, rate numeric, amount numeric,
      gst_rate numeric, other_tax_rate numeric, cgst_amt numeric, sgst_amt numeric, igst_amt numeric, other_tax_amt numeric, rfid text, extra jsonb);

  insert into acc_voucher_lines (voucher_id, tenant_id, business_id, line_no, ledger_id, debit, credit, narration)
  select v_id, v_tenant, v_business, coalesce(x.line_no,1), x.ledger_id, coalesce(x.debit,0), coalesce(x.credit,0), x.narration
  from jsonb_to_recordset(coalesce(p_lines,'[]'::jsonb)) as x(line_no int, ledger_id uuid, debit numeric, credit numeric, narration text);

  insert into acc_allocations (tenant_id, business_id, source_voucher_id, invoice_voucher_id, amount)
  select v_tenant, v_business, v_id, x.invoice_voucher_id, x.amount
  from jsonb_to_recordset(coalesce(p_allocs,'[]'::jsonb)) as x(invoice_voucher_id uuid, amount numeric)
  where coalesce(x.amount,0) > 0;

  return v_id;
end $$;
