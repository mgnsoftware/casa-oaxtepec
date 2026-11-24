alter table public.reservations
  add column if not exists voucher_storage_path text;
