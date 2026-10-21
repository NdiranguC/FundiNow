import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLACES_API = "https://places.googleapis.com/v1";
const GEOCODING_API = "https://maps.googleapis.com/maps/api/geocode/json";

function apiKey() {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!key) throw new Error("Google Maps server API key is not configured");
  return key;
}

async function checkResponse(response: Response, operation: string) {
  if (response.ok) return;
  console.error(`${operation} failed [${response.status}]`);
  throw new Error(`${operation} is unavailable right now`);
}

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }[];
};

export const placesAutocomplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { input: string; sessionToken: string }) => {
    const query = input.input.trim();
    if (!query || query.length > 200 || !input.sessionToken || input.sessionToken.length > 200) {
      throw new Error("Invalid location search");
    }
    return { input: query, sessionToken: input.sessionToken };
  })
  .handler(async ({ data }) => {
    const response = await fetch(`${PLACES_API}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({
        input: data.input,
        sessionToken: data.sessionToken,
        includedRegionCodes: ["ke"],
        locationBias: { circle: { center: { latitude: -1.2921, longitude: 36.8219 }, radius: 500000 } },
      }),
    });
    await checkResponse(response, "Location search");
    const result = (await response.json()) as AutocompleteResponse;
    return (result.suggestions ?? [])
      .map((suggestion) => ({
        placeId: suggestion.placePrediction?.placeId,
        text: suggestion.placePrediction?.text?.text,
      }))
      .filter((item): item is { placeId: string; text: string } => !!item.placeId && !!item.text);
  });

type PlaceDetailsResponse = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

export const placeDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { placeId: string; sessionToken: string }) => {
    if (!input.placeId || input.placeId.length > 300 || !input.sessionToken || input.sessionToken.length > 200) {
      throw new Error("Invalid place");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const params = new URLSearchParams({ sessionToken: data.sessionToken });
    const response = await fetch(`${PLACES_API}/places/${encodeURIComponent(data.placeId)}?${params}`, {
      headers: {
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
    });
    await checkResponse(response, "Place details");
    const place = (await response.json()) as PlaceDetailsResponse;
    const { latitude, longitude } = place.location ?? {};
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new Error("The selected place did not include map coordinates");
    }
    return {
      address: place.formattedAddress ?? place.displayName?.text ?? "",
      lat: latitude,
      lng: longitude,
    };
  });

type GeocodeResponse = {
  status?: string;
  results?: { formatted_address?: string }[];
};

export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lat: number; lng: number }) => {
    if (
      typeof input.lat !== "number" ||
      typeof input.lng !== "number" ||
      !Number.isFinite(input.lat) ||
      !Number.isFinite(input.lng) ||
      Math.abs(input.lat) > 90 ||
      Math.abs(input.lng) > 180
    ) {
      throw new Error("Invalid coordinates");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      latlng: `${data.lat},${data.lng}`,
      key: apiKey(),
    });
    const response = await fetch(`${GEOCODING_API}?${params}`);
    await checkResponse(response, "Reverse geocoding");
    const result = (await response.json()) as GeocodeResponse;
    const address = result.results?.[0]?.formatted_address;
    if (result.status !== "OK" || !address) {
      throw new Error(`Reverse geocoding failed: ${result.status ?? "no result"}`);
    }
    return { address };
  });
