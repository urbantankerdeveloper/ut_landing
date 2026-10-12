-- Production hardening: timestamps, indexes, audit records, and private uploads.
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

alter table public.vehicles add column if not exists verification text not null default 'pending';

do $$ declare table_name text; begin foreach table_name in array array['bookings','payments','vendors','drivers','subscriptions','complaints','enquiries'] loop if to_regclass(format('public.%I', table_name)) is not null then execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', table_name); end if; end loop; end $$;

do $$ declare table_name text; begin foreach table_name in array array['bookings','payments','vendors','drivers','subscriptions','complaints','enquiries'] loop if to_regclass(format('public.%I', table_name)) is not null then execute format('drop trigger if exists %I_updated_at on public.%I', table_name, table_name); execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name); end if; end loop; end $$;

create index if not exists bookings_vendor_status_idx on public.bookings(vendor_id, status, created_at desc);
create index if not exists payments_status_created_idx on public.payments(status, created_at desc);
create index if not exists drivers_vendor_status_idx on public.drivers(vendor_id, verification, is_active);
create index if not exists vehicles_vendor_status_idx on public.vehicles(vendor_id, verification, is_active);
create index if not exists notifications_recipient_read_idx on public.notifications(recipient_id, read_at, created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists coupons_active_until_idx on public.coupons(is_active, valid_until);

insert into storage.buckets (id, name, public) values ('urban-tanker-documents', 'urban-tanker-documents', false) on conflict (id) do nothing;
drop policy if exists "authenticated users upload documents" on storage.objects;
create policy "authenticated users upload documents" on storage.objects for insert to authenticated with check (bucket_id = 'urban-tanker-documents');
drop policy if exists "authenticated users read their documents" on storage.objects;
create policy "authenticated users read their documents" on storage.objects for select to authenticated using (bucket_id = 'urban-tanker-documents' and owner_id = auth.uid()::text);

create or replace function public.audit_booking_status() returns trigger language plpgsql security definer as $$ begin if old.status is distinct from new.status then insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'booking.status_changed', 'booking', new.id, jsonb_build_object('from', old.status, 'to', new.status)); end if; return new; end $$;
drop trigger if exists bookings_audit_status on public.bookings;
create trigger bookings_audit_status after update of status on public.bookings for each row execute function public.audit_booking_status();
