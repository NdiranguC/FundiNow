ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_price_estimate_minimum;

CREATE OR REPLACE FUNCTION public.enforce_minimum_job_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.price_estimate < 1500 THEN
    RAISE EXCEPTION 'The customer offer must be at least KES 1,500';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER jobs_enforce_minimum_price
BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_minimum_job_price();
