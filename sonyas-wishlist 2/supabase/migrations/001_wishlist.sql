-- Run once in Supabase SQL Editor. No passwords or tokens belong here.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.admins(user_id uuid primary key references auth.users(id) on delete cascade);
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from private.admins where user_id=(select auth.uid())); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon,authenticated,service_role;
create table public.gifts(
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 1 and 120),
 description text not null default '' check(char_length(description)<=1000),
 image_url text not null default '' check(image_url='' or (image_url ~ '^https?://' and char_length(image_url)<=2048)),
 shop_url text not null default '' check(shop_url='' or (shop_url ~ '^https?://' and char_length(shop_url)<=2048)),
 price numeric(12,2) check(price>=0 and price<=100000000),
 category text not null default 'other' check(category in ('beauty','fashion','home','books','little things','other')),
 priority text not null default 'would love' check(priority in ('really want','would love','just an idea')),
 reserved boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.suggestions(
 id uuid primary key default gen_random_uuid(),title text not null check(char_length(btrim(title)) between 1 and 120),
 description text not null default '' check(char_length(description)<=1000),
 image_url text not null default '' check(image_url='' or (image_url ~ '^https?://' and char_length(image_url)<=2048)),
 shop_url text not null default '' check(shop_url='' or (shop_url ~ '^https?://' and char_length(shop_url)<=2048)),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table private.reservations(gift_id uuid primary key references public.gifts(id) on delete cascade,token_hash text not null check(length(token_hash)=64));
create table private.rate_limits(key text primary key,window_start timestamptz not null,hits integer not null);
alter table public.gifts enable row level security;
alter table public.suggestions enable row level security;
alter table private.admins enable row level security;
alter table private.reservations enable row level security;
alter table private.rate_limits enable row level security;
revoke all on public.gifts,public.suggestions from anon,authenticated;
grant select on public.gifts to anon,authenticated;
-- Column privileges intentionally exclude reserved/id/created_at.
grant insert(title,description,image_url,shop_url,price,category,priority),update(title,description,image_url,shop_url,price,category,priority),delete on public.gifts to authenticated;
grant select on public.suggestions to authenticated;
create policy gifts_read on public.gifts for select to anon,authenticated using(true);
create policy gifts_insert on public.gifts for insert to authenticated with check(public.is_admin());
create policy gifts_update on public.gifts for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy gifts_delete on public.gifts for delete to authenticated using(public.is_admin());
create policy suggestions_read on public.suggestions for select to authenticated using(public.is_admin());
grant all on public.gifts,public.suggestions to service_role;
-- Even when called through the API these operations require service_role.
create function public.reserve_gift(p_gift uuid,p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.gifts set reserved=true where id=p_gift and not reserved;
 if not found then raise exception 'Подарок уже забронирован или удалён'; end if;
 insert into private.reservations(gift_id,token_hash) values(p_gift,p_hash);
end; $$;
create function public.cancel_gift(p_gift uuid,p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Lock gifts first: same lock order as reserve, preventing deadlocks.
 perform 1 from public.gifts where id=p_gift for update;
 delete from private.reservations where gift_id=p_gift and token_hash=p_hash;
 if not found then raise exception 'Ссылка недействительна или бронь уже отменена'; end if;
 update public.gifts set reserved=false where id=p_gift;
end; $$;
create function public.check_rate(p_key text,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.rate_limits as r values(p_key,now(),1)
 on conflict(key) do update set hits=case when r.window_start<now()-interval '1 hour' then 1 else r.hits+1 end,window_start=case when r.window_start<now()-interval '1 hour' then now() else r.window_start end returning hits into n;
 delete from private.rate_limits where window_start<now()-interval '48 hours';
 return n<=p_limit;
end; $$;
create function public.moderate_suggestion(p_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.suggestions;
begin
 select * into s from public.suggestions where id=p_id and status='pending' for update;
 if not found then raise exception 'Предложение уже обработано'; end if;
 if p_approve then insert into public.gifts(title,description,image_url,shop_url) values(s.title,s.description,s.image_url,s.shop_url);end if;
 update public.suggestions set status=case when p_approve then 'approved' else 'rejected' end where id=p_id;
end; $$;
revoke all on function public.reserve_gift(uuid,text),public.cancel_gift(uuid,text),public.check_rate(text,integer),public.moderate_suggestion(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_gift(uuid,text),public.cancel_gift(uuid,text),public.check_rate(text,integer),public.moderate_suggestion(uuid,boolean) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('gift-images','gift-images',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy image_admin_insert on storage.objects for insert to authenticated with check(bucket_id='gift-images' and public.is_admin());
create policy image_admin_delete on storage.objects for delete to authenticated using(bucket_id='gift-images' and public.is_admin());
-- Public bucket intentionally allows viewing gift photos; never upload private photos.
alter publication supabase_realtime add table public.gifts;
