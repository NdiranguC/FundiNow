CREATE OR REPLACE FUNCTION public.prevent_admin_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password
     AND EXISTS (
       SELECT 1
       FROM public.user_roles r
       WHERE r.user_id = OLD.id
         AND r.role = 'admin'
     ) THEN
    RAISE EXCEPTION 'Password recovery is disabled for administrator accounts'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER prevent_admin_password_change
BEFORE UPDATE OF encrypted_password ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.prevent_admin_password_change();
