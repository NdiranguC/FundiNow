CREATE OR REPLACE FUNCTION public.enforce_single_admin_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.role = 'admin' AND NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = NEW.user_id
      AND lower(u.email) = 'charlesmutuan@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Only the designated administrator email may have the admin role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER enforce_single_admin_email
BEFORE INSERT OR UPDATE OF user_id, role ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_admin_email();

CREATE OR REPLACE FUNCTION public.prevent_admin_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email
     AND EXISTS (
       SELECT 1
       FROM public.user_roles r
       WHERE r.user_id = OLD.id
         AND r.role = 'admin'
     ) THEN
    RAISE EXCEPTION 'The designated administrator account cannot change its email'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER prevent_admin_email_change
BEFORE UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.prevent_admin_email_change();

DELETE FROM public.user_roles r
WHERE r.role = 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = r.user_id
      AND lower(u.email) = 'charlesmutuan@gmail.com'
  );

CREATE UNIQUE INDEX user_roles_single_admin
ON public.user_roles (role)
WHERE role = 'admin';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r app_role;
BEGIN
  r := CASE
    WHEN lower(coalesce(NEW.email, '')) = 'charlesmutuan@gmail.com'
      THEN 'admin'::app_role
    WHEN NEW.raw_user_meta_data->>'role' = 'artisan'
      THEN 'artisan'::app_role
    ELSE 'customer'::app_role
  END;

  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.raw_user_meta_data->>'phone'
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, r);

  IF r = 'artisan' THEN
    INSERT INTO public.artisans (user_id, category)
    VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'category', 'General labour'));
  END IF;

  RETURN NEW;
END
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE lower(email) = 'charlesmutuan@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
