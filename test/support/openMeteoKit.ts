/**
 * Werkzeug fuer die Open-Meteo-Tests: eine Attrappe der Open-Meteo-APIs, ein Cache-Handler im Speicher und ein
 * Kennel-Lauf fuer einen einzelnen Dog. Kein Netz.
 *
 * Die Attrappe rechnet jeden Wert aus Variable und Zeitstempel, nicht aus der Position in der Antwort: dieselbe
 * Stunde hat in einer 2-Tage- und einer 7-Tage-Antwort denselben Wert. Nur so sind Ergebnisse vor und nach dem
 * Zellen-Speicher vergleichbar. Wind kommt je nach `wind_speed_unit` in km/h (Vorgabe) oder m/s.
 */

import assert from 'node:assert/strict';
import type { ICacheHandler, IHuntingDog } from '@martinschmieschek/slopdogs-core';
import { KennelRun, QueryRetriever, BodyRetriever } from '@martinschmieschek/slopdogs-core/runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

/** Erster Vorhersagetag der Attrappe (Ortszeit) — fest, damit Aufzeichnungen nicht vom Testtag abhaengen. */
export const BASE_DATE = '2026-11-23';
/** „Jetzt“ fuer Dogs, die mit der Uhr filtern (AirQuality): 23.11.2026 11:30 Ortszeit des Rechners. */
export const FIXED_NOW = new Date(`${BASE_DATE}T11:30:00`).getTime();

const WEATHER_CODES = [0, 1, 2, 3, 45, 61, 63, 71, 80, 95];
const DEFAULT_FORECAST_DAYS: Record<string, number> = { 'air-quality-api.open-meteo.com': 5, 'marine-api.open-meteo.com': 5 };

function hash(s: string): number {
    let h = 7;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100_003;
    return h;
}

