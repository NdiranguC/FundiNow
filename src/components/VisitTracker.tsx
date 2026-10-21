import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

function visitorId() {
  try {
    const storedId = localStorage.getItem("visitor_id");
    if (storedId) return storedId;

    const id = crypto.randomUUID();
    localStorage.setItem("visitor_id", id);
    return id;
  } catch (error) {
    console.error("Could not persist analytics visitor ID", error);
    return crypto.randomUUID();
  }
}

export function VisitTracker() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const run = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const ua = navigator.userAgent;
      const device = /Mobi|Android|iPhone/i.test(ua)
        ? "mobile"
        : /iPad|Tablet/i.test(ua)
          ? "tablet"
          : "desktop";
      let ref: string | null = null;
      try {
        ref = document.referrer ? new URL(document.referrer).hostname : null;
      } catch (error) {
        console.error("Could not parse analytics referrer", error);
      }
      if (ref === location.hostname) ref = null;
      const { error } = await supabase.from("page_views").insert({
        visitor_id: visitorId(),
        user_id: data.session?.user.id ?? null,
        path: path.slice(0, 300),
        referrer: ref?.slice(0, 500) ?? null,
        device,
      });
      if (error) throw error;
    };
    run().catch((error: unknown) => console.error("Could not record page view", error));
  }, [path]);
  return null;
}
