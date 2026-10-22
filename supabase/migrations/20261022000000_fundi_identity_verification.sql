ALTER TABLE public.artisans
  ADD COLUMN verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'pending_review')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verification_submitted_at timestamptz,
  ADD COLUMN verification_review_reason text;

UPDATE public.artisans
SET verification_status = CASE WHEN verified THEN 'verified' ELSE 'pending' END;

ALTER TABLE public.artisans
  ADD CONSTRAINT artisans_verification_consistent
    CHECK (verified = (verification_status = 'verified'));

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

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'You can only create your own fundi profile';
    END IF;
    NEW.verified := false;
    NEW.id_doc_path := NULL;
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verification_submitted_at := NULL;
    NEW.verification_review_reason := NULL;
    NEW.rating := 5;
    NEW.rating_count := 0;
    RETURN NEW;
  END IF;

  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Only the fundi or an admin can update this profile';
  END IF;

  NEW.verified := OLD.verified;
  NEW.id_doc_path := OLD.id_doc_path;
  NEW.verification_status := OLD.verification_status;
  NEW.verified_at := OLD.verified_at;
  NEW.verification_submitted_at := OLD.verification_submitted_at;
  NEW.verification_review_reason := OLD.verification_review_reason;
  NEW.rating := OLD.rating;
  NEW.rating_count := OLD.rating_count;

  IF NEW.is_online AND NOT NEW.verified THEN
    RAISE EXCEPTION 'Your profile must be verified before going online';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS artisans_protect ON public.artisans;
CREATE TRIGGER artisans_protect
BEFORE INSERT OR UPDATE ON public.artisans
FOR EACH ROW EXECUTE FUNCTION public.protect_artisan_fields();

CREATE OR REPLACE FUNCTION public.protect_verified_artisan_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.full_name IS DISTINCT FROM NEW.full_name
     AND auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin')
     AND EXISTS (
       SELECT 1
       FROM public.artisans a
       WHERE a.user_id = OLD.id
         AND a.verified
     ) THEN
    RAISE EXCEPTION 'A verified fundi cannot change their legal name';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_protect_verified_artisan_name
BEFORE UPDATE OF full_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_verified_artisan_name();
