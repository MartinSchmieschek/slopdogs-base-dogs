/**
 * =========================================================================
 *  SLOPDOGS-OPENMETEO — die gemeinsame Grundlage der Open-Meteo-Dogs
 * =========================================================================
 *
 *  Kein Dog, nur Werkzeug: Abruf mit Timeout und lesbarem Fehler, Cache-Schluessel
 *  auf der 1-km-Zelle, Stundenspalten als Zeilen, Ort und Quellenangabe.
 *  Die Dog-Pakete (solar, wind, soil, snow, storm) haengen es als peerDependency
 *  an — wie geo-pact.
 *
 *  Regeln, die hier stecken:
 *  - Hoechstens 10 Variablen je Abruf: Open-Meteo zaehlt mehr als Mehrfachabruf.
 *  - Wind immer in m/s, Zeit in Ortszeit des Standorts (`timezone=auto`).
 *  - Jedes Ergebnis traegt `source` — CC BY 4.0 verlangt die Quellenangabe.
 */

import { geoBucketKey, type IHuntingDog } from '@martinschmieschek/slopdogs-core';

export const OPEN_METEO_SOURCE = 'Open-Meteo.com (CC BY 4.0)';
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
export const OPEN_METEO_SATELLITE_URL = 'https://satellite-api.open-meteo.com/v1/archive';

/** Open-Meteo zaehlt Anfragen mit mehr Variablen anteilig mehrfach. */
export const OPEN_METEO_MAX_VARIABLES = 10;

const USER_AGENT = 'SlopDogs/0.3 (+https://github.com/MartinSchmieschek/SlopDogs)';
const TIMEOUT_MS = 15_000;

/** Wie `required`/`optional` in core: Konstruktoren mit beliebigen Argumenten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

/** Was die Dogs aus einer Open-Meteo-Antwort lesen (forecast, archive, satellite sind gleich aufgebaut). */
export interface OpenMeteoResponse {
    latitude: number;
    longitude: number;
    elevation?: number;
    timezone: string;
    utc_offset_seconds?: number;
    hourly?: Record<string, Array<number | string | null> | undefined>;
    hourly_units?: Record<string, string>;
}

/** Standort, wie Open-Meteo ihn auf sein Raster gelegt hat */
export interface OpenMeteoLocation {
    lat: number;
    lng: number;
    elevation: number | null;
    timezone: string;
    utcOffsetSeconds: number;
}

/** Zahl oder null — Open-Meteo liefert null fuer fehlende Werte. */
export function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Liest lat/lng aus der Query oder wirft mit dem Namen des Dogs. */
export function parseLatLng(query: { lat?: string; lng?: string }, dogName: string): { lat: number; lng: number } {
    const lat = parseFloat(query.lat ?? '');
    const lng = parseFloat(query.lng ?? '');
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error(`${dogName}: Missing or invalid query params (lat, lng)`);
    }
    return { lat, lng };
}

/** Ganzzahl aus der Query, auf [min, max] geklemmt; unlesbar → fallback. */
export function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
    const n = parseInt(raw ?? '', 10);
    return Math.min(Math.max(isNaN(n) ? fallback : n, min), max);
}

