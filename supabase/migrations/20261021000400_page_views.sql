CREATE TABLE public.page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL CHECK (char_length(visitor_id) <= 64),
  user_id uuid,
  path text NOT NULL CHECK (char_length(path) <= 300),
  referrer text CHECK (char_length(referrer) <= 500),
  device text CHECK (char_length(device) <= 20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_views_created_idx ON public.page_views (created_at DESC);
GRANT INSERT ON public.page_views TO anon, authenticated;
GRANT SELECT ON public.page_views TO authenticated;
GRANT ALL ON public.page_views TO service_role;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can log a visit" ON public.page_views FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "Admins read visits" ON public.page_views FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));