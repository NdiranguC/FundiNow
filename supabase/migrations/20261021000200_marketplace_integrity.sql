insert into storage.buckets (id, name, public, file_size_limit)
values
  ('job-media', 'job-media', false, 52428800),
  ('artisan-docs', 'artisan-docs', false, 10485760),
  ('profile-photos', 'profile-photos', false, 5242880)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'artisans_user_id_fkey'
      and conrelid = 'public.artisans'::regclass
  ) then
    alter table public.artisans
      add constraint artisans_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_customer_id_fkey'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_customer_id_fkey foreign key (customer_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_artisan_id_fkey'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_artisan_id_fkey foreign key (artisan_id) references auth.users(id) on delete set null;
  end if;
end
$$;

create or replace function public.is_eligible_artisan(_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.artisans a
    where a.user_id = auth.uid()
      and a.category = _category
      and a.is_online
      and a.verified
  )
$$;

revoke all on function public.is_eligible_artisan(text) from public, anon;
grant execute on function public.is_eligible_artisan(text) to authenticated;

drop policy if exists "jobs visible" on public.jobs;
create policy "jobs visible"
on public.jobs for select to authenticated
using (
  customer_id = auth.uid()
  or artisan_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
  or (
    status = 'pending'
    and artisan_id is null
    and public.has_role(auth.uid(), 'artisan')
    and public.is_eligible_artisan(category)
  )
);

alter table public.artisans
  add constraint artisans_category_valid check (
    category in ('Electrical', 'Plumbing', 'Carpentry', 'Masonry', 'Painting', 'General labour')
  );
drop policy if exists "own artisan insert" on public.artisans;
create policy "own artisan insert"
on public.artisans for insert to authenticated
with check (auth.uid() = user_id and verified = false and is_online = false);

alter table public.settings
  add constraint settings_commission_pct_range check (commission_pct between 0 and 50);
alter table public.messages
  add constraint messages_body_length check (length(trim(body)) between 1 and 2000);
alter table public.disputes
  add constraint disputes_reason_length check (length(trim(reason)) between 1 and 2000);

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles visible to owners, admins, and marketplace participants"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
  or exists (
    select 1 from public.artisans a
    where a.user_id = profiles.id and a.verified
  )
  or exists (
    select 1 from public.jobs j
    where (j.customer_id = auth.uid() and j.artisan_id = profiles.id)
       or (j.artisan_id = auth.uid() and j.customer_id = profiles.id)
  )
);

drop policy if exists "artisans readable" on public.artisans;
create policy "artisans visible in marketplace or to job participants"
on public.artisans for select to authenticated
using (
  user_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
  or (verified and is_online)
  or exists (
    select 1 from public.jobs j
    where j.artisan_id = artisans.user_id
      and (j.customer_id = auth.uid() or j.artisan_id = auth.uid())
  )
);

create or replace function public.protect_artisan_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('fundi.rating_update', true) = 'on' then
    return new;
  end if;

  if auth.role() = 'service_role' or public.has_role(auth.uid(), 'admin') then
    if not new.verified then
      new.is_online := false;
    end if;
    return new;
  end if;

  if auth.uid() is distinct from old.user_id then
    raise exception 'Only the fundi or an admin can update this profile';
  end if;

  new.verified := old.verified;
  new.rating := old.rating;
  new.rating_count := old.rating_count;

  if new.is_online and not new.verified then
    raise exception 'Your profile must be verified before going online';
  end if;

  return new;
end
$$;

