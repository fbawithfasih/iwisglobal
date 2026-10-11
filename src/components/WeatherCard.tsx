import { useEffect, useState } from 'react';
import { fmt } from '../i18n/fmt';
import { intlLocale, type Locale } from '../lib/i18n';

// English keeps the Indian-English style it always had ("04:46 pm").
const weatherTag = (locale: Locale) => (locale === 'en' ? 'en-IN' : intlLocale(locale));
import type { Dictionary } from '../i18n/dictionaries';

// Agra, Uttar Pradesh, India — this widget is single-city by design, not a
// search box, so the coordinates are fixed rather than user-supplied.
const AGRA_LAT = 27.1767;
const AGRA_LON = 78.0081;

// v2: bumped when the cached shape changed (added `forecast`) so a
// returning visitor's stale v1 cache entry is ignored instead of crashing
// render on the missing field.
const CACHE_KEY = 'iwis-agra-weather-v2';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ForecastDay {
  date: string;
  maxC: number;
  minC: number;
  weatherCode: number;
}

interface WeatherData {
  temperatureC: number;
  humidityPct: number;
  weatherCode: number;
  windSpeedKmh: number;
  precipitationMm: number;
  rainChancePct: number | null;
  aqi: number | null;
  pm25: number | null;
  forecast: ForecastDay[];
  fetchedAt: number;
}

// WMO weather_code → text key + emoji. Not exhaustive of every WMO code,
// but covers the ranges Open-Meteo's `current.weather_code` actually returns.
type CodeKey = keyof Dictionary['weather']['codes'];

