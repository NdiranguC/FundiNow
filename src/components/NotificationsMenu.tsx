import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function NotificationsMenu({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: notifications = [], error } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => void queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  const unread = notifications.filter((notification) => !notification.is_read).length;
  const markRead = async (id: string) => {
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    if (error) {
      toast.error("This notification could not be marked as read.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-bold">Notifications</h2>
            {unread > 0 && <span className="text-xs text-muted-foreground">{unread} unread</span>}
          </div>
          <div className="max-h-[min(65vh,28rem)] overflow-y-auto">
            {error ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                Notifications could not be loaded.
              </p>
            ) : notifications.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">You’re all caught up.</p>
            ) : (
              notifications.map((notification) => {
                const content = (
                  <>
                    <p className="text-sm font-bold">{notification.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {new Date(notification.created_at).toLocaleString()}
                    </p>
                  </>
                );
                const className = `block border-b border-border p-4 last:border-0 hover:bg-muted ${notification.is_read ? "" : "bg-accent/30"}`;
                const onClick = () => {
                  setOpen(false);
                  if (!notification.is_read) void markRead(notification.id);
                };
                return notification.job_id ? (
                  <Link
                    key={notification.id}
                    to="/jobs/$id"
                    params={{ id: notification.job_id }}
                    onClick={onClick}
                    className={className}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={onClick}
                    className={`${className} w-full text-left`}
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