create or replace function public.prepare_job_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_price integer;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() is null or new.customer_id is distinct from auth.uid()
     or not public.has_role(auth.uid(), 'customer') then
    raise exception 'Only customers can create job requests';
  end if;

  if new.status <> 'pending' or new.payment_status <> 'unpaid'
     or new.rating is not null or new.review is not null then
    raise exception 'New jobs must start pending, unpaid, and unrated';
  end if;

  if new.category not in ('Electrical', 'Plumbing', 'Carpentry', 'Masonry', 'Painting', 'General labour') then
    raise exception 'Unsupported job category';
  end if;

  if length(trim(new.description)) < 5 or length(new.description) > 2000
     or length(trim(new.address)) = 0 or length(new.address) > 500 then
    raise exception 'Enter a valid job description and address';
  end if;

  if new.urgency = 'scheduled' then
    if new.scheduled_at is null or new.scheduled_at <= now() then
      raise exception 'Scheduled jobs need a future appointment time';
    end if;
  else
    new.scheduled_at := null;
  end if;

  if (new.lat is null) <> (new.lng is null)
     or (new.lat is not null and (abs(new.lat) > 90 or abs(new.lng) > 180)) then
    raise exception 'Invalid job coordinates';
  end if;

  if exists (
    select 1 from unnest(new.photos) as photos(photo)
    where photo not like auth.uid()::text || '/%'
  ) then
    raise exception 'Job photos must belong to the requesting customer';
  end if;

  if new.artisan_id is not null and not exists (
    select 1 from public.artisans a
    where a.user_id = new.artisan_id
      and a.category = new.category
      and a.is_online
      and a.verified
  ) then
    raise exception 'That fundi is not available for this category';
  end if;

  base_price := case new.category
    when 'Electrical' then 1500
    when 'Plumbing' then 1500
    when 'Carpentry' then 2000
    when 'Masonry' then 2500
    when 'Painting' then 2000
    else 1000
  end;
  new.price_estimate := round(
    (base_price * case when new.urgency = 'instant' then 1.25 else 1 end) / 50.0
  )::integer * 50;
  new.payment_method := null;
  new.review_public := false;
  return new;
end
$$;

drop trigger if exists jobs_prepare_insert on public.jobs;
create trigger jobs_prepare_insert
before insert on public.jobs
for each row execute function public.prepare_job_insert();

create or replace function public.protect_job_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  fields_unchanged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.category is distinct from old.category
     or new.description is distinct from old.description
     or new.address is distinct from old.address
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.urgency is distinct from old.urgency
     or new.scheduled_at is distinct from old.scheduled_at
     or new.price_estimate is distinct from old.price_estimate
     or new.photos is distinct from old.photos
     or new.payment_status is distinct from old.payment_status
     or new.payment_method is distinct from old.payment_method
     or new.created_at is distinct from old.created_at then
    raise exception 'Job details and payment status cannot be changed';
  end if;

  fields_unchanged :=
    new.artisan_id is not distinct from old.artisan_id
    and new.status is not distinct from old.status
    and new.rating is not distinct from old.rating
    and new.review is not distinct from old.review
    and new.review_public is not distinct from old.review_public;

  if is_admin then
    if not fields_unchanged and new.status = 'cancelled'
       and new.artisan_id is not distinct from old.artisan_id
       and new.rating is not distinct from old.rating
       and new.review is not distinct from old.review
       and new.review_public is not distinct from old.review_public then
      return new;
    end if;
    if fields_unchanged then
      return new;
    end if;
    raise exception 'Admins may only cancel jobs';
  end if;

  if caller is not null
     and public.has_role(caller, 'artisan')
     and old.status = 'pending'
     and old.artisan_id is null
     and new.artisan_id = caller
     and new.status = 'accepted'
     and new.rating is not distinct from old.rating
     and new.review is not distinct from old.review
     and new.review_public is not distinct from old.review_public then
    return new;
  end if;

  if caller = old.customer_id then
    if new.artisan_id is distinct from old.artisan_id then
      raise exception 'Customers cannot assign fundis';
    end if;
    if new.status is distinct from old.status
       and not (new.status = 'cancelled' and old.status in ('pending', 'accepted')) then
      raise exception 'Customers may only cancel pending or accepted jobs';
    end if;
    if (new.rating is distinct from old.rating
        or new.review is distinct from old.review
        or new.review_public is distinct from old.review_public)
       and (old.status <> 'completed' or old.rating is not null
            or new.rating is null or new.rating < 1 or new.rating > 5) then
      raise exception 'Only completed jobs can receive one valid customer review';
    end if;
    if new.review_public and length(trim(coalesce(new.review, ''))) = 0 then
      raise exception 'Only written reviews can be published';
    end if;
    return new;
  end if;

  if caller = old.artisan_id and public.has_role(caller, 'artisan') then
    if new.rating is distinct from old.rating
       or new.review is distinct from old.review
       or new.review_public is distinct from old.review_public then
      raise exception 'Fundis cannot change customer review or job assignment';
    end if;
    if old.status = 'pending' and new.status = 'pending'
       and new.artisan_id is null then
      return new;
    end if;
    if new.artisan_id is distinct from old.artisan_id then
      raise exception 'Fundis cannot change job assignment';
    end if;
    if (old.status = 'accepted' and new.status = 'en_route')
       or (old.status = 'en_route' and new.status = 'in_progress')
       or (old.status = 'in_progress' and new.status = 'completed')
       or new.status is not distinct from old.status then
      return new;
    end if;
    raise exception 'Invalid job status transition';
  end if;

  raise exception 'Only a job participant can update this job';