/** Heutiges UTC-Datum — gehoert in den Schluessel jeder Vorhersage, die mit „heute“ beginnt. */
export function todayUtc(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Cache-Schluessel: 1-km-Zelle (bucketM ausdruecklich — 1000 allein waere der Radius und ergaebe 200-m-Zellen) plus Parameter. */
export function openMeteoCacheKey(prefix: string, lat: number, lng: number, extras: Record<string, string | number>): string {
    return geoBucketKey(prefix, lat, lng, 1000, { bucketM: 1000, extras });
}

/** Baut die Abruf-URL: Ort, Ortszeit, Wind in m/s, dazu die eigenen Parameter. Wirft bei mehr als 10 Stundenvariablen. */
export function openMeteoUrl(base: string, lat: number, lng: number, params: Record<string, string | number>): string {
    const hourly = String(params.hourly ?? '');
    if (hourly && hourly.split(',').length > OPEN_METEO_MAX_VARIABLES) {
        throw new Error(
            `openMeteoUrl: ${hourly.split(',').length} hourly variables — Open-Meteo counts more than ${OPEN_METEO_MAX_VARIABLES} as several calls`,
        );
    }
    const all: Record<string, string | number> = { latitude: lat, longitude: lng, timezone: 'auto', wind_speed_unit: 'ms', ...params };
    return `${base}?${Object.entries(all)
        .map(([k, v]) => `${k}=${v}`)
        .join('&')}`;
}

/** Holt eine Open-Meteo-Antwort als JSON, mit Timeout und lesbarem Fehler (429/5xx stehen im Text — der Cache merkt sie sich kurz). */
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
        throw new Error(`Open-Meteo ${what} failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as OpenMeteoResponse;
}

/** Ort aus der Antwort. */
export function toLocation(data: OpenMeteoResponse): OpenMeteoLocation {
    return {
        lat: data.latitude,
        lng: data.longitude,
        elevation: num(data.elevation),
        timezone: data.timezone,
        utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    };
}

/** Eine Stunde: Zeitstempel plus die gewaehlten Felder. */
export type HourlyRow<K extends string> = { time: string } & Record<K, number | null>;

/**
 * Open-Meteo-Stundenspalten → Zeilen. `fields` bildet eigene Feldnamen auf Open-Meteo-Variablen ab,
 * z. B. `{ gust: 'wind_gusts_10m' }`. Die Variablenliste fuer die URL liefert `hourlyVariables(fields)`.
 */
export function hourlyRows<K extends string>(data: OpenMeteoResponse, fields: Record<K, string>): HourlyRow<K>[] {
    const h = data.hourly ?? {};
    const times = (h.time ?? []) as string[];
    const entries = Object.entries(fields) as Array<[K, string]>;
    return times.map((time, i) => {
        const row = { time } as HourlyRow<K>;
        for (const [out, variable] of entries) (row as Record<string, unknown>)[out] = num(h[variable]?.[i]);
        return row;
    });
}

/** Einheiten je eigenem Feldnamen, so wie Open-Meteo sie in `hourly_units` meldet. */
export function hourlyUnits<K extends string>(data: OpenMeteoResponse, fields: Record<K, string>): Record<K, string> {
    const units = data.hourly_units ?? {};
    return Object.fromEntries(
        (Object.entries(fields) as Array<[K, string]>).map(([out, variable]) => [out, units[variable] ?? '']),
    ) as Record<K, string>;
}

/** Die Open-Meteo-Variablen eines Feld-Mappings, kommagetrennt fuer `hourly=`. */
export function hourlyVariables(fields: Record<string, string>): string {
    return Object.values(fields).join(',');
}

/** Stundenzeilen je Ortsdatum gruppiert (Zeitstempel sind Ortszeit, die ersten zehn Zeichen sind das Datum). */
export function groupByDate<R extends { time: string }>(rows: R[]): Map<string, R[]> {
    const byDate = new Map<string, R[]>();
    for (const r of rows) {
        const date = r.time.slice(0, 10);
        const list = byDate.get(date) ?? [];
        list.push(r);
        byDate.set(date, list);
    }
    return byDate;
}

/** Summe, Maximum, Minimum, Mittel einer Spalte ohne null-Werte; null, wenn keine Werte. */
export function aggregate(values: Array<number | null>, how: 'sum' | 'max' | 'min' | 'mean'): number | null {
    const v = values.filter((x): x is number => x !== null);
    if (v.length === 0) return null;
    const r =
        how === 'sum'
            ? v.reduce((a, b) => a + b, 0)
            : how === 'max'
              ? Math.max(...v)
              : how === 'min'
                ? Math.min(...v)
                : v.reduce((a, b) => a + b, 0) / v.length;
    return Math.round(r * 1000) / 1000;
}
