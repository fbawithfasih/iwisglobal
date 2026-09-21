import { useEffect, useState } from 'react';

// Agra, Uttar Pradesh, India — this widget is single-city by design, not a
// search box, so the coordinates are fixed rather than user-supplied.
const AGRA_LAT = 27.1767;
const AGRA_LON = 78.0081;

const CACHE_KEY = 'iwis-agra-weather';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface WeatherData {
  temperatureC: number;
  humidityPct: number;
  weatherCode: number;
  windSpeedKmh: number;
  precipitationMm: number;
  rainChancePct: number | null;
  aqi: number | null;
  pm25: number | null;
  fetchedAt: number;
}

// WMO weather_code → short label + emoji. Not exhaustive of every WMO code,
// but covers the ranges Open-Meteo's `current.weather_code` actually returns.
function describeWeatherCode(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear sky', icon: '☀️' };
  if (code <= 2) return { label: 'Partly cloudy', icon: '🌤️' };
  if (code === 3) return { label: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', icon: '🌧️' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⛈️' };
  return { label: 'Weather', icon: '🌡️' };
}

// US AQI bands (EPA scale, 0–500).
function describeAqi(aqi: number): { label: string; className: string } {
  if (aqi <= 50) return { label: 'Good', className: 'bg-green-100 text-green-800' };
  if (aqi <= 100) return { label: 'Moderate', className: 'bg-yellow-100 text-yellow-800' };
  if (aqi <= 150) return { label: 'Unhealthy (sensitive)', className: 'bg-orange-100 text-orange-800' };
  if (aqi <= 200) return { label: 'Unhealthy', className: 'bg-red-100 text-red-800' };
  if (aqi <= 300) return { label: 'Very unhealthy', className: 'bg-purple-100 text-purple-800' };
  return { label: 'Hazardous', className: 'bg-rose-200 text-rose-900' };
}

function readCache(): WeatherData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherData;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: WeatherData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage blocked (private mode, quota, etc.) — fine, just won't cache.
  }
}

async function fetchWeather(): Promise<WeatherData> {
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${AGRA_LAT}&longitude=${AGRA_LON}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
    `&daily=precipitation_probability_max&timezone=Asia%2FKolkata`;
  const aqiUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${AGRA_LAT}&longitude=${AGRA_LON}` +
    `&current=us_aqi,pm2_5&timezone=Asia%2FKolkata`;

  const [weatherRes, aqiRes] = await Promise.all([fetch(weatherUrl), fetch(aqiUrl)]);
  if (!weatherRes.ok) throw new Error(`weather fetch failed: ${weatherRes.status}`);

  const weatherJson = await weatherRes.json();
  // AQI is a separate service; degrade gracefully (aqi: null) rather than
  // failing the whole card if only this call fails.
  const aqiJson = aqiRes.ok ? await aqiRes.json() : null;

  return {
    temperatureC: weatherJson.current.temperature_2m,
    humidityPct: weatherJson.current.relative_humidity_2m,
    weatherCode: weatherJson.current.weather_code,
    windSpeedKmh: weatherJson.current.wind_speed_10m,
    precipitationMm: weatherJson.current.precipitation,
    rainChancePct: weatherJson.daily?.precipitation_probability_max?.[0] ?? null,
    aqi: aqiJson?.current?.us_aqi ?? null,
    pm25: aqiJson?.current?.pm2_5 ?? null,
    fetchedAt: Date.now(),
  };
}

export default function WeatherCard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setData(cached);
      setStatus('ready');
      return;
    }
    fetchWeather()
      .then((result) => {
        writeCache(result);
        setData(result);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  // Never invent numbers: if the live fetch fails, show nothing rather than
  // a broken card or stale placeholder.
  if (status === 'error') return null;

  if (status === 'loading' || !data) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-6 animate-pulse" aria-hidden="true">
        <div className="h-4 w-32 bg-stone-200 rounded mb-4"></div>
        <div className="h-9 w-20 bg-stone-200 rounded mb-3"></div>
        <div className="h-3 w-48 bg-stone-200 rounded"></div>
      </div>
    );
  }

  const { label, icon } = describeWeatherCode(data.weatherCode);
  const aqiInfo = data.aqi !== null ? describeAqi(data.aqi) : null;
  const rainNote =
    data.precipitationMm > 0
      ? `Raining now (${data.precipitationMm} mm)`
      : data.rainChancePct !== null
        ? `${data.rainChancePct}% chance of rain today`
        : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
        <h3 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Agra right now</h3>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <span className="text-4xl leading-none" aria-hidden="true">{icon}</span>
        <div>
          <p className="text-3xl font-serif font-semibold leading-none">{Math.round(data.temperatureC)}°C</p>
          <p className="text-sm text-stone-600 mt-1">{label}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm text-stone-600 mb-4">
        <p>Humidity: {Math.round(data.humidityPct)}%</p>
        <p>Wind: {Math.round(data.windSpeedKmh)} km/h</p>
        {rainNote && <p className="col-span-2">{rainNote}</p>}
      </div>

      {aqiInfo && (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${aqiInfo.className}`}>
            AQI {data.aqi} · {aqiInfo.label}
          </span>
          {data.pm25 !== null && <span className="text-xs text-stone-500">PM2.5: {data.pm25} µg/m³</span>}
        </div>
      )}

      <p className="text-xs text-stone-400 mt-4">
        Updated {new Date(data.fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ·
        Source: Open-Meteo
      </p>
    </div>
  );
}
