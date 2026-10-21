ALTER TABLE public.artisans
  ADD COLUMN last_active_at timestamptz;

ALTER TABLE public.disputes
  ADD COLUMN report_type text NOT NULL DEFAULT 'job_issue'
    CHECK (report_type IN ('job_issue', 'service_quality', 'safety')),
  ADD COLUMN reported_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) <= 120),
  body text NOT NULL CHECK (char_length(body) <= 500),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users mark their notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (
    event_type IN ('signup', 'login', 'job_requested', 'job_accepted', 'job_completed', 'payment_confirmed')
  ),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_created_idx
  ON public.analytics_events (created_at DESC);
GRANT SELECT ON public.analytics_events TO authenticated;
GRANT INSERT (event_type, actor_id, entity_id) ON public.analytics_events TO authenticated;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read analytics events"
  ON public.analytics_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users record their own logins"
  ON public.analytics_events FOR INSERT TO authenticated
  WITH CHECK (
    event_type = 'login'
    AND actor_id = auth.uid()
    AND entity_id = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.capture_signup_analytics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.analytics_events (event_type, actor_id, entity_id)
  VALUES ('signup', NEW.id, NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER auth_user_signup_analytics
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.capture_signup_analytics();

CREATE OR REPLACE FUNCTION public.capture_job_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient uuid;
  event_name text;
  notice_title text;
  notice_body text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.analytics_events (event_type, actor_id, entity_id)
    VALUES ('job_requested', NEW.customer_id, NEW.id);

    INSERT INTO public.notifications (user_id, job_id, title, body)
    VALUES (NEW.customer_id, NEW.id, 'Request received', 'Your job request has been submitted.');

    FOR recipient IN
      SELECT a.user_id
      FROM public.artisans a
      WHERE a.category = NEW.category
        AND a.verified
        AND a.is_online
        AND a.last_active_at >= now() - interval '10 minutes'
        AND (NEW.artisan_id IS NULL OR a.user_id = NEW.artisan_id)
    LOOP
      INSERT INTO public.notifications (user_id, job_id, title, body)
      VALUES (recipient, NEW.id, 'New job request', 'A matching job is available in your category.');
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      event_name := 'job_accepted';
      notice_title := 'Fundi accepted your request';
      notice_body := 'Your fundi accepted the job and will keep you updated.';
    ELSIF NEW.status = 'en_route' THEN
      notice_title := 'Your fundi is on the way';
      notice_body := 'Your fundi has started travelling to the job location.';
    ELSIF NEW.status = 'in_progress' THEN
      notice_title := 'Work has started';
      notice_body := 'The fundi has marked your job as in progress.';
    ELSIF NEW.status = 'completed' THEN
      event_name := 'job_completed';
      notice_title := 'Job marked complete';
      notice_body := 'Your job has been marked complete. You can now leave a review.';
    ELSIF NEW.status = 'cancelled' THEN
      notice_title := 'Job cancelled';
      notice_body := 'This job request has been cancelled.';
    END IF;

    IF event_name IS NOT NULL THEN
      INSERT INTO public.analytics_events (event_type, actor_id, entity_id)
      VALUES (event_name, coalesce(auth.uid(), NEW.artisan_id, NEW.customer_id), NEW.id);
    END IF;

    IF notice_title IS NOT NULL THEN
      FOREACH recipient IN ARRAY ARRAY[NEW.customer_id, NEW.artisan_id]
      LOOP
        IF recipient IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, job_id, title, body)
          VALUES (recipient, NEW.id, notice_title, notice_body);
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.artisan_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, body)
    VALUES (
      NEW.artisan_id,
      NEW.id,
      'Appointment rescheduled',
      'The customer changed the scheduled time for this job.'
    );
  END IF;

  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    INSERT INTO public.analytics_events (event_type, actor_id, entity_id)
    VALUES ('payment_confirmed', coalesce(auth.uid(), NEW.customer_id), NEW.id);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER jobs_capture_activity
AFTER INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.capture_job_activity();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.reschedule_job(_job uuid, _scheduled_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.jobs;
  base_price integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'customer') THEN
    RAISE EXCEPTION 'Only customers can reschedule jobs';
  END IF;
  IF _scheduled_at IS NULL OR _scheduled_at <= now() THEN
    RAISE EXCEPTION 'Choose a future appointment time';
  END IF;

  SELECT * INTO current_job
  FROM public.jobs
  WHERE id = _job
  FOR UPDATE;

  IF NOT FOUND OR current_job.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF current_job.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'Only pending or accepted jobs can be rescheduled';
  END IF;

  base_price := CASE current_job.category
    WHEN 'Electrical' THEN 1500
    WHEN 'Plumbing' THEN 1500
    WHEN 'Carpentry' THEN 2000
    WHEN 'Masonry' THEN 2500
    WHEN 'Painting' THEN 2000
    ELSE 1000
  END;

  PERFORM set_config('fundi.reschedule_job', 'on', true);
  UPDATE public.jobs
  SET urgency = 'scheduled',
      scheduled_at = _scheduled_at,
      price_estimate = base_price
  WHERE id = _job;
  PERFORM set_config('fundi.reschedule_job', 'off', true);