function describeWeatherCode(code: number): { key: CodeKey; icon: string } {
  if (code === 0) return { key: 'clear', icon: '☀️' };
  if (code <= 2) return { key: 'partly', icon: '🌤️' };
  if (code === 3) return { key: 'overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { key: 'fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { key: 'drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { key: 'rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { key: 'snow', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { key: 'showers', icon: '🌧️' };
  if (code >= 95) return { key: 'thunder', icon: '⛈️' };
  return { key: 'other', icon: '🌡️' };
}

// US AQI bands (EPA scale, 0–500).
function describeAqi(aqi: number): { key: keyof Dictionary['weather']['aqiBands']; className: string } {
  if (aqi <= 50) return { key: 'good', className: 'bg-green-100 text-green-800' };
  if (aqi <= 100) return { key: 'moderate', className: 'bg-yellow-100 text-yellow-800' };
  if (aqi <= 150) return { key: 'sensitive', className: 'bg-orange-100 text-orange-800' };
  if (aqi <= 200) return { key: 'unhealthy', className: 'bg-red-100 text-red-800' };
  if (aqi <= 300) return { key: 'veryUnhealthy', className: 'bg-purple-100 text-purple-800' };
  return { key: 'hazardous', className: 'bg-rose-200 text-rose-900' };
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
    `&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,weather_code` +
    `&forecast_days=4&timezone=Asia%2FKolkata`;
  const aqiUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${AGRA_LAT}&longitude=${AGRA_LON}` +
    `&current=us_aqi,pm2_5&timezone=Asia%2FKolkata`;

  const [weatherRes, aqiRes] = await Promise.all([fetch(weatherUrl), fetch(aqiUrl)]);
  if (!weatherRes.ok) throw new Error(`weather fetch failed: ${weatherRes.status}`);

  const weatherJson = await weatherRes.json();
  // AQI is a separate service; degrade gracefully (aqi: null) rather than
  // failing the whole card if only this call fails.
  const aqiJson = aqiRes.ok ? await aqiRes.json() : null;

  // daily.time[0] is today (already shown as "right now" above), so the
  // 3-day forecast row is indices 1-3.
  const dailyTimes: string[] = weatherJson.daily?.time ?? [];
  const forecast: ForecastDay[] = dailyTimes.slice(1, 4).map((date, i) => ({
    date,
    maxC: weatherJson.daily.temperature_2m_max[i + 1],
    minC: weatherJson.daily.temperature_2m_min[i + 1],
    weatherCode: weatherJson.daily.weather_code[i + 1],
  }));

  return {
    temperatureC: weatherJson.current.temperature_2m,
    humidityPct: weatherJson.current.relative_humidity_2m,
    weatherCode: weatherJson.current.weather_code,
    windSpeedKmh: weatherJson.current.wind_speed_10m,
    precipitationMm: weatherJson.current.precipitation,
    rainChancePct: weatherJson.daily?.precipitation_probability_max?.[0] ?? null,
    aqi: aqiJson?.current?.us_aqi ?? null,
    pm25: aqiJson?.current?.pm2_5 ?? null,
    forecast,
    fetchedAt: Date.now(),
  };
}

export default function WeatherCard({ t, locale, variant = 'full' }: { t: Dictionary['weather']; locale: Locale; variant?: 'full' | 'inline' }) {
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

  if (variant === 'inline') {
    if (status === 'loading' || !data) {
      return <span className="inline-flex items-center gap-1.5 text-sm text-stone-400 animate-pulse" aria-hidden="true">{t.loading}</span>;
    }
    const inlineInfo = describeWeatherCode(data.weatherCode);
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-stone-600">
        <span aria-hidden="true">{inlineInfo.icon}</span>
        {Math.round(data.temperatureC)}°C, {t.codes[inlineInfo.key]}
      </span>
    );
  }

  if (status === 'loading' || !data) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-600 p-6 shadow-lg shadow-brand-900/25 animate-pulse" aria-hidden="true">
        <div className="h-3 w-28 bg-white/20 rounded mb-3"></div>
        <div className="h-7 w-16 bg-white/20 rounded mb-2"></div>
        <div className="h-3 w-40 bg-white/20 rounded"></div>
      </div>
    );
  }

  const { key: codeKey, icon } = describeWeatherCode(data.weatherCode);
  const label = t.codes[codeKey];
  const aqiInfo = data.aqi !== null ? describeAqi(data.aqi) : null;
  const rainNote =
    data.precipitationMm > 0
      ? fmt(t.rainNow, { n: data.precipitationMm })
      : data.rainChancePct !== null
        ? fmt(t.rainChance, { n: data.rainChancePct })
        : null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-600 p-6 text-white shadow-lg shadow-brand-900/25 [@media(max-height:500px)]:p-3">
      {/* Soft decorative circles; purely visual. */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10"></span>
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-16 left-10 h-32 w-32 rounded-full bg-amber-300/10"></span>

      <div className="relative">
        <div className="flex items-center gap-2 mb-4 [@media(max-height:500px)]:mb-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
          </span>
          <h3 className="text-xs font-semibold tracking-widest text-amber-200 uppercase">{t.title}</h3>
        </div>

        <div className="flex items-center gap-4 mb-5 [@media(max-height:500px)]:mb-2 [@media(max-height:500px)]:gap-3">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/15 text-4xl [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:w-11 [@media(max-height:500px)]:text-2xl leading-none ring-2 ring-white/20" aria-hidden="true">{icon}</span>
          <div>
            <p className="text-4xl font-serif font-semibold leading-none [@media(max-height:500px)]:text-3xl">{Math.round(data.temperatureC)}°C</p>
            <p className="text-sm text-brand-100 mt-1.5">{label}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-brand-50 mb-4 [@media(max-height:500px)]:mb-2 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:[&_p]:py-1">
          <p className="rounded-lg bg-white/10 px-3 py-2">{fmt(t.humidity, { n: Math.round(data.humidityPct) })}</p>
          <p className="rounded-lg bg-white/10 px-3 py-2">{fmt(t.wind, { n: Math.round(data.windSpeedKmh) })}</p>
          {rainNote && <p className="col-span-2 rounded-lg bg-white/10 px-3 py-2">{rainNote}</p>}
        </div>

        {aqiInfo && (
          <div className="flex flex-wrap items-center gap-2 mb-4 [@media(max-height:500px)]:mb-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${aqiInfo.className}`}>
              {fmt(t.aqi, { n: data.aqi ?? '', label: t.aqiBands[aqiInfo.key] })}
            </span>
            {data.pm25 !== null && <span className="text-xs text-brand-100">{fmt(t.pm25, { n: data.pm25 })}</span>}
          </div>
        )}

        {data.forecast.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/15 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:pt-2">
            {data.forecast.map((day) => {
              const dayInfo = describeWeatherCode(day.weatherCode);
              return (
                <div key={day.date} className="text-center rounded-lg bg-white/10 py-2 [@media(max-height:500px)]:py-1">
                  <p className="text-xs font-medium text-brand-100">
                    {new Date(day.date).toLocaleDateString(weatherTag(locale), { weekday: 'short' })}
                  </p>
                  <p className="text-lg leading-none my-1" aria-hidden="true">{dayInfo.icon}</p>
                  <p className="text-xs font-semibold text-white">
                    {Math.round(day.maxC)}° <span className="font-normal text-brand-200">{Math.round(day.minC)}°</span>
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-brand-200 mt-4 [@media(max-height:500px)]:mt-2">
          {fmt(t.updated, { time: new Date(data.fetchedAt).toLocaleTimeString(weatherTag(locale), { hour: '2-digit', minute: '2-digit' }) })}
        </p>
      </div>
    </div>
  );
}
