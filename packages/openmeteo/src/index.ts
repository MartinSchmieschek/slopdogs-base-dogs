/**
 * =========================================================================
 *  SLOPDOGS-OPENMETEO — die gemeinsame Grundlage der Open-Meteo-Dogs
 * =========================================================================
 *
 *  Kein Dog, nur Werkzeug: der gemeinsame Zellen-Speicher (cellStore) mit Budget-
 *  Waechter (budget), Abruf mit Timeout und lesbarem Fehler, Cache-Schluessel auf der
 *  1-km-Zelle, Stundenspalten als Zeilen, Ort und Quellenangabe. Die Open-Meteo-Dogs
 *  haengen es als peerDependency an — wie geo-pact.
 *
 *  Regeln, die hier stecken:
 *  - Open-Meteo zaehlt anteilig: max(1, Variablen/10 × max(1, Tage/14)) je Abruf (budget.ts).
 *  - Wind in m/s, Zeit in Ortszeit des Standorts (`timezone=auto`).
 *  - Jedes Ergebnis traegt `source` — CC BY 4.0 verlangt die Quellenangabe.
 */

import type { IHuntingDog } from '@martinschmieschek/slopdogs-core';
import type { OpenMeteoResponse } from './api';

export * from './api';
export * from './budget';
export * from './cellStore';
export * from './variableTtl';

/** Wie `required`/`optional` in core: Konstruktoren mit beliebigen Argumenten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

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

/** Baut die Abruf-URL: Ort, Ortszeit, Wind in m/s, dazu die eigenen Parameter. */
export function openMeteoUrl(base: string, lat: number, lng: number, params: Record<string, string | number>): string {
    const all: Record<string, string | number> = { latitude: lat, longitude: lng, timezone: 'auto', wind_speed_unit: 'ms', ...params };
    return `${base}?${Object.entries(all)
        .map(([k, v]) => `${k}=${v}`)
        .join('&')}`;
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