END
$$;

REVOKE ALL ON FUNCTION public.reschedule_job(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_job(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_job_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  fields_unchanged boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_setting('fundi.reschedule_job', true) = 'on'
     AND caller = OLD.customer_id
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
     AND NEW.artisan_id IS NOT DISTINCT FROM OLD.artisan_id
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.address IS NOT DISTINCT FROM OLD.address
     AND NEW.lat IS NOT DISTINCT FROM OLD.lat
     AND NEW.lng IS NOT DISTINCT FROM OLD.lng
     AND NEW.urgency = 'scheduled'
     AND NEW.scheduled_at > now()
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.photos IS NOT DISTINCT FROM OLD.photos
     AND NEW.rating IS NOT DISTINCT FROM OLD.rating
     AND NEW.review IS NOT DISTINCT FROM OLD.review
     AND NEW.review_public IS NOT DISTINCT FROM OLD.review_public
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.lat IS DISTINCT FROM OLD.lat
     OR NEW.lng IS DISTINCT FROM OLD.lng
     OR NEW.urgency IS DISTINCT FROM OLD.urgency
     OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.price_estimate IS DISTINCT FROM OLD.price_estimate
     OR NEW.photos IS DISTINCT FROM OLD.photos
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Job details and payment status cannot be changed';
  END IF;

  fields_unchanged :=
    NEW.artisan_id IS NOT DISTINCT FROM OLD.artisan_id
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.rating IS NOT DISTINCT FROM OLD.rating
    AND NEW.review IS NOT DISTINCT FROM OLD.review
    AND NEW.review_public IS NOT DISTINCT FROM OLD.review_public;

  IF is_admin THEN
    IF NOT fields_unchanged AND NEW.status = 'cancelled'
       AND NEW.artisan_id IS NOT DISTINCT FROM OLD.artisan_id
       AND NEW.rating IS NOT DISTINCT FROM OLD.rating
       AND NEW.review IS NOT DISTINCT FROM OLD.review
       AND NEW.review_public IS NOT DISTINCT FROM OLD.review_public THEN
      RETURN NEW;
    END IF;
    IF fields_unchanged THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Admins may only cancel jobs';
  END IF;

  IF caller IS NOT NULL
     AND public.has_role(caller, 'artisan')
     AND OLD.status = 'pending'
     AND OLD.artisan_id IS NULL
     AND NEW.artisan_id = caller
     AND NEW.status = 'accepted'
     AND NEW.rating IS NOT DISTINCT FROM OLD.rating
     AND NEW.review IS NOT DISTINCT FROM OLD.review
     AND NEW.review_public IS NOT DISTINCT FROM OLD.review_public THEN
    RETURN NEW;
  END IF;

  IF caller = OLD.customer_id THEN
    IF NEW.artisan_id IS DISTINCT FROM OLD.artisan_id THEN
      RAISE EXCEPTION 'Customers cannot assign fundis';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending', 'accepted')) THEN
      RAISE EXCEPTION 'Customers may only cancel pending or accepted jobs';
    END IF;
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.review IS DISTINCT FROM OLD.review
       OR NEW.review_public IS DISTINCT FROM OLD.review_public THEN
      IF OLD.status <> 'completed' OR OLD.rating IS NOT NULL
         OR NEW.rating IS NULL OR NEW.rating < 1 OR NEW.rating > 5 THEN
        RAISE EXCEPTION 'Only completed jobs can receive one valid customer review';
      END IF;
      IF NEW.review_public AND length(trim(coalesce(NEW.review, ''))) = 0 THEN
        RAISE EXCEPTION 'Only written reviews can be published';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF caller = OLD.artisan_id AND public.has_role(caller, 'artisan') THEN
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.review IS DISTINCT FROM OLD.review
       OR NEW.review_public IS DISTINCT FROM OLD.review_public THEN
      RAISE EXCEPTION 'Fundis cannot change customer review or job assignment';
    END IF;
    IF OLD.status = 'pending' AND NEW.status = 'pending'
       AND NEW.artisan_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.artisan_id IS DISTINCT FROM OLD.artisan_id THEN
      RAISE EXCEPTION 'Fundis cannot change job assignment';
    END IF;
    IF (OLD.status = 'accepted' AND NEW.status = 'en_route')
       OR (OLD.status = 'en_route' AND NEW.status = 'in_progress')
       OR (OLD.status = 'in_progress' AND NEW.status = 'completed')
       OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invalid job status transition';
  END IF;

  RAISE EXCEPTION 'Only a job participant can update this job';
END
$$;

CREATE OR REPLACE FUNCTION public.protect_artisan_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('fundi.rating_update', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
    IF NOT NEW.verified THEN
      NEW.is_online := false;
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Only the fundi or an admin can update this profile';
  END IF;

  NEW.verified := OLD.verified;
  NEW.rating := OLD.rating;
  NEW.rating_count := OLD.rating_count;

  IF NEW.is_online AND NOT NEW.verified THEN
    RAISE EXCEPTION 'Your profile must be verified before going online';
  END IF;

  IF NEW.is_online AND NEW.last_active_at IS NULL THEN
    NEW.last_active_at := now();
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.prepare_job_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_price integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NEW.customer_id IS DISTINCT FROM auth.uid()
     OR NOT public.has_role(auth.uid(), 'customer') THEN
    RAISE EXCEPTION 'Only customers can create job requests';
  END IF;

  IF NEW.status <> 'pending' OR NEW.payment_status <> 'unpaid'
     OR NEW.rating IS NOT NULL OR NEW.review IS NOT NULL THEN
    RAISE EXCEPTION 'New jobs must start pending, unpaid, and unrated';
  END IF;

  IF NEW.category NOT IN ('Electrical', 'Plumbing', 'Carpentry', 'Masonry', 'Painting', 'General labour') THEN
    RAISE EXCEPTION 'Unsupported job category';
  END IF;

  IF length(trim(NEW.description)) < 5 OR length(NEW.description) > 2000
     OR length(trim(NEW.address)) = 0 OR length(NEW.address) > 500 THEN
    RAISE EXCEPTION 'Enter a valid job description and address';
  END IF;

  IF NEW.urgency = 'scheduled' THEN
    IF NEW.scheduled_at IS NULL OR NEW.scheduled_at <= now() THEN
      RAISE EXCEPTION 'Scheduled jobs need a future appointment time';
    END IF;
  ELSE
    NEW.scheduled_at := NULL;
  END IF;

  IF (NEW.lat IS NULL) <> (NEW.lng IS NULL)
     OR (NEW.lat IS NOT NULL AND (abs(NEW.lat) > 90 OR abs(NEW.lng) > 180)) THEN
    RAISE EXCEPTION 'Invalid job coordinates';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.photos) AS photos(photo)
    WHERE photo NOT LIKE auth.uid()::text || '/%'
  ) THEN
    RAISE EXCEPTION 'Job photos must belong to the requesting customer';
  END IF;

  IF NEW.artisan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.artisans a
    WHERE a.user_id = NEW.artisan_id
      AND a.category = NEW.category
      AND a.is_online
      AND a.verified
      AND a.last_active_at >= now() - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION 'That fundi is not recently active for this category';
  END IF;

  base_price := CASE NEW.category
    WHEN 'Electrical' THEN 1500
    WHEN 'Plumbing' THEN 1500
    WHEN 'Carpentry' THEN 2000
    WHEN 'Masonry' THEN 2500
    WHEN 'Painting' THEN 2000
    ELSE 1000
  END;
  NEW.price_estimate := round(
    (base_price * CASE WHEN NEW.urgency = 'instant' THEN 1.25 ELSE 1 END) / 50.0
  )::integer * 50;
  NEW.payment_method := NULL;
  NEW.review_public := false;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.respond_job(_job uuid, _accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j public.jobs;
  a public.artisans;
BEGIN
  IF NOT public.has_role(auth.uid(), 'artisan') THEN
    RAISE EXCEPTION 'Only registered fundis can respond to jobs';
  END IF;

  SELECT * INTO a FROM public.artisans WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR NOT a.is_online OR NOT a.verified
     OR a.last_active_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Go online again to refresh your availability before accepting jobs';
  END IF;

  SELECT * INTO j FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'pending' THEN
    RAISE EXCEPTION 'Job is no longer available';
  END IF;
  IF j.category <> a.category THEN
    RAISE EXCEPTION 'This job does not match your category';
  END IF;
  IF j.artisan_id IS NOT NULL AND j.artisan_id <> auth.uid() THEN
    RAISE EXCEPTION 'This job was offered to another fundi';
  END IF;

  IF _accept THEN
    UPDATE public.jobs SET artisan_id = auth.uid(), status = 'accepted' WHERE id = _job;
  ELSIF j.artisan_id = auth.uid() THEN
    UPDATE public.jobs SET artisan_id = NULL WHERE id = _job;
  END IF;
END
$$;

DROP POLICY IF EXISTS "dispute create" ON public.disputes;
CREATE POLICY "dispute create"
  ON public.disputes FOR INSERT TO authenticated
  WITH CHECK (
    raised_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid())
        AND (
          reported_user_id IS NULL
          OR reported_user_id IN (j.customer_id, j.artisan_id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.validate_dispute_report()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reported_user_id = NEW.raised_by THEN
    RAISE EXCEPTION 'You cannot report yourself';
  END IF;
  IF NEW.reported_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = NEW.job_id
      AND NEW.reported_user_id IN (j.customer_id, j.artisan_id)
  ) THEN
    RAISE EXCEPTION 'Only a participant in this job can be reported';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER validate_dispute_report
BEFORE INSERT ON public.disputes
FOR EACH ROW EXECUTE FUNCTION public.validate_dispute_report();

CREATE OR REPLACE FUNCTION public.mark_artisan_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.artisans
  SET last_active_at = now()
  WHERE user_id = auth.uid()
    AND is_online
    AND verified
    AND public.has_role(auth.uid(), 'artisan');
END
$$;

REVOKE ALL ON FUNCTION public.mark_artisan_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_artisan_active() TO authenticated;
