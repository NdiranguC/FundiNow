import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { countMatchingNameTokens, extractNameCandidate } from "@/lib/identity-verification";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MIN_OCR_CONFIDENCE = 0.75;
const STORAGE_BUCKET = "artisan-docs";

type VisionResponse = {
  responses?: {
    fullTextAnnotation?: {
      text?: string;
      pages?: {
        blocks?: {
          paragraphs?: {
            words?: { confidence?: number }[];
          }[];
        }[];
      }[];
    };
    error?: { message?: string };
  }[];
};

type VerificationStatus = "verified" | "pending_review";

function json(body: object, status: number): Response {
  return Response.json(body, { status });
}

function getSupabaseConfig() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key || !serviceKey) {
    console.error("Fundi ID verification requires Supabase server credentials");
    return null;
  }
  return { url, key, serviceKey };
}

function imageType(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

async function extractIdText(bytes: Uint8Array) {
  const apiKey = process.env["GOOGLE_CLOUD_VISION_API_KEY"];
  if (!apiKey) {
    throw new Error("Google Cloud Vision is not configured");
  }
  const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      requests: [
        {
          image: { content: Buffer.from(bytes).toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["en"] },
        },
      ],
    }),
  });
  if (!response.ok) {
    console.error(`Google Cloud Vision request failed [${response.status}]`);
    throw new Error("OCR service unavailable");
  }
  const result = (await response.json()) as VisionResponse;
  const annotation = result.responses?.[0]?.fullTextAnnotation;
  const text = annotation?.text?.trim() ?? "";
  if (result.responses?.[0]?.error) {
    throw new Error("OCR could not read the submitted image");
  }
  const confidences =
    annotation?.pages?.flatMap(
      (page) =>
        page.blocks?.flatMap(
          (block) =>
            block.paragraphs?.flatMap(
              (paragraph) =>
                paragraph.words?.flatMap((word) =>
                  typeof word.confidence === "number" ? [word.confidence] : [],
                ) ?? [],
            ) ?? [],
        ) ?? [],
    ) ?? [];
  const confidence =
    confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;
  return { text, confidence };
}

function responseStatus(confidence: number, matchingTokens: number): VerificationStatus {
  return confidence >= MIN_OCR_CONFIDENCE && matchingTokens >= 2 ? "verified" : "pending_review";
}

export const Route = createFileRoute("/api/verify-fundi-id")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getSupabaseConfig();
        if (!config) return json({ error: "ID verification is not configured" }, 503);

        const authorization = request.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) {
          return json({ error: "Authentication required" }, 401);
        }
        const token = authorization.slice("Bearer ".length);
        if (!token || token.split(".").length !== 3) {
          return json({ error: "Authentication required" }, 401);
        }

        const authClient = createClient<Database>(config.url, config.key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await authClient.auth.getUser(token);
        if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

        const supabase = createClient<Database>(config.url, config.serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const userId = authData.user.id;
        const [
          { data: artisan, error: artisanError },
          { data: profile, error: profileError },
          { data: role, error: roleError },
        ] = await Promise.all([
          supabase
            .from("artisans")
            .select("user_id, id_doc_path")
            .eq("user_id", userId)
            .maybeSingle(),
          supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "artisan")
            .maybeSingle(),
        ]);
        if (artisanError || profileError || roleError) {
          console.error(
            "Could not load fundi verification profile",
            artisanError ?? profileError ?? roleError,
          );
          return json({ error: "Could not load your verification profile" }, 500);
        }
        if (!artisan || !role || !profile)
          return json({ error: "Only registered fundis can verify an ID" }, 403);
        if (!profile.full_name.trim()) {
          return json(
            { error: "Add your full name to your profile before verifying your ID" },
            400,
          );
        }

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_IMAGE_SIZE + 64 * 1024) {
          return json({ error: "Image must be 5 MB or smaller" }, 413);
        }

        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return json({ error: "A multipart image upload is required" }, 400);
        }
        const file = formData.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return json({ error: "Choose an ID image to upload" }, 400);
        }
        if (file.size > MAX_IMAGE_SIZE)
          return json({ error: "Image must be 5 MB or smaller" }, 413);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const detectedType = imageType(bytes);
        if (!detectedType) {
          return json({ error: "Upload a valid JPEG, PNG, or WebP image" }, 415);
        }

        const path = `${userId}/id-verification-${crypto.randomUUID()}.${detectedType.extension}`;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, bytes, { contentType: detectedType.mimeType, upsert: false });
        if (uploadError) {
          console.error("Could not save fundi ID image", uploadError);
          return json({ error: "Your ID image could not be saved" }, 500);
        }

        let status: VerificationStatus = "pending_review";
        let reason = "ocr_unavailable";
        let matchingTokens = 0;
        try {
          const { text, confidence } = await extractIdText(bytes);
          const extractedName = extractNameCandidate(text, profile.full_name);
          matchingTokens = countMatchingNameTokens(profile.full_name, extractedName);
          status = responseStatus(confidence, matchingTokens);
          reason =
            confidence < MIN_OCR_CONFIDENCE
              ? "low_ocr_confidence"
              : matchingTokens < 2
                ? "name_mismatch"
                : "";
        } catch (error) {
          console.error("Fundi ID OCR could not be completed", error);
          reason = "ocr_unavailable";
        }

        const submittedAt = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("artisans")
          .update({
            id_doc_path: path,
            verification_status: status,
            verification_submitted_at: submittedAt,
            verification_review_reason: reason || null,
            verified: status === "verified",
            verified_at: status === "verified" ? submittedAt : null,
          })
          .eq("user_id", userId);
        if (updateError) {
          console.error("Could not save fundi verification result", updateError);
          const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
          if (removeError) console.error("Could not remove unlinked fundi ID image", removeError);
          return json({ error: "Your verification result could not be saved" }, 500);
        }
        if (artisan.id_doc_path) {
          const { error: removeError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([artisan.id_doc_path]);
          if (removeError) console.error("Could not remove superseded fundi ID image", removeError);
        }

        return json(
          {
            status,
            matchingTokens,
            message:
              status === "verified"
                ? "Your identity has been verified."
                : "Your ID was received and has been flagged for manual review.",
          },
          200,
        );
      },
    },
  },
});
