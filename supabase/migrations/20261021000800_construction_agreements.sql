ALTER TABLE public.jobs
  ADD COLUMN quote_required boolean NOT NULL DEFAULT true,
  ADD COLUMN customer_confirmed_at timestamptz;

UPDATE public.jobs SET quote_required = false;

REVOKE UPDATE (quote_required, customer_confirmed_at) ON public.jobs FROM authenticated;

CREATE OR REPLACE FUNCTION public.prepare_job_quote_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.quote_required := true;
  ELSIF NEW.quote_required IS DISTINCT FROM OLD.quote_required THEN
    RAISE EXCEPTION 'Quote requirements cannot be changed';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER jobs_require_quotes
BEFORE INSERT OR UPDATE OF quote_required ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.prepare_job_quote_requirement();

CREATE TABLE public.job_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 5 AND 3000),
  items jsonb NOT NULL CHECK (
    CASE
      WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) BETWEEN 1 AND 20
      ELSE false
    END
  ),
  total numeric(12, 2) NOT NULL CHECK (total > 0),
  change_reason text CHECK (change_reason IS NULL OR length(trim(change_reason)) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'superseded')),
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decision_approved boolean,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  UNIQUE (job_id, version)
);

CREATE INDEX job_quotes_job_version_idx ON public.job_quotes (job_id, version DESC);
ALTER TABLE public.job_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_quotes FROM anon, authenticated;
GRANT SELECT ON public.job_quotes TO authenticated;
CREATE POLICY "Job participants read quotes"
  ON public.job_quotes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_quotes.job_id
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.protect_job_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('fundi.quote_insert', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Quotes must be submitted through the quote workflow';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('fundi.quote_update', true) IS DISTINCT FROM 'on'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.items IS DISTINCT FROM OLD.items
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Quote details are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER job_quotes_protect
BEFORE INSERT OR UPDATE ON public.job_quotes
FOR EACH ROW EXECUTE FUNCTION public.protect_job_quote();

CREATE OR REPLACE FUNCTION public.submit_job_quote(
  _job uuid,
  _scope text,
  _items jsonb,
  _change_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.jobs;
  quote_id uuid;
  item jsonb;
  total_amount numeric := 0;
  line_quantity numeric;
  line_price numeric;
  line_type text;
  line_description text;
  line_unit text;
  next_version integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'artisan') THEN
    RAISE EXCEPTION 'Only registered fundis can submit a quote';
  END IF;
  IF length(trim(coalesce(_scope, ''))) NOT BETWEEN 5 AND 3000
     OR jsonb_typeof(_items) IS DISTINCT FROM 'array'
     OR length(trim(coalesce(_change_reason, ''))) > 1000 THEN
    RAISE EXCEPTION 'Enter a valid scope and between 1 and 20 quote items';
  END IF;
  IF jsonb_array_length(_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Enter between 1 and 20 quote items';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    line_type := item->>'type';
    line_description := trim(coalesce(item->>'description', ''));
    line_unit := trim(coalesce(item->>'unit', ''));
    IF line_type NOT IN ('labour', 'materials', 'transport', 'other')
       OR length(line_description) NOT BETWEEN 2 AND 200
       OR length(line_unit) NOT BETWEEN 1 AND 40
       OR coalesce(item->>'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$'
       OR coalesce(item->>'unit_price', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'One or more quote items are invalid';
    END IF;
    line_quantity := (item->>'quantity')::numeric;
    line_price := (item->>'unit_price')::numeric;
    IF line_quantity <= 0 OR line_quantity > 100000
       OR line_price < 0 OR line_price > 100000000 THEN
      RAISE EXCEPTION 'Quote quantity or price is outside allowed limits';
    END IF;
    total_amount := total_amount + line_quantity * line_price;
  END LOOP;
  total_amount := round(total_amount, 2);
  IF total_amount <= 0 OR total_amount > 1000000000 THEN
    RAISE EXCEPTION 'Quote total must be greater than zero and within allowed limits';
  END IF;

  SELECT * INTO current_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR current_job.artisan_id IS DISTINCT FROM auth.uid()
     OR current_job.status IN ('pending', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only the assigned fundi can quote an active job';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO next_version
  FROM public.job_quotes WHERE job_id = _job;
  PERFORM set_config('fundi.quote_update', 'on', true);
  UPDATE public.job_quotes SET status = 'superseded'
  WHERE job_id = _job AND status IN ('pending', 'approved');
  PERFORM set_config('fundi.quote_insert', 'on', true);
  INSERT INTO public.job_quotes (job_id, version, scope, items, total, change_reason, submitted_by)
  VALUES (_job, next_version, trim(_scope), _items, total_amount, nullif(trim(_change_reason), ''), auth.uid())
  RETURNING id INTO quote_id;
  PERFORM set_config('fundi.quote_insert', 'off', true);
  PERFORM set_config('fundi.quote_update', 'off', true);

  INSERT INTO public.notifications (user_id, job_id, title, body)
  VALUES (current_job.customer_id, _job, 'Quote ready for review',
          'Your fundi submitted quote version ' || next_version || '. Review it before work proceeds.');
  RETURN quote_id;
END
$$;

CREATE OR REPLACE FUNCTION public.decide_job_quote(_quote uuid, _approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_quote public.job_quotes;
  current_job public.jobs;
  selected_job_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to decide on a quote';
  END IF;
  SELECT job_id INTO selected_job_id FROM public.job_quotes WHERE id = _quote;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  SELECT * INTO current_job FROM public.jobs WHERE id = selected_job_id FOR UPDATE;
  IF current_job.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the customer can approve or decline a quote';
  END IF;
  IF current_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Quotes cannot be changed after a job is closed';
  END IF;
  SELECT * INTO selected_quote FROM public.job_quotes WHERE id = _quote FOR UPDATE;
  IF NOT FOUND OR selected_quote.status <> 'pending'
     OR selected_quote.version <> (
       SELECT max(latest.version) FROM public.job_quotes latest WHERE latest.job_id = selected_quote.job_id
     ) THEN
    RAISE EXCEPTION 'This quote is no longer awaiting a decision';
  END IF;
  PERFORM set_config('fundi.quote_update', 'on', true);
  UPDATE public.job_quotes
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'declined' END,
      decision_approved = _approve,
      decided_by = auth.uid(), decided_at = now()
  WHERE id = _quote;
  PERFORM set_config('fundi.quote_update', 'off', true);

  INSERT INTO public.notifications (user_id, job_id, title, body)
  VALUES (
    current_job.artisan_id, current_job.id,
    CASE WHEN _approve THEN 'Quote approved' ELSE 'Quote declined' END,
    CASE WHEN _approve THEN 'The customer approved your quote.' ELSE 'The customer declined your quote. Discuss changes in job chat.' END
  );
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_approved_job_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quote_required AND NEW.status IN ('in_progress', 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM public.job_quotes q
       WHERE q.job_id = NEW.id
         AND q.version = (SELECT max(latest.version) FROM public.job_quotes latest WHERE latest.job_id = NEW.id)
         AND q.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'The customer must approve a quote before work can proceed';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER jobs_require_approved_quote
BEFORE UPDATE OF status ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_approved_job_quote();

CREATE TABLE public.job_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN ('progress', 'evidence', 'handover')),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  media_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_updates_job_created_idx ON public.job_updates (job_id, created_at);
ALTER TABLE public.job_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_updates FROM anon, authenticated;
GRANT SELECT ON public.job_updates TO authenticated;
GRANT INSERT (job_id, author_id, kind, body, media_path) ON public.job_updates TO authenticated;
CREATE POLICY "Job participants read updates"
  ON public.job_updates FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_updates.job_id
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid())
    )
  );
CREATE POLICY "Job participants add updates"
  ON public.job_updates FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_updates.job_id
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid())
    )
    AND (media_path IS NULL OR media_path LIKE auth.uid()::text || '/' || job_id::text || '/%')
  );

