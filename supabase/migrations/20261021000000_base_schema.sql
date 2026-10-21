create type public.app_role as enum ('admin','customer','artisan');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

create table public.artisans (
  user_id uuid primary key,
  category text not null default 'General labour',
  bio text not null default '',
  is_online boolean not null default false,
  verified boolean not null default false,
  id_doc_path text,
  cert_path text,
  portfolio text[] not null default '{}',
  rating numeric(3,2) not null default 5,
  rating_count int not null default 0,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.artisans to authenticated;
grant all on public.artisans to service_role;
alter table public.artisans enable row level security;
create policy "artisans readable" on public.artisans for select to authenticated using (true);
create policy "own artisan insert" on public.artisans for insert to authenticated with check (auth.uid() = user_id and verified = false);
create policy "own artisan update" on public.artisans for update to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

create or replace function public.protect_artisan_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') and auth.role() <> 'service_role' then
    new.verified := old.verified;
    new.rating := old.rating;
    new.rating_count := old.rating_count;
  end if;
  return new;
end $$;
create trigger artisans_protect before update on public.artisans for each row execute function public.protect_artisan_fields();

create table public.settings (
  id int primary key default 1 check (id = 1),
  commission_pct int not null default 15
);
insert into public.settings (id) values (1);
grant select, update on public.settings to authenticated;
grant all on public.settings to service_role;
alter table public.settings enable row level security;
create policy "settings readable" on public.settings for select to authenticated using (true);
create policy "admin settings" on public.settings for update to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid(),
  artisan_id uuid,
  category text not null,
  description text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  urgency text not null default 'instant' check (urgency in ('instant','scheduled')),
  scheduled_at timestamptz,
  status text not null default 'pending' check (status in ('pending','accepted','en_route','in_progress','completed','cancelled')),
  price_estimate int not null default 0,
  photos text[] not null default '{}',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  payment_method text,
  rating int check (rating between 1 and 5),
  review text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.jobs to authenticated;
grant all on public.jobs to service_role;
alter table public.jobs enable row level security;
create policy "jobs visible" on public.jobs for select to authenticated using (
  customer_id = auth.uid() or artisan_id = auth.uid() or public.has_role(auth.uid(),'admin')
  or (status = 'pending' and artisan_id is null and public.has_role(auth.uid(),'artisan'))
);
create policy "customer creates" on public.jobs for insert to authenticated with check (customer_id = auth.uid());
create policy "participants update" on public.jobs for update to authenticated using (
  customer_id = auth.uid() or artisan_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.respond_job(_job uuid, _accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  if not public.has_role(auth.uid(),'artisan') then raise exception 'Not an artisan'; end if;
  select * into j from public.jobs where id = _job for update;
  if j.status <> 'pending' then raise exception 'Job no longer available'; end if;
  if j.artisan_id is not null and j.artisan_id <> auth.uid() then raise exception 'Job offered to someone else'; end if;
  if _accept then
    update public.jobs set artisan_id = auth.uid(), status = 'accepted' where id = _job;
  else
    update public.jobs set artisan_id = null where id = _job and artisan_id = auth.uid();
  end if;
end $$;

create or replace function public.rate_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rating is not null and old.rating is null and new.artisan_id is not null then
    update public.artisans set
      rating = round(((rating * rating_count) + new.rating)::numeric / (rating_count + 1), 2),
      rating_count = rating_count + 1
    where user_id = new.artisan_id;
  end if;
  return new;
end $$;
create trigger jobs_rate after update on public.jobs for each row execute function public.rate_job();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sender_id uuid not null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now()
);
grant select, insert on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "job chat read" on public.messages for select to authenticated using (
  exists (select 1 from public.jobs j where j.id = job_id and (j.customer_id = auth.uid() or j.artisan_id = auth.uid()))
  or public.has_role(auth.uid(),'admin'));
create policy "job chat write" on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and (j.customer_id = auth.uid() or j.artisan_id = auth.uid())));

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  raised_by uuid not null default auth.uid(),
  reason text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.disputes to authenticated;
grant all on public.disputes to service_role;
alter table public.disputes enable row level security;
create policy "dispute read" on public.disputes for select to authenticated using (raised_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "dispute create" on public.disputes for insert to authenticated with check (
  raised_by = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and (j.customer_id = auth.uid() or j.artisan_id = auth.uid())));
create policy "dispute resolve" on public.disputes for update to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r app_role;
begin
  r := case when new.raw_user_meta_data->>'role' = 'artisan' then 'artisan'::app_role else 'customer'::app_role end;
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), new.raw_user_meta_data->>'phone');
  insert into public.user_roles (user_id, role) values (new.id, r);
  if r = 'artisan' then
    insert into public.artisans (user_id, category) values (new.id, coalesce(new.raw_user_meta_data->>'category','General labour'));
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.artisans;

create policy "media upload own" on storage.objects for insert to authenticated
  with check (bucket_id in ('job-media','artisan-docs') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "job media read" on storage.objects for select to authenticated using (bucket_id = 'job-media');
create policy "docs read" on storage.objects for select to authenticated
  using (bucket_id = 'artisan-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(),'admin')));