/**
 * =========================================================================
 *  AIR QUALITY API CLIENT — reading the breathing void through Open-Meteo
 * =========================================================================
 *
 *  Arr, this module speaks the tongue of the Open-Meteo Air Quality API —
 *  a free, keyless gateway to atmospheric pollutant data and pollen counts.
 *
 *  Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality, via the
 *  shared Open-Meteo cell store (slopdogs-openmeteo).
 * =========================================================================
 */

import { GEO_CACHE_TTL_AIR_QUALITY_MS, type ICacheHandler } from '@martinschmieschek/slopdogs-core';
import { OPEN_METEO_AIR_QUALITY_URL, fetchCellVariables, withStale } from '@martinschmieschek/slopdogs-openmeteo';
import type { CurrentAirQuality, PollenData, HourlyAirQuality, AirQualityResult } from './interfaces/airQualityTypes';

/** Eigener Zeitraum der Luftqualitaets-Zelle: zwei Tage reichen fuer die naechsten 24 Stunden. */
const AIR_QUALITY_PARAMS = { forecast_days: 2 };
const CURRENT = ['european_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide'];
const HOURLY = [
    'european_aqi',
    'pm2_5',
    'pm10',
    'ozone',
    'birch_pollen',
    'grass_pollen',
    'alder_pollen',
    'ragweed_pollen',
    'mugwort_pollen',
    'olive_pollen',
];

/** European AQI -> menschenlesbare Beschreibung */
function describeAqi(aqi: number): string {
    if (aqi <= 20) return 'Gut';
    if (aqi <= 40) return 'Befriedigend';
    if (aqi <= 60) return 'Maessig';
    if (aqi <= 80) return 'Schlecht';
    if (aqi <= 100) return 'Sehr schlecht';
    return 'Extrem schlecht';
}

/**
 * Fetch air quality and pollen data from Open-Meteo through the shared cell store (30 min).
 */
export async function getAirQuality(lat: number, lng: number, cache?: ICacheHandler): Promise<AirQualityResult> {
    const data = (await fetchCellVariables(cache, {
        api: OPEN_METEO_AIR_QUALITY_URL,
        lat,
        lng,
        params: AIR_QUALITY_PARAMS,
        current: CURRENT,
        hourly: HOURLY,
        maxAgeMs: GEO_CACHE_TTL_AIR_QUALITY_MS,
    })) as any;

    // Current air quality
    const c = data.current;
    const current: CurrentAirQuality = {
        europeanAqi: c.european_aqi,
        aqiDescription: describeAqi(c.european_aqi),
        pm25: c.pm2_5,
        pm10: c.pm10,
        ozone: c.ozone,
        nitrogenDioxide: c.nitrogen_dioxide,
        sulphurDioxide: c.sulphur_dioxide,
        carbonMonoxide: c.carbon_monoxide,
        time: c.time,
    };

    // Hourly forecast (next 24h)
    const h = data.hourly;
    const times: string[] = h.time ?? [];
    const now = new Date();
    const hourly: HourlyAirQuality[] = [];

    for (let i = 0; i < times.length && hourly.length < 24; i++) {
        if (new Date(times[i]) < now) continue;
        hourly.push({
            time: times[i],
            europeanAqi: h.european_aqi[i],
            aqiDescription: describeAqi(h.european_aqi[i]),
            pm25: h.pm2_5[i],
            pm10: h.pm10[i],
            ozone: h.ozone[i],
        });
    }

    // Pollen — find the current/next hour
    let pollen: PollenData | null = null;
    const currentIdx = times.findIndex((t: string) => t === c.time);
    const pollenIdx = currentIdx >= 0 ? currentIdx : 0;
    if (h.birch_pollen) {
        pollen = {
            time: times[pollenIdx],
            birch: h.birch_pollen[pollenIdx] ?? 0,
            grass: h.grass_pollen[pollenIdx] ?? 0,
            alder: h.alder_pollen[pollenIdx] ?? 0,
            ragweed: h.ragweed_pollen[pollenIdx] ?? 0,
            mugwort: h.mugwort_pollen[pollenIdx] ?? 0,
            olive: h.olive_pollen[pollenIdx] ?? 0,
        };
    }

    return withStale(
        {
            current,
            pollen,
            hourly,
            location: {
                lat: data.latitude,
                lng: data.longitude,
                timezone: data.timezone,
            },
        },
        data,
    );
}
