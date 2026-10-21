import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    __fundiMapReady?: () => void;
    google?: any;
  }
}

let loaderPromise: Promise<void> | null = null;

function loadMaps(): Promise<void> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    const key = import.meta.env["VITE_GOOGLE_MAPS_API_KEY"];
    if (!key) return reject(new Error("Google Maps browser key is not configured"));
    window.__fundiMapReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__fundiMapReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
}

export function GoogleMap({ markers, center, zoom = 14, className = "h-64", onPick, draggable = false }: { markers: MapMarker[]; center?: { lat: number; lng: number } | undefined; zoom?: number; className?: string; onPick?: (lat: number, lng: number) => void; draggable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMaps()
      .then(() => {
        if (cancelled || !ref.current || mapRef.current) return;
        const first = center ?? markers[0] ?? { lat: -1.2921, lng: 36.8219 }; // Nairobi default
        mapRef.current = new window.google.maps.Map(ref.current, {
          center: { lat: first.lat, lng: first.lng },
          zoom,
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
        });
        if (onPickRef.current) {
          mapRef.current.addListener("click", (e: any) => {
            if (e?.latLng) onPickRef.current?.(e.latLng.lat(), e.latLng.lng());
          });
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Map failed to load"));
    return () => { cancelled = true; };
  }, []);

  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setInterval(() => { if (mapRef.current) { setReady(true); clearInterval(id); } }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google.maps;
    // Reuse markers so live positions glide instead of flickering
    while (markerRefs.current.length > markers.length) markerRefs.current.pop().setMap(null);
    markers.forEach((mk, i) => {
      const color = mk.color ?? "#22c55e";
      const icon = {
        path: "M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0zm0 17a5 5 0 110-10 5 5 0 010 10z",
        fillColor: color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2,
        scale: 1.2, anchor: new g.Point(12, 36),
      };
      const target = { lat: mk.lat, lng: mk.lng };
      let m = markerRefs.current[i];
      if (!m) {
        m = new g.Marker({ map, position: target, title: mk.label, icon, draggable: draggable && markers.length === 1 });
        if (draggable && markers.length === 1) {
          m.addListener("dragend", () => { const p = m.getPosition(); if (p) onPickRef.current?.(p.lat(), p.lng()); });
        }
        markerRefs.current[i] = m;
        return;
      }
      m.setIcon(icon); m.setTitle(mk.label ?? "");
      const from = m.getPosition();
      const start = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / 800);
        m.setPosition({ lat: from.lat() + (target.lat - from.lat()) * k, lng: from.lng() + (target.lng - from.lng()) * k });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (markers.length > 1) {
      const b = new g.LatLngBounds();
      markers.forEach((mk) => b.extend({ lat: mk.lat, lng: mk.lng }));
      map.fitBounds(b, 60);
    } else {
      const target = center ?? markers[0];
      if (target) map.panTo({ lat: target.lat, lng: target.lng });
    }
  }, [markers, center, ready]);

  if (error) return <div className={`grid ${className} w-full place-items-center rounded-2xl border border-border bg-muted text-sm text-muted-foreground`}>{error}</div>;
  return <div ref={ref} className={`${className} w-full rounded-2xl border border-border`} role="application" aria-label="Live map" />;
}
