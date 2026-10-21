export function StatusPill({ s }: { s: string }) {
  const done = s === "completed";
  const off = s === "cancelled";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${done ? "bg-accent text-accent-foreground" : off ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
      {s.replace("_", " ")}
    </span>
  );
}
