-- Supabase privilege hardening for the reservation workflow.
-- The date-check routine is called only by its table trigger, never through RPC.
revoke all on function public.enforce_confirmed_reservation_dates() from public, anon, authenticated;

-- Access authorizations contain guest names and license plates; keep the PDF
-- files outside the public gallery bucket. Edge Functions use the server key.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('reservation-documents','reservation-documents',false,5242880,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
