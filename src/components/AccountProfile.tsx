import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Cropper from "react-easy-crop";
import { Camera, Trash2, UserRound, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Area = { x: number; y: number; width: number; height: number };

async function cropToSquare(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Crop failed"))), "image/webp", 0.9));
}

export function AccountProfile({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  const { data: profile, isPending, error } = useQuery({
    queryKey: ["account-profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: photo } = useQuery({
    queryKey: ["account-photo", profile?.avatar_path],
    enabled: !!profile?.avatar_path,
    queryFn: async () => {
      if (!profile?.avatar_path) return null;
      const { data, error } = await supabase.storage.from("profile-photos").createSignedUrl(profile.avatar_path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  useEffect(() => { setName(profile?.full_name ?? ""); setPhone(profile?.phone ?? ""); }, [profile]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  function pickFile(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error("Choose a JPG, PNG or WebP photo under 5 MB");
      return;
    }
    setCropSrc(URL.createObjectURL(file));
  }

  async function saveCrop() {
    if (!cropSrc || !area) return;
    setBusy(true);
    try {
      const blob = await cropToSquare(cropSrc, area);
      const path = `${userId}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage.from("profile-photos").upload(path, blob, { contentType: "image/webp" });
      if (error) throw error;
      const { error: saveError } = await supabase.from("profiles").upsert({ id: userId, avatar_path: path });
      if (saveError) {
        const { error: cleanupError } = await supabase.storage.from("profile-photos").remove([path]);
        if (cleanupError) toast.error(`Uploaded photo could not be cleaned up: ${cleanupError.message}`);
        throw saveError;
      }
      if (profile?.avatar_path) {
        const { error: removeError } = await supabase.storage.from("profile-photos").remove([profile.avatar_path]);
        if (removeError) toast.error(`New photo saved, but the previous file could not be removed: ${removeError.message}`);
      }
      await qc.invalidateQueries({ queryKey: ["account-profile", userId] });
      toast.success("Profile photo updated");
      setCropSrc(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    if (!profile?.avatar_path) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", userId);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    const { error: removeError } = await supabase.storage.from("profile-photos").remove([profile.avatar_path]);
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ["account-profile", userId] });
    if (removeError) toast.error(`Profile photo removed, but the stored file could not be deleted: ${removeError.message}`);
    else toast.success("Profile photo removed");
  }

  return (
    <section className="border-b border-border pb-6">
      <h1 className="mb-5 text-3xl font-extrabold">My profile</h1>
      {error && <p className="text-destructive">Your profile could not be loaded.</p>}
      <form
        className="flex flex-col gap-5 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error } = await supabase.from("profiles").upsert({ id: userId, full_name: name.trim(), phone: phone.trim() || null });
          setBusy(false);
          if (error) toast.error(error.message);
          else {
            await qc.invalidateQueries({ queryKey: ["account-profile", userId] });
            toast.success("Profile saved");
          }
        }}
      >
        <div className="flex items-center gap-3">
          <label className="relative grid h-24 w-24 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-muted">
            {photo ? <img src={photo} alt="Profile picture" className="h-full w-full object-cover" /> : <UserRound className="h-10 w-10 text-muted-foreground" />}
            <span className="absolute bottom-0 right-0 rounded-full bg-primary p-2 text-primary-foreground"><Camera className="h-4 w-4" /></span>
            <input aria-label="Profile picture" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy || isPending} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {profile?.avatar_path && (
            <button type="button" onClick={removePhoto} disabled={busy} aria-label="Remove profile photo" className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex-1 space-y-2 text-sm font-semibold">Name<input aria-label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2.5" /></label>
        <label className="flex-1 space-y-2 text-sm font-semibold">Phone number<input aria-label="Phone number" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2.5" /></label>
        <Button disabled={busy || isPending} type="submit" className="h-11"><Save />{busy ? "Saving…" : "Save profile"}</Button>
      </form>

      {cropSrc && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Crop profile photo">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-soft">
            <h2 className="text-lg font-extrabold">Adjust your photo</h2>
            <p className="text-xs text-muted-foreground">Drag to move, pinch or slide to zoom — it will fit the circle.</p>
            <div className="relative mt-4 h-72 overflow-hidden rounded-2xl bg-muted">
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="mt-4 w-full accent-primary" />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setCropSrc(null)} className="flex-1 rounded-xl border border-border py-2.5 font-semibold">Cancel</button>
              <button type="button" onClick={saveCrop} disabled={busy} className="flex-1 rounded-xl bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save photo"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
