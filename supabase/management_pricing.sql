-- Tarifas, usuarios administrativos y datos ampliados de reservación.
-- Aplicar desde Supabase SQL Editor. No contiene claves ni contraseñas.
begin;

-- La autorización se basa en email verificado en Auth o en el app_metadata
-- existente. Supabase Auth conserva las contraseñas con hash; este proyecto
-- nunca guarda contraseñas directamente.
create table if not exists public.authorized_admins (
  email text primary key check (email = lower(email)),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.authorized_admins enable row level security;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
create or replace function private.is_authorized_admin(p_email text)
returns boolean language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.authorized_admins a
    where a.is_active and a.email = lower(coalesce(p_email,''))
  );
$$;
revoke all on function private.is_authorized_admin(text) from public;
grant execute on function private.is_authorized_admin(text) to anon, authenticated;

create or replace function public.is_site_admin()
returns boolean language sql stable
set search_path = ''
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or private.is_authorized_admin(auth.jwt() ->> 'email');
$$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

drop policy if exists "Admins manage authorized admins" on public.authorized_admins;
create policy "Admins manage authorized admins" on public.authorized_admins
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());
grant select, insert, update, delete on public.authorized_admins to authenticated;

-- La cuenta administradora inicial se puede usar cuando ya exista en Auth.
insert into public.authorized_admins(email)
values ('contacto.mgnsoft@gmail.com')
on conflict (email) do nothing;

create table if not exists public.nightly_rate_rules (
  iso_weekday smallint primary key check (iso_weekday between 1 and 7),
  day_label text not null,
  nightly_price integer not null check (nightly_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.nightly_rate_rules enable row level security;
drop policy if exists "Admins manage nightly rates" on public.nightly_rate_rules;
create policy "Admins manage nightly rates" on public.nightly_rate_rules
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());
grant select, insert, update, delete on public.nightly_rate_rules to authenticated;

insert into public.nightly_rate_rules(iso_weekday, day_label, nightly_price, discount_percent)
values
  (1,'Lunes',800,25),(2,'Martes',800,25),(3,'Miércoles',800,25),(4,'Jueves',800,25),
  (5,'Viernes',1000,15),(6,'Sábado',1000,15),(7,'Domingo',1000,15)
on conflict (iso_weekday) do nothing;

create table if not exists public.reservation_price_exceptions (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 120),
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists reservation_price_exceptions_dates_idx
  on public.reservation_price_exceptions(starts_on, ends_on) where is_active;
alter table public.reservation_price_exceptions enable row level security;
drop policy if exists "Admins manage price exceptions" on public.reservation_price_exceptions;
create policy "Admins manage price exceptions" on public.reservation_price_exceptions
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());
grant select, insert, update, delete on public.reservation_price_exceptions to authenticated;

create table if not exists public.reservation_settings (
  id smallint primary key default 1 check (id = 1),
  bank_name text not null default '',
  account_holder text not null default '',
  clabe text not null default '',
  account_number text not null default '',
  deposit_instructions text not null default '',
  owner_email text not null default 'contacto.mgnsoft@gmail.com',
  owner_whatsapp text not null default '525562959980',
  property_address text not null default 'Framboyán 28, manzana 9, lote 14, Fraccionamiento Altos de Oaxtepec, Morelos',
  updated_at timestamptz not null default now()
);
alter table public.reservation_settings enable row level security;
drop policy if exists "Admins manage reservation settings" on public.reservation_settings;
create policy "Admins manage reservation settings" on public.reservation_settings
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());
grant select, insert, update, delete on public.reservation_settings to authenticated;
insert into public.reservation_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.reservation_notification_log (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  event_key text not null,
  channel text not null check (channel in ('email','whatsapp')),
  recipient text not null,
  sent_at timestamptz not null default now(),
  provider_message_id text,
  unique (reservation_id,event_key,channel,recipient)
);
alter table public.reservation_notification_log enable row level security;
drop policy if exists "Admins read notification log" on public.reservation_notification_log;
create policy "Admins read notification log" on public.reservation_notification_log
  for select to authenticated using (public.is_site_admin());
