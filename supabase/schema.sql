-- Esquema inicial para Casa Oaxtepec. Revísalo en un proyecto de pruebas
-- antes de aplicarlo a producción. No contiene claves ni datos de huéspedes.
begin;

create or replace function public.is_site_admin()
returns boolean language sql stable
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;

create table if not exists public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  alt_text text not null,
  category text not null default 'Casa' check (category in ('Casa','Habitaciones','Exteriores','Alberca','Amenidades')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(guest_name) between 2 and 120),
  guest_email text not null check (char_length(guest_email) <= 254),
  guest_phone text check (guest_phone is null or char_length(guest_phone) <= 30),
  check_in date not null,
  check_out date not null,
  guests smallint not null check (guests between 1 and 30),
  guest_message text check (guest_message is null or char_length(guest_message) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','declined','payment_pending','paid','cancelled')),
  quoted_total integer check (quoted_total is null or quoted_total >= 0),
  currency char(3) not null default 'MXN',
  coupon_code text,
  payment_provider text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_dates_valid check (check_out > check_in)
);

create index if not exists reservations_dates_status_idx on public.reservations(status, check_in, check_out);
create index if not exists reservations_created_at_idx on public.reservations(created_at desc);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  discount_percent numeric(5,2) check (discount_percent between 0 and 100),
  discount_amount integer check (discount_amount is null or discount_amount >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint promotion_dates_valid check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  discount_percent numeric(5,2) check (discount_percent between 0 and 100),
  discount_amount integer check (discount_amount is null or discount_amount >= 0),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint coupon_discount_present check (discount_percent is not null or discount_amount is not null)
);

alter table public.gallery_photos enable row level security;
alter table public.reservations enable row level security;
alter table public.promotions enable row level security;
alter table public.coupons enable row level security;

drop policy if exists "Public can view active gallery photos" on public.gallery_photos;
create policy "Public can view active gallery photos" on public.gallery_photos
  for select to anon, authenticated using (is_active or public.is_site_admin());
drop policy if exists "Admins manage gallery photos" on public.gallery_photos;
create policy "Admins manage gallery photos" on public.gallery_photos
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- Sin INSERT público: las solicitudes deben pasar por una Edge Function con
-- validación, rate limit y service_role en secretos del servidor.
drop policy if exists "Guests can submit reservation requests" on public.reservations;
drop policy if exists "Admins manage reservations" on public.reservations;
create policy "Admins manage reservations" on public.reservations
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "Public can view active promotions" on public.promotions;
create policy "Public can view active promotions" on public.promotions
  for select to anon, authenticated using ((is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or public.is_site_admin());
drop policy if exists "Admins manage promotions" on public.promotions;
create policy "Admins manage promotions" on public.promotions
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "Public can validate active coupons" on public.coupons;
-- No se permite enumerar códigos desde el navegador. La validación debe hacerse
-- por una función que acepte un código y una cotización, sin devolver la tabla.
drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- Las fotos usan el bucket público 'gallery'. Solo administradores autenticados
-- con app_metadata.role='admin' pueden escribir; nunca publiques service_role.
insert into storage.buckets(id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do update set public = excluded.public;

-- Public buckets serve individual object URLs without listing storage.objects.
-- Keep gallery metadata public in gallery_photos; do not grant broad object listing.
drop policy if exists "Public reads gallery images" on storage.objects;
drop policy if exists "Admins upload gallery images" on storage.objects;
create policy "Admins upload gallery images" on storage.objects
  for insert to authenticated with check (bucket_id = 'gallery' and public.is_site_admin());
drop policy if exists "Admins update gallery images" on storage.objects;
create policy "Admins update gallery images" on storage.objects
  for update to authenticated using (bucket_id = 'gallery' and public.is_site_admin()) with check (bucket_id = 'gallery' and public.is_site_admin());
drop policy if exists "Admins delete gallery images" on storage.objects;
create policy "Admins delete gallery images" on storage.objects
  for delete to authenticated using (bucket_id = 'gallery' and public.is_site_admin());

commit;
