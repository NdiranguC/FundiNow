ALTER TABLE public.profiles ADD COLUMN avatar_path text;
ALTER TABLE public.jobs ADD COLUMN review_public boolean NOT NULL DEFAULT false;
CREATE POLICY "profile photo owner upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "profile photo owner read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "profile photo owner delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE OR REPLACE FUNCTION public.validate_customer_review() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.rating IS DISTINCT FROM OLD.rating OR NEW.review IS DISTINCT FROM OLD.review OR NEW.review_public IS DISTINCT FROM OLD.review_public THEN
  IF auth.uid() IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'Only the customer may submit a review'; END IF;
  IF OLD.status <> 'completed' OR NEW.status <> 'completed' THEN RAISE EXCEPTION 'Only completed jobs can be reviewed'; END IF;
  IF NEW.rating IS NULL OR NEW.rating < 1 OR NEW.rating > 5 THEN RAISE EXCEPTION 'Choose a rating from 1 to 5'; END IF;
  IF OLD.rating IS NOT NULL AND (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.review IS DISTINCT FROM OLD.review) THEN RAISE EXCEPTION 'Review has already been submitted'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_customer_review BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.validate_customer_review();
CREATE OR REPLACE FUNCTION public.customer_reviews() RETURNS TABLE (id uuid, rating integer, review text, category text, created_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT j.id, j.rating, j.review, j.category, j.created_at FROM public.jobs j WHERE j.status = 'completed' AND j.rating BETWEEN 1 AND 5 AND j.review_public AND length(trim(j.review)) > 0 ORDER BY j.created_at DESC LIMIT 12
$$;
REVOKE ALL ON FUNCTION public.customer_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_reviews() TO anon, authenticated, service_role;