-- ============================================================
-- OONE — Migration 006 (SAFE — no data is deleted by this)
--
-- Fixes: "Could not remove: update or delete on table
-- bank_accounts violates foreign key constraint ..."
--
-- Before: deleting a bank account was blocked forever if any
-- loan or receipt had ever used it.
-- After: deleting a bank account is allowed, and any old loans
-- or receipts that pointed to it simply keep their date, amount,
-- customer, and "Bank" mode — they just lose the specific
-- bank-account tag, since that bank account no longer exists.
-- No transaction, customer, or number is deleted by this.
-- ============================================================

alter table items drop constraint if exists items_bank_account_id_fkey;
alter table items add constraint items_bank_account_id_fkey
  foreign key (bank_account_id) references bank_accounts(id) on delete set null;

alter table receipts drop constraint if exists receipts_bank_account_id_fkey;
alter table receipts add constraint receipts_bank_account_id_fkey
  foreign key (bank_account_id) references bank_accounts(id) on delete set null;

alter table item_topups drop constraint if exists item_topups_bank_account_id_fkey;
alter table item_topups add constraint item_topups_bank_account_id_fkey
  foreign key (bank_account_id) references bank_accounts(id) on delete set null;
