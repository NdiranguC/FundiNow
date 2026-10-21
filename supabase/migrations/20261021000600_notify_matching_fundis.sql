CREATE OR REPLACE FUNCTION public.notify_artisan_pending_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_online
     AND NEW.verified
     AND NEW.last_active_at >= now() - interval '10 minutes'
     AND (
       NOT OLD.is_online
       OR OLD.last_active_at IS NULL
       OR OLD.last_active_at < now() - interval '10 minutes'
     ) THEN
    INSERT INTO public.notifications (user_id, job_id, title, body)
    SELECT NEW.user_id, j.id, 'New job request', 'A matching job is available in your category.'
    FROM public.jobs j
    WHERE j.status = 'pending'
      AND j.artisan_id IS NULL
      AND j.category = NEW.category
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.user_id
          AND n.job_id = j.id
          AND n.title = 'New job request'
      );
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER artisans_notify_pending_jobs
AFTER UPDATE OF is_online, last_active_at ON public.artisans
FOR EACH ROW EXECUTE FUNCTION public.notify_artisan_pending_jobs();
