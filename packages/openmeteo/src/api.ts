/**
 * =========================================================================
 *  OPEN-METEO API — Adressen, Antwortform, Abruf, Zellen-Schluessel
 * =========================================================================
 */

import { geoBucketKey } from '@martinschmieschek/slopdogs-core';

export const OPEN_METEO_SOURCE = 'Open-Meteo.com (CC BY 4.0)';
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
export const OPEN_METEO_SATELLITE_URL = 'https://satellite-api.open-meteo.com/v1/archive';
export const OPEN_METEO_AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const USER_AGENT = 'SlopDogs/0.3 (+https://github.com/MartinSchmieschek/SlopDogs)';
const TIMEOUT_MS = 15_000;

type Column = Array<number | string | null>;

/** Was die Dogs aus einer Open-Meteo-Antwort lesen (forecast, archive, satellite, air-quality sind gleich aufgebaut). */
export interface OpenMeteoResponse {
    latitude: number;
    longitude: number;
    elevation?: number;
    timezone: string;
    timezone_abbreviation?: string;
    utc_offset_seconds?: number;
    hourly?: Record<string, Column | undefined>;
    hourly_units?: Record<string, string>;
    daily?: Record<string, Column | undefined>;
    daily_units?: Record<string, string>;
    current?: Record<string, number | string | null | undefined>;
    current_units?: Record<string, string>;
}

/** Cache-Schluessel: 1-km-Zelle (bucketM ausdruecklich — 1000 allein waere der Radius und ergaebe 200-m-Zellen) plus Parameter. */
export function openMeteoCacheKey(prefix: string, lat: number, lng: number, extras: Record<string, string | number>): string {
    return geoBucketKey(prefix, lat, lng, 1000, { bucketM: 1000, extras });
}

/** Open-Meteo antwortete mit einem HTTP-Fehler. */
export class OpenMeteoHttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'OpenMeteoHttpError';
    }
}

/** Holt eine Open-Meteo-Antwort als JSON, mit Timeout und lesbarem Fehler (429/5xx stehen im Text). */
export async function fetchOpenMeteo(url: string, what: string): Promise<OpenMeteoResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
        res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new OpenMeteoHttpError(res.status, `Open-Meteo ${what} failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as OpenMeteoResponse;
}