CREATE OR REPLACE FUNCTION public.protect_job_update_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Job evidence and updates cannot be changed or deleted';
END
$$;

CREATE OR REPLACE FUNCTION public.protect_handover_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'handover'
     AND current_setting('fundi.confirm_handover', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Handover confirmations must use the customer workflow';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER job_updates_protect_handover
BEFORE INSERT ON public.job_updates
FOR EACH ROW EXECUTE FUNCTION public.protect_handover_update();

CREATE TRIGGER job_updates_append_only
BEFORE UPDATE OR DELETE ON public.job_updates
FOR EACH ROW EXECUTE FUNCTION public.protect_job_update_rows();

CREATE TABLE public.job_snags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolution text CHECK (resolution IS NULL OR length(trim(resolution)) BETWEEN 3 AND 1000),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz
);

CREATE INDEX job_snags_job_created_idx ON public.job_snags (job_id, created_at);
ALTER TABLE public.job_snags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_snags FROM anon, authenticated;
GRANT SELECT ON public.job_snags TO authenticated;
CREATE POLICY "Job participants read snags"
  ON public.job_snags FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_snags.job_id
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.create_job_snag(_job uuid, _description text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.jobs;
  snag_id uuid;
BEGIN
  SELECT * INTO current_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR current_job.customer_id IS DISTINCT FROM auth.uid()
     OR current_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Only the customer can raise a snag on a completed job';
  END IF;
  IF length(trim(coalesce(_description, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Describe the issue in 3 to 1000 characters';
  END IF;
  INSERT INTO public.job_snags (job_id, description, created_by)
  VALUES (_job, trim(_description), auth.uid())
  RETURNING id INTO snag_id;
  INSERT INTO public.notifications (user_id, job_id, title, body)
  VALUES (current_job.artisan_id, _job, 'Customer reported a snag', 'Review the job follow-up and record how you resolved it.');
  RETURN snag_id;
END
$$;

CREATE OR REPLACE FUNCTION public.resolve_job_snag(_snag uuid, _resolution text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_snag public.job_snags;
  current_job public.jobs;
BEGIN
  SELECT * INTO selected_snag FROM public.job_snags WHERE id = _snag FOR UPDATE;
  IF NOT FOUND OR selected_snag.status <> 'open' THEN
    RAISE EXCEPTION 'This snag is no longer open';
  END IF;
  SELECT * INTO current_job FROM public.jobs WHERE id = selected_snag.job_id FOR UPDATE;
  IF current_job.artisan_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the assigned fundi can resolve this snag';
  END IF;
  IF length(trim(coalesce(_resolution, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Describe the resolution in 3 to 1000 characters';
  END IF;
  UPDATE public.job_snags
  SET status = 'resolved', resolution = trim(_resolution),
      resolved_by = auth.uid(), resolved_at = now()
  WHERE id = _snag;
  INSERT INTO public.notifications (user_id, job_id, title, body)
  VALUES (current_job.customer_id, current_job.id, 'Fundi resolved a snag', 'Review the fundi’s resolution in your job follow-up.');
END
$$;

CREATE OR REPLACE FUNCTION public.confirm_job_handover(_job uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.jobs;
BEGIN
  SELECT * INTO current_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR current_job.customer_id IS DISTINCT FROM auth.uid()
     OR current_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Only the customer can confirm handover for a completed job';
  END IF;
  IF current_job.customer_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Handover has already been confirmed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_snags WHERE job_id = _job AND status = 'open') THEN
    RAISE EXCEPTION 'Resolve or close open snags before confirming handover';
  END IF;
  UPDATE public.jobs SET customer_confirmed_at = now() WHERE id = _job;
  PERFORM set_config('fundi.confirm_handover', 'on', true);
  INSERT INTO public.job_updates (job_id, author_id, kind, body)
  VALUES (_job, auth.uid(), 'handover', 'Customer confirmed the job handover.');
  PERFORM set_config('fundi.confirm_handover', 'off', true);
  INSERT INTO public.notifications (user_id, job_id, title, body)
  VALUES (current_job.artisan_id, _job, 'Handover confirmed', 'The customer confirmed handover for this job.');
END
$$;

CREATE POLICY "Job participants read job evidence media"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-media'
    AND EXISTS (
      SELECT 1 FROM public.job_updates u
      JOIN public.jobs j ON j.id = u.job_id
      WHERE u.media_path = storage.objects.name
        AND (j.customer_id = auth.uid() OR j.artisan_id = auth.uid()
             OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Signed-in users read verified artisan portfolio"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-media'
    AND EXISTS (
      SELECT 1 FROM public.artisans a
      WHERE a.verified AND a.portfolio @> ARRAY[storage.objects.name]
        AND (storage.foldername(storage.objects.name))[1] = a.user_id::text
    )
  );

CREATE OR REPLACE FUNCTION public.artisan_completed_job_counts(_artisan_ids uuid[])
RETURNS TABLE (artisan_id uuid, completed_jobs bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.artisan_id, count(*)::bigint
  FROM public.jobs j
  WHERE auth.uid() IS NOT NULL
    AND j.artisan_id = ANY(_artisan_ids)
    AND j.status = 'completed'
  GROUP BY j.artisan_id
$$;

REVOKE ALL ON FUNCTION public.submit_job_quote(uuid, text, jsonb, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.decide_job_quote(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.create_job_snag(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.resolve_job_snag(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.confirm_job_handover(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.artisan_completed_job_counts(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_quote(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_job_quote(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_job_snag(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_job_snag(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_job_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.artisan_completed_job_counts(uuid[]) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_quotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_quotes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_updates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_updates;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_snags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_snags;
  END IF;
END
$$;
