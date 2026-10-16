/**
 * A MOCK PAID WEATHER API
 *
 * Pretend this is someone else's API that charges per request.
 * No payment → 402 Payment Required. Valid signed payment → real weather data.
 *
 * Weather data: Open-Meteo (https://open-meteo.com) — free, no API key needed.
 */
import { verifyPayment } from "@/agent/wallet";

const PRICE = "0.01";
const ASSET = "USDC";
const PAY_TO = "0x000000000000000000000000000000000000dEaD"; // the API owner's wallet (demo)

/** WMO weather interpretation codes → readable conditions. */
const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

type GeoResult = {
  name: string;
  country?: string;
  admin1?: string; // state/province
  latitude: number;
  longitude: number;
};

/** Look up a place name → coordinates, so we can ask Open-Meteo for that spot. */
async function geocode(city: string): Promise<GeoResult | null> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({ name: city, count: "1", language: "en", format: "json" });
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: GeoResult[] };
  return json.results?.[0] ?? null;
}

/** Fetch the current weather for a latitude/longitude from Open-Meteo. */
async function fetchWeather(lat: number, lon: number) {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
      timezone: "auto",
    });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const json = (await res.json()) as {
    current?: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
    };
  };
  const cur = json.current;
  if (!cur) throw new Error("Weather service returned no current weather");
  return {
    temperatureC: Math.round(cur.temperature_2m),
    feelsLikeC: Math.round(cur.apparent_temperature),
    condition: WEATHER_CODES[cur.weather_code] ?? `Unknown (code ${cur.weather_code})`,
    humidityPercent: cur.relative_humidity_2m,
    windKmh: Math.round(cur.wind_speed_10m),
    observedAt: cur.time,
  };
}

export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city")?.trim();

  const payment = await verifyPayment(req.headers.get("X-PAYMENT"));
  if (!payment || payment.to !== PAY_TO || Number(payment.amount) < Number(PRICE)) {
    return Response.json({ error: "Payment Required", price: PRICE, asset: ASSET, payTo: PAY_TO }, { status: 402 });
  }

  if (!city) {
    return Response.json({ error: "Missing ?city= parameter" }, { status: 400 });
  }

  const place = await geocode(city);
  if (!place) {
    return Response.json({ error: `Could not find a place called "${city}"` }, { status: 404 });
  }

  const weather = await fetchWeather(place.latitude, place.longitude);
  return Response.json({
    city: place.name,
    region: place.admin1 ?? null,
    country: place.country ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
    ...weather,
    paidBy: payment.from,
  });
}