end
$$;

create or replace function public.rate_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rating is not null and old.rating is null and new.artisan_id is not null then
    perform set_config('fundi.rating_update', 'on', true);
    update public.artisans set
      rating = round(((rating * rating_count) + new.rating)::numeric / (rating_count + 1), 2),
      rating_count = rating_count + 1
    where user_id = new.artisan_id;
    perform set_config('fundi.rating_update', 'off', true);
  end if;
  return new;
end
$$;

drop trigger if exists jobs_guard_updates on public.jobs;
create trigger jobs_guard_updates
before update on public.jobs
for each row execute function public.protect_job_updates();

create or replace function public.respond_job(_job uuid, _accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
  a public.artisans;
begin
  if not public.has_role(auth.uid(), 'artisan') then
    raise exception 'Only registered fundis can respond to jobs';
  end if;

  select * into a from public.artisans where user_id = auth.uid() for update;
  if not found or not a.is_online or not a.verified then
    raise exception 'A verified fundi must be online to accept jobs';
  end if;

  select * into j from public.jobs where id = _job for update;
  if not found or j.status <> 'pending' then
    raise exception 'Job is no longer available';
  end if;
  if j.category <> a.category then
    raise exception 'This job does not match your category';
  end if;
  if j.artisan_id is not null and j.artisan_id <> auth.uid() then
    raise exception 'This job was offered to another fundi';
  end if;

  if _accept then
    update public.jobs set artisan_id = auth.uid(), status = 'accepted' where id = _job;
  elsif j.artisan_id = auth.uid() then
    update public.jobs set artisan_id = null where id = _job;
  end if;
end
$$;

revoke all on function public.respond_job(uuid, boolean) from public, anon;
grant execute on function public.respond_job(uuid, boolean) to authenticated;

drop policy if exists "job media read" on storage.objects;
create policy "job media participants read"
on storage.objects for select to authenticated
using (
  bucket_id = 'job-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.jobs j
      where j.photos @> array[storage.objects.name]
        and (j.customer_id = auth.uid() or j.artisan_id = auth.uid()
             or public.has_role(auth.uid(), 'admin'))
    )
  )
);

drop policy if exists "docs read" on storage.objects;
create policy "artisan documents owner or admin read"
on storage.objects for select to authenticated
using (
  bucket_id = 'artisan-docs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_role(auth.uid(), 'admin')
  )
);

drop policy if exists "profile photo owner read" on storage.objects;
create policy "profile photo owner or admin read"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_role(auth.uid(), 'admin')
  )
);

create index if not exists jobs_customer_created_at_idx
  on public.jobs (customer_id, created_at desc);
create index if not exists jobs_artisan_status_idx
  on public.jobs (artisan_id, status, created_at desc);
create index if not exists jobs_pending_category_idx
  on public.jobs (category, created_at desc)
  where status = 'pending';
create index if not exists artisans_online_category_idx
  on public.artisans (category, rating desc)
  where is_online and verified;
