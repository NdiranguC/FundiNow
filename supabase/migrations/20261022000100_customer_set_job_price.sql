CREATE OR REPLACE FUNCTION public.prepare_job_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  NEW.payment_method := NULL;
  NEW.review_public := false;
  RETURN NEW;
END
$$;
