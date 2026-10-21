import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { placesAutocomplete, placeDetails } from "@/lib/places.functions";

export function LocationSearch({ value, onChange, onPick, placeholder = "Search a location" }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (p: { address: string; lat: number; lng: number }) => void;
  placeholder?: string;
}) {
  const autocomplete = useServerFn(placesAutocomplete);
  const details = useServerFn(placeDetails);
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const tokenRef = useRef(crypto.randomUUID());
  const seqRef = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); setMessage(""); return; }
    const t = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const res = await autocomplete({ data: { input: q, sessionToken: tokenRef.current } });
        if (seq === seqRef.current) {
          setSuggestions(res);
          setOpen(true);
          setMessage(res.length ? "" : "No matching locations found.");
        }
      } catch (error) {
        if (seq === seqRef.current) {
          setSuggestions([]);
          setMessage(error instanceof Error ? error.message : "Location search is unavailable.");
        }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value, autocomplete]);

  async function pick(placeId: string, text: string) {
    setOpen(false);
    setSuggestions([]);
    setMessage("");
    onChange(text);
    try {
      const p = await details({ data: { placeId, sessionToken: tokenRef.current } });
      tokenRef.current = crypto.randomUUID(); // retire session token
      onPick(p);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load that location.");
    }
  }

  return (
    <div className="relative flex-1">
      <label className="flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-3 focus-within:border-primary">
        <MapPin className="h-5 w-5 shrink-0 text-primary" />
        <input
          value={value}
          onChange={(e) => { setMessage(""); onChange(e.target.value); }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="w-full bg-transparent outline-none"
          aria-label="Search location"
          autoComplete="off"
        />
      </label>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s.placeId, s.text)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /> {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status" className="mt-1 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