function addDays(date: string, n: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function hourIndex(time: string): number {
    return Math.round((Date.parse(`${time}:00Z`) - Date.parse('2026-01-01T00:00:00Z')) / 3_600_000);
}

const isWind = (v: string) => /wind_?speed|wind_gusts/.test(v);

function valueOf(variable: string, time: string, host: string, windUnit: string): number | string | null {
    const h = hash(variable);
    const i = hourIndex(time.length === 10 ? `${time}T00:00` : time);
    if (/weather_?code/.test(variable)) return WEATHER_CODES[(h + i) % WEATHER_CODES.length];
    if (variable === 'lightning_potential' && i % 5 === 0) return null;
    if (host.startsWith('satellite') && time > `${BASE_DATE}T10:00`) return null;
    if (variable === 'sunrise') return `${time.slice(0, 10)}T07:${String(40 + (i % 20)).padStart(2, '0')}`;
    if (variable === 'sunset') return `${time.slice(0, 10)}T16:${String(20 + (i % 20)).padStart(2, '0')}`;
    const raw = Math.round(((h % 50) + 10 * Math.sin(i / 7 + (h % 5))) * 10) / 10;
    if (isWind(variable) && windUnit === 'ms') return Math.round((Math.abs(raw) / 3.6) * 100) / 100;
    return isWind(variable) ? Math.abs(raw) : raw;
}

function list(params: URLSearchParams, name: string): string[] {
    return (params.get(name) ?? '').split(',').filter(Boolean);
}

/** Tage der Antwort: start_date..end_date oder past_days vor bis forecast_days ab BASE_DATE. */
function datesOf(url: URL): string[] {
    const p = url.searchParams;
    const start = p.get('start_date');
    const end = p.get('end_date');
    if (start && end) {
        const out: string[] = [];
        for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
        return out;
    }
    const past = Number(p.get('past_days') ?? 0);
    const forecast = Number(p.get('forecast_days') ?? DEFAULT_FORECAST_DAYS[url.host] ?? 7);
    return Array.from({ length: past + forecast }, (_, k) => addDays(BASE_DATE, k - past));
}

/** Gewicht nach Open-Meteo-Regel, unabhaengig vom Paket nachgerechnet: max(1, Variablen/10) × max(1, Tage/14). */
export function vendorWeight(rawUrl: string): number {
    const url = new URL(rawUrl);
    const vars = ['hourly', 'daily', 'current'].reduce((n, s) => n + list(url.searchParams, s).length, 0);
    return Math.max(1, vars / 10) * Math.max(1, datesOf(url).length / 14);
}

/** Open-Meteo-foermige Antwort auf eine URL. */
export function fakeOpenMeteoResponse(rawUrl: string): unknown {
    const url = new URL(rawUrl);
    const p = url.searchParams;
    const windUnit = p.get('wind_speed_unit') ?? 'kmh';
    const unitOf = (v: string) => (isWind(v) ? (windUnit === 'ms' ? 'm/s' : 'km/h') : `u:${v}`);
    const dates = datesOf(url);
    const body: Record<string, unknown> = {
        latitude: 51.72,
        longitude: 8.76,
        generationtime_ms: 0.2,
        utc_offset_seconds: 3600,
        timezone: 'Europe/Berlin',
        timezone_abbreviation: 'GMT+1',
        elevation: 110,
    };
    const section = (name: string, times: string[]) => {
        const vars = list(p, name);
        if (vars.length === 0) return;
        body[`${name}_units`] = Object.fromEntries([['time', 'iso8601'], ...vars.map((v) => [v, unitOf(v)])]);
        body[name] = Object.fromEntries([['time', times], ...vars.map((v) => [v, times.map((t) => valueOf(v, t, url.host, windUnit))])]);
    };
    section(
        'hourly',
        dates.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`)),
    );
    section('daily', dates);
    const current = list(p, 'current');
    if (current.length > 0) {
        const time = `${BASE_DATE}T12:00`;
        body.current_units = Object.fromEntries([['time', 'iso8601'], ['interval', 'seconds'], ...current.map((v) => [v, unitOf(v)])]);
        body.current = Object.fromEntries([
            ['time', time],
            ['interval', 900],
            ...current.map((v) => [v, valueOf(v, time, url.host, windUnit)]),
        ]);
    }
    return body;
}

/** Ersetzt globalThis.fetch durch die Attrappe und zaehlt Abrufe samt Gewicht. */
export class FakeOpenMeteo {
    readonly urls: string[] = [];
    private readonly realFetch = globalThis.fetch;

    constructor(private readonly delayMs = 5) {
        globalThis.fetch = (async (input: string | URL) => {
            const url = String(input);
            this.urls.push(url);
            await new Promise((r) => setTimeout(r, this.delayMs));
            return new Response(JSON.stringify(fakeOpenMeteoResponse(url)), { status: 200 });
        }) as typeof fetch;
    }

    get weight(): number {
        return Math.round(this.urls.reduce((sum, u) => sum + vendorWeight(u), 0) * 1000) / 1000;
    }

    restore(): void {
        globalThis.fetch = this.realFetch;
    }
}

/** Cache-Handler im Speicher mit TTL und geteiltem Abruf je Schluessel — wie der Server, ohne Datenbank. */
export class MemoryCacheHandler {
    readonly store = new Map<string, { value: unknown; expires: number }>();
    private readonly inFlight = new Map<string, Promise<unknown>>();

    async get<T>(key: string): Promise<T | undefined> {
        return this.read<T>(key);
    }
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
        this.write(key, value, ttlMs);
    }
    async has(key: string): Promise<boolean> {
        return this.read(key) !== undefined;
    }
    /** Wie der Server: Treffer, sonst geteilter laufender Abruf, sonst Abruf und Speichern. Liest und schreibt an get/set vorbei. */
    async getOrFetch<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
        const hit = this.read<T>(key);
        if (hit !== undefined) return hit;
        const running = this.inFlight.get(key);
        if (running) return running as Promise<T>;
        const p = factory()
            .then((v) => {
                this.write(key, v, ttlMs);
                return v;
            })
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, p);
        return p;
    }
    /** Zelleintraege (ohne die 60-s-Abrufteilung). */
    cellKeys(): string[] {
        return [...this.store.keys()].filter((k) => k.startsWith('openmeteo-cell:'));
    }
    async invalidate(key: string): Promise<void> {
        this.store.delete(key);
    }
    async invalidateByPrefix(prefix: string): Promise<void> {
        for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
    }
    async prune(): Promise<void> {}
    getTileFeatureCache(): undefined {
        return undefined;
    }
    private read<T>(key: string): T | undefined {
        const e = this.store.get(key);
        return e && e.expires > Date.now() ? (e.value as T) : undefined;
    }
    private write(key: string, value: unknown, ttlMs: number): void {
        this.store.set(key, { value: structuredClone(value), expires: Date.now() + ttlMs });
    }
    asHandler(): ICacheHandler {
        return this as unknown as ICacheHandler;
    }
}

/** Liefert den Query-Pact eines Dogs mit fester Query (im Server fuellt ihn ein MimicDog). */
export function supplier(pact: unknown, query: Record<string, string>): DogClass {
    const Pact = pact as DogClass;
    return class TestQuery extends Pact {
        get name(): string {
            return 'TestQuery';
        }
        protected yieldCollectorFactory = async (): Promise<Record<string, string>> => query;
    };
}

/** Treffer und Fehlschlaege, wie core sie je Dog zaehlt (withDogCacheStats, im Kennel-Lauf um den Handler gelegt). */
export interface DogCacheStats {
    hits: number;
    misses: number;
}

/** Laesst einen Dog in einem Kennel laufen und liefert sein Ergebnis (oder wirft dessen Fehler). */
export async function runDog<R>(dog: unknown, pact: unknown, query: Record<string, string>, cache?: ICacheHandler): Promise<R> {
    return (await runDogWithStats<R>(dog, pact, query, cache)).result;
}

/** Wie runDog, dazu die Cache-Zaehlung, die core am Dog ablegt (`__cacheStats`). */
export async function runDogWithStats<R>(
    dog: unknown,
    pact: unknown,
    query: Record<string, string>,
    cache?: ICacheHandler,
): Promise<{ result: R; stats: DogCacheStats }> {
    const D = dog as DogClass;
    const map = new Map<string, DogClass>();
    for (const C of [QueryRetriever, BodyRetriever, D, supplier(pact, query)] as DogClass[]) map.set(new C().name, C);
    const name = new D().name;
    const season = await new KennelRun(
        { id: `test-${name}`, dogIds: [`base:${name}`, 'base:TestQuery'] },
        map,
        undefined,
        {},
        undefined,
        [],
        cache,
    ).run();
    const ran = season.exhausted.find((x) => x.name === name) as unknown as
        { collected?: R; error?: unknown; __cacheStats?: DogCacheStats } | undefined;
    assert.ok(ran?.collected, `${name} lieferte nichts: ${String(ran?.error)}`);
    return { result: ran.collected, stats: ran.__cacheStats ?? { hits: 0, misses: 0 } };
}