grant select on public.reservation_notification_log to authenticated;

-- Las autorizaciones de acceso contienen nombre, correo y placas. Se conservan
-- en un bucket privado, no en el bucket público de la galería.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('reservation-documents','reservation-documents',false,5242880,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

alter table public.reservations
  add column if not exists event_type text,
  add column if not exists check_in_time time not null default '09:00',
  add column if not exists check_out_time time not null default '18:00',
  add column if not exists vehicle_count smallint not null default 0,
  add column if not exists vehicle_details jsonb not null default '[]'::jsonb,
  add column if not exists quoted_base_total integer,
  add column if not exists discount_total integer,
  add column if not exists pricing_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists authorized_at timestamptz,
  add column if not exists confirmed_at timestamptz;

alter table public.reservations drop constraint if exists reservations_payment_status_check;
alter table public.reservations add constraint reservations_payment_status_check
  check (payment_status in ('pending','deposit_requested','deposit_received','refunded'));
alter table public.reservations drop constraint if exists reservations_vehicle_details_check;
alter table public.reservations add constraint reservations_vehicle_details_check
  check (jsonb_typeof(vehicle_details) = 'array' and jsonb_array_length(vehicle_details) <= 12);

-- La función de trigger no es una RPC. El trigger puede ejecutarla sin que
-- visitantes puedan invocarla directamente desde PostgREST.
revoke all on function public.enforce_confirmed_reservation_dates() from public, anon, authenticated;

-- Las fechas se guardan inclusivamente en la tabla de excepciones: viernes a
-- lunes cubre las noches de esos cuatro días y no descuenta ninguna de ellas.
do $$
declare y integer; holiday date; bridge_monday date; nov_monday date;
begin
  for y in 2026..2040 loop
    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Día de la Constitución · ' || y, make_date(y,2,5), make_date(y,2,5)
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Día de la Constitución · ' || y and e.starts_on = make_date(y,2,5));

    -- Primer lunes de febrero, natalicio de Benito Juárez (tercer lunes de marzo)
    -- y Revolución Mexicana (tercer lunes de noviembre), con su puente extendido.
    bridge_monday := make_date(y,2,1) + ((8 - extract(isodow from make_date(y,2,1))::integer) % 7);
    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Puente de Constitución · ' || y, bridge_monday - 3, bridge_monday
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Puente de Constitución · ' || y and e.starts_on = bridge_monday - 3);

    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Natalicio de Benito Juárez · ' || y, make_date(y,3,21), make_date(y,3,21)
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Natalicio de Benito Juárez · ' || y and e.starts_on = make_date(y,3,21));
    bridge_monday := make_date(y,3,1) + ((8 - extract(isodow from make_date(y,3,1))::integer) % 7) + 14;
    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Puente de Benito Juárez · ' || y, bridge_monday - 3, bridge_monday
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Puente de Benito Juárez · ' || y and e.starts_on = bridge_monday - 3);

    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Día del Trabajo · ' || y, make_date(y,5,1), make_date(y,5,1)
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Día del Trabajo · ' || y and e.starts_on = make_date(y,5,1));
    foreach holiday in array array[make_date(y,9,15),make_date(y,9,16),make_date(y,12,24),make_date(y,12,25),make_date(y,12,31),make_date(y+1,1,1)] loop
      insert into public.reservation_price_exceptions(label, starts_on, ends_on)
      select case holiday
        when make_date(y,9,15) then 'Víspera de Independencia · ' || y
        when make_date(y,9,16) then 'Independencia de México · ' || y
        when make_date(y,12,24) then 'Nochebuena · ' || y
        when make_date(y,12,25) then 'Navidad · ' || y
        when make_date(y,12,31) then 'Fin de año · ' || y
        else 'Año nuevo · ' || (y+1) end,
        holiday, holiday
      where not exists (select 1 from public.reservation_price_exceptions e where e.starts_on=holiday and e.ends_on=holiday);
    end loop;

    nov_monday := make_date(y,11,1) + ((8 - extract(isodow from make_date(y,11,1))::integer) % 7) + 14;
    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Puente de la Revolución · ' || y, nov_monday - 3, nov_monday
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Puente de la Revolución · ' || y and e.starts_on = nov_monday - 3);
  end loop;
  foreach y in array array[2030,2036,2042] loop
    insert into public.reservation_price_exceptions(label, starts_on, ends_on)
    select 'Transmisión del Poder Ejecutivo · ' || y, make_date(y,10,1), make_date(y,10,1)
    where not exists (select 1 from public.reservation_price_exceptions e
      where e.label = 'Transmisión del Poder Ejecutivo · ' || y and e.starts_on = make_date(y,10,1));
  end loop;
end;
$$;

create or replace function public.quote_reservation(p_check_in date, p_check_out date)
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare result jsonb; base_sum integer; discount_sum integer; total_sum integer; night_count integer;
begin
  if p_check_in is null or p_check_out is null or p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'Choose valid future dates.' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(x.base_price),0)::integer,
         coalesce(sum(x.discount_amount),0)::integer,
         coalesce(sum(x.base_price - x.discount_amount),0)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'date',x.night_date,'weekday',x.day_label,'base',x.base_price,
           'discountPercent',x.discount_percent,'discount',x.discount_amount,
           'total',x.base_price-x.discount_amount,'exception',x.exception_label
         ) order by x.night_date),'[]'::jsonb)
    into night_count, base_sum, discount_sum, total_sum, result
  from (
    select d::date night_date, r.day_label, r.nightly_price base_price,
      case when e.label is not null then 0 else r.discount_percent end discount_percent,
      case when e.label is not null then 0 else round(r.nightly_price*r.discount_percent/100)::integer end discount_amount,
      e.label exception_label
    from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
    join public.nightly_rate_rules r on r.iso_weekday=extract(isodow from d)::integer and r.is_active
    left join lateral (
      select ex.label from public.reservation_price_exceptions ex
      where ex.is_active and d::date between ex.starts_on and ex.ends_on
      order by ex.starts_on desc limit 1
    ) e on true
  ) x;
  if night_count <> p_check_out - p_check_in then
    raise exception 'Nightly prices are not configured for all selected dates.' using errcode = '22023';
  end if;
  return jsonb_build_object('check_in',p_check_in,'check_out',p_check_out,'nights',night_count,
    'base_total',base_sum,'discount_total',discount_sum,'total',total_sum,'currency','MXN','breakdown',result);
