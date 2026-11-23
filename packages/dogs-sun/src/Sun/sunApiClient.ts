/**
 * =========================================================================
 *  SUN API CLIENT — reading the celestial void through Open-Meteo
 * =========================================================================
 *
 *  Arr, this module speaks the tongue of the Open-Meteo daily forecast —
 *  summoning sunrise, sunset, daylight, sunshine and UV data.
 *  No API key required — the sun grants passage freely, matey.
 * =========================================================================
 */

import type { ICacheHandler } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_FORECAST_DAYS,
    fetchCellVariables,
    forecastCellRequest,
    sliceDays,
    withStale,
} from '@martinschmieschek/slopdogs-openmeteo';
import type { SunDay, SunResult } from './interfaces/sunTypes';

/** UV-Index -> Risikobewertung */
function describeUvRisk(uv: number): string {
    if (uv <= 2) return 'Niedrig';
    if (uv <= 5) return 'Maessig';
    if (uv <= 7) return 'Hoch';
    if (uv <= 10) return 'Sehr hoch';
    return 'Extrem';
}

/** Sonnenstunden und UV-Index rechnet Open-Meteo stuendlich neu — eine Stunde halten. */
const SUN_MAX_AGE_MS = 60 * 60_000;
/** Dieselben Tagesvariablen liest AstronomyRetriever — beide teilen sich die Vorhersage-Zelle. */
const SUN_DAILY_VARIABLES = ['sunrise', 'sunset', 'daylight_duration', 'sunshine_duration', 'uv_index_max'];

/**
 * Fetch sun data from Open-Meteo through the shared forecast cell (1..7 days).
 */
export async function getSunData(lat: number, lng: number, forecastDays: number = 7, cache?: ICacheHandler): Promise<SunResult> {
    const days = Math.min(Math.max(forecastDays, 1), OPEN_METEO_FORECAST_DAYS);
    const cell = await fetchCellVariables(cache, forecastCellRequest(lat, lng, { daily: SUN_DAILY_VARIABLES }, SUN_MAX_AGE_MS));
    const data = sliceDays(cell, days) as any;
    const d = data.daily;
    const times: string[] = d.time ?? [];

    const allDays: SunDay[] = times.map((date: string, i: number) => ({
        date,
        sunrise: d.sunrise[i],
        sunset: d.sunset[i],
        daylightHours: Math.round((d.daylight_duration[i] / 3600) * 100) / 100,
        sunshineHours: Math.round((d.sunshine_duration[i] / 3600) * 100) / 100,
        uvIndexMax: d.uv_index_max[i],
        uvRisk: describeUvRisk(d.uv_index_max[i]),
    }));

    return withStale(
        {
            today: allDays[0],
            forecast: allDays,
            location: {
                lat: data.latitude,
                lng: data.longitude,
                timezone: data.timezone,
            },
        },
        cell,
    );
}
