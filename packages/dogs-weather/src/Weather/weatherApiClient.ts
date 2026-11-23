/**
 * =========================================================================
 *  WEATHER API CLIENT — reading the sky-void through Open-Meteo
 * =========================================================================
 *
 *  Arr, this module speaks the tongue of the Open-Meteo oracle —
 *  a free, keyless gateway to atmospheric data across the globe.
 *  No API key required — the sky grants passage freely, matey.
 *
 *  Endpoint: https://api.open-meteo.com/v1/forecast, via the shared
 *  Open-Meteo cell store (slopdogs-openmeteo).
 * =========================================================================
 */

import { GEO_CACHE_TTL_WEATHER_MS, type ICacheHandler } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_FORECAST_DAYS,
    OPEN_METEO_FORECAST_URL,
    fetchCellVariables,
    sliceDays,
    withStale,
} from '@martinschmieschek/slopdogs-openmeteo';
import type { CurrentWeather, HourlyForecast, WeatherResult } from './interfaces/weatherTypes';

/** WMO Weather Code -> menschenlesbare Beschreibung */
const WMO_DESCRIPTIONS: Record<number, string> = {
    0: 'Klar',
    1: 'Ueberwiegend klar',
    2: 'Teilweise bewoelkt',
    3: 'Bedeckt',
    45: 'Nebel',
    48: 'Reifnebel',
    51: 'Leichter Nieselregen',
    53: 'Maessiger Nieselregen',
    55: 'Starker Nieselregen',
    56: 'Leichter gefrierender Nieselregen',
    57: 'Starker gefrierender Nieselregen',
    61: 'Leichter Regen',
    63: 'Maessiger Regen',
    65: 'Starker Regen',
    66: 'Leichter gefrierender Regen',
    67: 'Starker gefrierender Regen',
    71: 'Leichter Schneefall',
    73: 'Maessiger Schneefall',
    75: 'Starker Schneefall',
    77: 'Schneegriesel',
    80: 'Leichte Regenschauer',
    81: 'Maessige Regenschauer',
    82: 'Heftige Regenschauer',
    85: 'Leichte Schneeschauer',
    86: 'Starke Schneeschauer',
    95: 'Gewitter',
    96: 'Gewitter mit leichtem Hagel',
    99: 'Gewitter mit starkem Hagel',
};

function describeWeatherCode(code: number): string {
    return WMO_DESCRIPTIONS[code] ?? `Unbekannt (${code})`;
}

/** Wetter haelt eine Viertelstunde (wie bisher GEO_CACHE_TTL_WEATHER_MS). */
const WEATHER_MAX_AGE_MS = GEO_CACHE_TTL_WEATHER_MS;
/** Stunden der Vorhersage: zwei Tage ab heute. */
const FORECAST_DAYS = 2;
/** Wind in km/h wie seit jeher — darum eine eigene Zelle neben der m/s-Zelle der Themen-Dogs. */
const WEATHER_PARAMS = { forecast_days: OPEN_METEO_FORECAST_DAYS, wind_speed_unit: 'kmh' };
const CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weathercode', 'windspeed_10m', 'winddirection_10m'];
const HOURLY = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'weathercode',
    'windspeed_10m',
    'precipitation_probability',
];

/**
 * Fetch weather data from Open-Meteo through the shared cell store.
 * Returns current conditions and the hourly forecast of the first `forecastDays` days (max 7).
 */
export async function fetchWeather(lat: number, lng: number, forecastDays: number = FORECAST_DAYS, cache?: ICacheHandler): Promise<any> {
    const data = await fetchCellVariables(cache, {
        api: OPEN_METEO_FORECAST_URL,
        lat,
        lng,
        params: WEATHER_PARAMS,
        current: CURRENT,
        hourly: HOURLY,
        maxAgeMs: WEATHER_MAX_AGE_MS,
    });
    return sliceDays(data, forecastDays);
}

/** Parse Open-Meteo response into our typed current weather */
export function parseCurrentWeather(data: any): CurrentWeather {
    const c = data.current;
    return {
        temperature: c.temperature_2m,
        apparentTemperature: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        windSpeed: c.windspeed_10m,
        windDirection: c.winddirection_10m,
        weatherCode: c.weathercode,
        weatherDescription: describeWeatherCode(c.weathercode),
        time: c.time,
    };
}

/** Parse Open-Meteo hourly arrays into our typed forecast array */
export function parseHourlyForecast(data: any): HourlyForecast[] {
    const h = data.hourly;
    const times: string[] = h.time ?? [];

    return times.map((time: string, i: number) => ({
        time,
        temperature: h.temperature_2m[i],
        apparentTemperature: h.apparent_temperature[i],
        humidity: h.relative_humidity_2m[i],
        windSpeed: h.windspeed_10m[i],
        weatherCode: h.weathercode[i],
        weatherDescription: describeWeatherCode(h.weathercode[i]),
        precipitationProbability: h.precipitation_probability?.[i] ?? 0,
    }));
}

/**
 * Build a WeatherResult from lat/lng and an optional target time.
 * If time is given, hourly is filtered to a window around that hour.
 */
export async function getWeather(
    lat: number,
    lng: number,
    targetTime?: string,
    targetDate?: string,
    cache?: ICacheHandler,
): Promise<WeatherResult> {
    const data = await fetchWeather(lat, lng, FORECAST_DAYS, cache);

    const current = parseCurrentWeather(data);
    let hourly = parseHourlyForecast(data);

    let requestedTime: string | null = null;

    if (targetTime) {
        // Parse target time — either "HH:mm" or full ISO
        const date = targetDate ?? current.time.split('T')[0];
        let targetHour: string;

        if (targetTime.includes('T')) {
            // Full ISO string — extract the date+hour part
            targetHour = targetTime.substring(0, 13);
        } else {
            // "HH:mm" or "HH" format
            const hour = targetTime.split(':')[0].padStart(2, '0');
            targetHour = `${date}T${hour}`;
        }

        requestedTime = targetHour;

        // Filter to a 6-hour window around the target
        const targetIndex = hourly.findIndex((h) => h.time.startsWith(targetHour));
        if (targetIndex >= 0) {
            const start = Math.max(0, targetIndex - 1);
            const end = Math.min(hourly.length, targetIndex + 5);
            hourly = hourly.slice(start, end);
        }
    }

    return withStale(
        {
            current,
            hourly,
            location: {
                lat: data.latitude,
                lng: data.longitude,
                elevation: data.elevation,
                timezone: data.timezone,
            },
            requestedTime,
        },
        data,
    );
}
