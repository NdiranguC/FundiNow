import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import logo from "@/assets/logo.png";

export function AppHeader() {
  const { user, isAdmin, isArtisan, error } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const d = localStorage.getItem("theme") === "dark";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
  }, []);
  useEffect(() => {
    if (error) toast.error("Your account details could not be loaded.");
  }, [error]);
  const toggleTheme = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  };
  const link =
    "rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground";
  const active = {
    className: "rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground",
  };
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-3">
        <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary p-1 dark:bg-card">
            <img src={logo} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
          </span>
          <span>
            Fundi<span className="text-primary">Now</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {user && !isArtisan && (
            <Link to="/dashboard" className={link} activeProps={active}>
              My jobs
            </Link>
          )}
          {user && !isArtisan && (
            <Link to="/request" className={link} activeProps={active}>
              Request
            </Link>
          )}
          {isArtisan && (
            <Link to="/artisan" className={link} activeProps={active}>
              Artisan
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className={link} activeProps={active}>
              Admin
            </Link>
          )}
          {user && <NotificationsMenu userId={user.id} />}
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className={`${link} inline-flex items-center`}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {user ? (
            <button
              className={link}
              onClick={async () => {
                const { error } = await supabase.auth.signOut();
                if (error) {
                  toast.error(error.message);
                  return;
                }
                await navigate({ to: "/auth", replace: true });
              }}
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/auth"
              className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