end;
$$;
revoke all on function public.quote_reservation(date,date) from public;
grant execute on function public.quote_reservation(date,date) to anon, authenticated;

create or replace function public.submit_reservation_request_v2(
  p_guest_name text, p_guest_email text, p_guest_phone text,
  p_check_in date, p_check_out date, p_guests smallint,
  p_guest_message text, p_website text, p_event_type text,
  p_check_in_time time, p_check_out_time time,
  p_vehicle_count smallint, p_vehicle_details jsonb
)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare new_id uuid; quote jsonb; v_count integer;
begin
  if coalesce(p_website,'') <> '' then raise exception 'Invalid request.' using errcode='22023'; end if;
  if p_guest_name is null or char_length(btrim(p_guest_name)) not between 2 and 120 then raise exception 'Enter a valid name.' using errcode='22023'; end if;
  if p_guest_email is null or char_length(btrim(p_guest_email)) > 254 or position('@' in p_guest_email) < 2 then raise exception 'Enter a valid email.' using errcode='22023'; end if;
  if p_guest_phone is not null and char_length(btrim(p_guest_phone)) > 30 then raise exception 'Phone is too long.' using errcode='22023'; end if;
  if p_guests is null or p_guests not between 1 and 12 then raise exception 'Guest count must be from 1 to 12.' using errcode='22023'; end if;
  if p_guest_message is not null and char_length(p_guest_message) > 1000 then raise exception 'Message is too long.' using errcode='22023'; end if;
  if p_event_type is not null and char_length(p_event_type) > 100 then raise exception 'Event type is too long.' using errcode='22023'; end if;
  if p_vehicle_count is null or p_vehicle_count not between 0 and 12 or jsonb_typeof(coalesce(p_vehicle_details,'[]'::jsonb)) <> 'array' then raise exception 'Vehicle details are invalid.' using errcode='22023'; end if;
  v_count := jsonb_array_length(coalesce(p_vehicle_details,'[]'::jsonb));
  if v_count <> p_vehicle_count then raise exception 'Enter details for every vehicle.' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_vehicle_details,'[]'::jsonb)) v
      where length(btrim(coalesce(v->>'driver',''))) not between 2 and 120
         or length(btrim(coalesce(v->>'plate',''))) not between 2 and 20
         or length(btrim(coalesce(v->>'color',''))) not between 2 and 60
         or coalesce((v->>'occupants')::integer,0) not between 1 and p_guests) then
    raise exception 'Complete driver, plate, color and occupant count for every vehicle.' using errcode='22023';
  end if;
  if coalesce((select sum((v->>'occupants')::integer) from jsonb_array_elements(coalesce(p_vehicle_details,'[]'::jsonb)) v),0) > p_guests then
    raise exception 'Vehicle occupants cannot exceed the total number of guests.' using errcode='22023';
  end if;
  if exists (select 1 from public.reservations r where r.status='confirmed' and r.check_in<p_check_out and r.check_out>p_check_in) then
    raise exception 'These dates are unavailable.' using errcode='23P01';
  end if;
  quote := public.quote_reservation(p_check_in,p_check_out);
  insert into public.reservations(guest_name,guest_email,guest_phone,check_in,check_out,guests,guest_message,status,
    quoted_total,quoted_base_total,discount_total,pricing_breakdown,event_type,check_in_time,check_out_time,vehicle_count,vehicle_details)
  values (btrim(p_guest_name),lower(btrim(p_guest_email)),nullif(btrim(coalesce(p_guest_phone,'')),''),p_check_in,p_check_out,p_guests,
    nullif(btrim(coalesce(p_guest_message,'')),''),'pending',(quote->>'total')::integer,(quote->>'base_total')::integer,
    (quote->>'discount_total')::integer,quote->'breakdown',nullif(btrim(coalesce(p_event_type,'')),''),
    coalesce(p_check_in_time,'09:00'),coalesce(p_check_out_time,'18:00'),p_vehicle_count,coalesce(p_vehicle_details,'[]'::jsonb)) returning id into new_id;
  return jsonb_build_object('id',new_id,'quote',quote,'status','pending');
end;
$$;
revoke all on function public.submit_reservation_request_v2(text,text,text,date,date,smallint,text,text,text,time,time,smallint,jsonb) from public;
grant execute on function public.submit_reservation_request_v2(text,text,text,date,date,smallint,text,text,text,time,time,smallint,jsonb) to anon,authenticated;

-- Compatibilidad temporal con pestañas antiguas del sitio: las solicitudes se
-- enrutan al nuevo cálculo y quedan cotizadas aun cuando falten vehículos.
create or replace function public.submit_reservation_request(
  p_guest_name text, p_guest_email text, p_guest_phone text,
  p_check_in date, p_check_out date, p_guests smallint,
  p_guest_message text, p_website text default null
)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare result jsonb;
begin
  result := public.submit_reservation_request_v2(p_guest_name,p_guest_email,p_guest_phone,
    p_check_in,p_check_out,p_guests,p_guest_message,p_website,null,'09:00','18:00',0,'[]'::jsonb);
  return (result->>'id')::uuid;
end;
$$;
revoke all on function public.submit_reservation_request(text,text,text,date,date,smallint,text,text) from public;
grant execute on function public.submit_reservation_request(text,text,text,date,date,smallint,text,text) to anon,authenticated;

commit;
