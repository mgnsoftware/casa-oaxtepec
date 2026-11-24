-- Reservation workflow for Casa Oaxtepec.
-- Apply in the Supabase SQL Editor. This migration only touches public.reservations.
begin;

alter table public.reservations
  drop constraint if exists reservations_status_check;
alter table public.reservations
  add constraint reservations_status_check
  check (status in ('pending', 'approved', 'payment_pending', 'paid', 'declined', 'cancelled', 'awaiting_deposit', 'confirmed'));

-- Only confirmed stays block nights. Use a transaction-scoped lock so two owners
-- cannot confirm overlapping dates at the same time.
create or replace function public.enforce_confirmed_reservation_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'confirmed' then
    perform pg_advisory_xact_lock(hashtext('casa_oaxtepec_confirmed_dates'));
    if exists (
      select 1 from public.reservations r
      where r.status = 'confirmed'
        and r.id <> new.id
        and r.check_in < new.check_out
        and r.check_out > new.check_in
    ) then
      raise exception 'These dates overlap another confirmed stay.'
        using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_confirmed_reservation_dates on public.reservations;
create trigger enforce_confirmed_reservation_dates
before insert or update of status, check_in, check_out on public.reservations
for each row execute function public.enforce_confirmed_reservation_dates();

-- Public calendar endpoint returns dates only, never guest information.
create or replace function public.get_unavailable_dates(p_from date, p_to date)
returns table (check_in date, check_out date)
language sql
stable
security definer
set search_path = public
as $$
  select r.check_in, r.check_out
  from public.reservations r
  where r.status = 'confirmed'
    and p_from < p_to
    and r.check_in < p_to
    and r.check_out > p_from
  order by r.check_in;
$$;

revoke all on function public.get_unavailable_dates(date, date) from public;
grant execute on function public.get_unavailable_dates(date, date) to anon, authenticated;

-- Public submission is constrained and inserts only a pending request.
-- Honeypot p_website must remain blank. The browser cannot set status or price.
create or replace function public.submit_reservation_request(
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_check_in date,
  p_check_out date,
  p_guests smallint,
  p_guest_message text,
  p_website text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_reservation_id uuid;
begin
  if coalesce(p_website, '') <> '' then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  if p_guest_name is null or char_length(btrim(p_guest_name)) not between 2 and 120 then
    raise exception 'Enter a valid name.' using errcode = '22023';
  end if;
  if p_guest_email is null or char_length(btrim(p_guest_email)) > 254 or position('@' in p_guest_email) < 2 then
    raise exception 'Enter a valid email.' using errcode = '22023';
  end if;
  if p_guest_phone is not null and char_length(btrim(p_guest_phone)) > 30 then
    raise exception 'Phone is too long.' using errcode = '22023';
  end if;
  if p_check_in is null or p_check_out is null or p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'Choose valid future dates.' using errcode = '22023';
  end if;
  if p_guests is null or p_guests not between 1 and 12 then
    raise exception 'Guest count must be from 1 to 12.' using errcode = '22023';
  end if;
  if p_guest_message is not null and char_length(p_guest_message) > 1000 then
    raise exception 'Message is too long.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.reservations r
    where r.status = 'confirmed'
      and r.check_in < p_check_out
      and r.check_out > p_check_in
  ) then
    raise exception 'These dates are unavailable.' using errcode = '23P01';
  end if;

  insert into public.reservations (
    guest_name, guest_email, guest_phone, check_in, check_out, guests, guest_message, status
  ) values (
    btrim(p_guest_name), lower(btrim(p_guest_email)), nullif(btrim(coalesce(p_guest_phone, '')), ''),
    p_check_in, p_check_out, p_guests, nullif(btrim(coalesce(p_guest_message, '')), ''), 'pending'
  ) returning id into new_reservation_id;

  return new_reservation_id;
end;
$$;

revoke all on function public.submit_reservation_request(text, text, text, date, date, smallint, text, text) from public;
grant execute on function public.submit_reservation_request(text, text, text, date, date, smallint, text, text) to anon, authenticated;

commit;
