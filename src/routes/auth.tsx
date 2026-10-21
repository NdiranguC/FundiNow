import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/pricing";
import { AppHeader } from "@/components/AppHeader";
import { authRolesQueryKey, loadAuthRoles } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — FundiNow" },
      { name: "description", content: "Sign in or join FundiNow as a customer or artisan." },
      { property: "og:title", content: "Sign in — FundiNow" },
      { property: "og:description", content: "Join FundiNow." },
    ],
  }),
  component: AuthPage,
});

const input =
  "w-full rounded-xl border border-input bg-card px-4 py-3 outline-none focus:border-primary";

function AuthPage() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "checking" | "reset" | "blocked">("in");
  const [role, setRole] = useState<"customer" | "artisan">("customer");
  const [f, setF] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    category: "Electrical",
  });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");

  useEffect(() => {
    const hasRecoveryFlow = new URLSearchParams(window.location.search).get("flow") === "recovery";
    let recoveryTimeout: number | undefined;

    const checkRecoverySession = async () => {
      setMode("checking");
      setRecoveryMessage("");
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          setMode("blocked");
          setRecoveryMessage(
            "This password reset link is invalid or has expired. Request a new link.",
          );
          return;
        }
        const { data: roleRows, error: rolesError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.session.user.id);
        if (rolesError) throw rolesError;
        if (roleRows.some((row) => row.role === "admin")) {
          setMode("blocked");
          setRecoveryMessage("Password recovery is not available for administrator accounts.");
          return;
        }
        setMode("reset");
      } catch (error) {
        console.error("Could not validate password recovery session", error);
        setMode("blocked");
        setRecoveryMessage(
          "We could not verify this reset link. Request a new one or contact support.",
        );
      }
    };

    if (hasRecoveryFlow) {
      setMode("checking");
      recoveryTimeout = window.setTimeout(() => {
        setRecoveryMessage(
          "This password reset link is invalid or has expired. Request a new link.",
        );
        setMode("blocked");
      }, 8000);
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && hasRecoveryFlow) {
        if (recoveryTimeout) window.clearTimeout(recoveryTimeout);
        window.setTimeout(() => void checkRecoverySession(), 0);
      }
    });
    return () => {
      if (recoveryTimeout) window.clearTimeout(recoveryTimeout);
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    if (mode === "forgot") {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(f.email, {
          redirectTo: `${window.location.origin}/auth?flow=recovery`,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        setResetSent(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The reset email could not be sent.");
      } finally {
        setBusy(false);
      }
    } else if (mode === "reset") {
      if (newPassword.length < 8) {
        setBusy(false);
        toast.error("Use a password with at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setBusy(false);
        toast.error("The passwords do not match.");
        return;
      }
      try {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
          toast.error(error.message);
          return;
        }
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          toast.error(`Password changed, but sign-out failed: ${signOutError.message}`);
        } else {
          toast.success("Password changed. Sign in with your new password.");
        }
        setMode("in");
        setNewPassword("");
        setConfirmPassword("");
        setRecoveryMessage("");
        window.history.replaceState({}, "", "/auth");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The password could not be changed.");
      } finally {
        setBusy(false);
      }
    } else if (mode === "in") {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: f.email,
          password: f.password,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!data.user) {
          toast.error("Sign-in succeeded, but the account could not be loaded.");
          return;
        }
        const roles = await queryClient.fetchQuery({
          queryKey: authRolesQueryKey(data.user.id),
          queryFn: () => loadAuthRoles(data.user.id),
          staleTime: Infinity,
        });
        nav({
          to: roles.includes("admin")
            ? "/admin"
            : roles.includes("artisan")
              ? "/artisan"
              : "/dashboard",
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Sign-in could not be completed.");
      } finally {
        setBusy(false);
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email: f.email,
        password: f.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: f.full_name, phone: f.phone, role, category: f.category },
        },
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setSent(true);
    }
  }

  async function google(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(error.message);
  }

  const title =
    mode === "in"
      ? "Welcome back"
      : mode === "up"
        ? "Create your account"
        : mode === "forgot"
          ? "Forgot your password?"
          : mode === "reset"
            ? "Choose a new password"
            : mode === "checking"
              ? "Verifying reset link"
              : "Password reset unavailable";

  return (
    <div className="min-h-screen bg-muted font-sans">
      <AppHeader />
      <div className="mx-auto max-w-md px-5 py-10">
        <div className="rounded-3xl bg-card p-7 shadow-soft">
          {resetSent ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-foreground">
                <KeyRound className="h-6 w-6" />
              </span>
              <h1 className="mt-4 text-2xl font-extrabold">Check your email</h1>
              <p className="mt-2 text-muted-foreground">
                If an eligible account exists for {f.email}, we’ve sent a password reset link. Use
                the link in that email to verify the change and choose a new password.
              </p>
              <button
                className="mt-5 font-bold text-primary"
                onClick={() => {
                  setResetSent(false);
                  setMode("in");
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : sent ? (
            <div className="text-center">
              <h1 className="text-2xl font-extrabold">Check your email</h1>
              <p className="mt-2 text-muted-foreground">
                Click the link we sent to {f.email} to confirm your account.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold">{title}</h1>
              {mode === "blocked" && (
                <div className="mt-4 space-y-3">
                  <p
                    role="alert"
                    className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
                  >
                    {recoveryMessage}
                  </p>
                  <button
                    className="font-bold text-primary"
                    onClick={() => {
                      setMode("forgot");
                      setRecoveryMessage("");
                      window.history.replaceState({}, "", "/auth");
                    }}
                  >
                    Request another reset link
                  </button>
                </div>
              )}
              {mode === "checking" && (
                <p className="mt-4 text-sm text-muted-foreground">Checking your email link…</p>
              )}
              {mode === "reset" && (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your email link is verified. Choose a new password for your account.
                  </p>
                  <form onSubmit={submit} className="mt-5 space-y-3">
                    <label className="block text-sm font-semibold">
                      New password
                      <input
                        required
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        className={`${input} mt-1`}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold">
                      Confirm new password
                      <input
                        required
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        className={`${input} mt-1`}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-60"
                    >
                      {busy ? "Saving…" : "Change password"}
                    </button>
                  </form>
                </>
              )}
              {mode === "up" && (
                <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                  {(["customer", "artisan"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`rounded-lg py-2 text-sm font-bold ${role === r ? "bg-card shadow-soft" : "text-muted-foreground"}`}
                    >
                      {r === "customer" ? "I need a fundi" : "I'm a fundi"}
                    </button>
                  ))}
                </div>
              )}
              {(mode === "in" || mode === "up" || mode === "forgot") && (
                <form onSubmit={submit} className="mt-5 space-y-3">
                  {mode === "up" && (
                    <input
                      required
                      placeholder="Full name"
                      className={input}
                      value={f.full_name}
                      onChange={(e) => setF({ ...f, full_name: e.target.value })}
                    />
                  )}
                  {mode === "up" && (
                    <input
                      required
                      placeholder="Phone (e.g. 0712 345 678)"
                      className={input}
                      value={f.phone}
                      onChange={(e) => setF({ ...f, phone: e.target.value })}
                    />
                  )}
                  {mode === "up" && role === "artisan" && (
                    <select
                      className={input}
                      value={f.category}
                      onChange={(e) => setF({ ...f, category: e.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  )}
                  <input
                    required
                    type="email"
                    placeholder="Email"
                    className={input}
                    value={f.email}
                    onChange={(e) => setF({ ...f, email: e.target.value })}
                  />
                  {mode !== "forgot" && (
                    <div className="relative">
                      <input
                        required
                        type={showPw ? "text" : "password"}
                        minLength={6}
                        placeholder="Password"
                        autoComplete={mode === "in" ? "current-password" : "new-password"}
                        className={`${input} pr-12`}
                        value={f.password}
                        onChange={(e) => setF({ ...f, password: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  )}
                  <button
                    disabled={busy}
                    className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground shadow-glow disabled:opacity-60"
                  >
                    {busy
                      ? "Please wait…"
                      : mode === "in"
                        ? "Sign in"
                        : mode === "up"
                          ? "Create account"
                          : "Send reset link"}
                  </button>
                </form>
              )}
              {mode === "in" && (
                <button
                  className="mt-3 w-full text-sm font-semibold text-primary"
                  onClick={() => setMode("forgot")}
                >
                  Forgot password?
                </button>
              )}
              {mode === "in" && (
                <button
                  onClick={google}
                  className="mt-3 w-full rounded-xl border border-border py-3 font-semibold"
                >
                  Continue with Google
                </button>
              )}
              {(mode === "in" || mode === "up" || mode === "forgot") && (
                <p className="mt-5 text-center text-sm text-muted-foreground">
                  {mode === "forgot"
                    ? "Remembered it? "
                    : mode === "in"
                      ? "New here? "
                      : "Have an account? "}
                  <button
                    className="font-bold text-primary"
                    onClick={() => setMode(mode === "up" ? "in" : mode === "forgot" ? "in" : "up")}
                  >
                    {mode === "up"
                      ? "Sign in"
                      : mode === "forgot"
                        ? "Sign in"
                        : "Create an account"}
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
