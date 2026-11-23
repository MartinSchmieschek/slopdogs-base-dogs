/**
 * dogs-solar: Abfrage, Zuschnitt, Tagessummen, Cache-Schluessel und Haltezeiten der drei Solar-Dogs.
 * Fetch und Cache sind Attrappen — kein Netz. Die Attrappe antwortet im Format, das Open-Meteo am
 * 23.11.2026 lieferte (forecast, archive, satellite gleich aufgebaut; Satellit mit null fuer Zukunft).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ICacheHandler, IHuntingDog } from '@martinschmieschek/slopdogs-core';
import { KennelRun, QueryRetriever, BodyRetriever } from '@martinschmieschek/slopdogs-core/runtime';
import {
    SolarRadiationRetriever,
    SolarRadiationHistoryRetriever,
    SatelliteRadiationRetriever,
    SolarRadiationQueryPact,
    SolarRadiationHistoryQueryPact,
    SatelliteRadiationQueryPact,
    resolveRange,
    historyTtl,
    type SolarRadiationResult,
} from '@martinschmieschek/slopdogs-dogs-solar';
import { MemoryCacheHandler } from './support/openMeteoKit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

const DAY = 24 * 60 * 60_000;

/** Zwei Tage, je 24 Stunden; 12:00 = 400 W/m² GHI, 06:00 = 100, sonst 0. Satellit: ab Stunde 40 null. */
function fixture(withWeather: boolean, nullFrom?: number): unknown {
    const time: string[] = [];
    const ghi: (number | null)[] = [];
    for (let d = 0; d < 2; d++) {
        for (let h = 0; h < 24; h++) {
            time.push(`2026-11-${String(10 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
            ghi.push(h === 12 ? 400 : h === 6 ? 100 : 0);
        }
    }
    const cut = <T>(a: T[]): (T | null)[] => a.map((v, i) => (nullFrom !== undefined && i >= nullFrom ? null : v));
    const hourly: Record<string, unknown[]> = {
        time,
        shortwave_radiation: cut(ghi),
        direct_radiation: cut(ghi.map((g) => (g ?? 0) / 2)),
        diffuse_radiation: cut(ghi.map((g) => (g ?? 0) / 2)),
        direct_normal_irradiance: cut(ghi.map((g) => (g ?? 0) * 1.5)),
    };
    if (withWeather) {
        hourly.cloud_cover = time.map(() => 50);
        hourly.temperature_2m = time.map(() => 3.5);
        hourly.wind_speed_10m = time.map(() => 2.1);
    }
    return { latitude: 52.52, longitude: 13.41, elevation: 38, timezone: 'Europe/Berlin', utc_offset_seconds: 3600, hourly };
}

/** Cache im Speicher; merkt sich Schluessel und Haltezeit von getOrFetch (Archiv) und set (Zellen-Speicher). */
class Recorder extends MemoryCacheHandler {
    readonly keys: string[] = [];
    readonly ttls: number[] = [];
    async getOrFetch<T>(key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
        if (key.startsWith('openmeteo-')) return super.getOrFetch(key, ttl, factory);
        this.keys.push(key);
        this.ttls.push(ttl);
        return factory();
    }
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
        this.keys.push(key);
        return super.set(key, value, ttlMs);
    }
}

function supplier(pact: unknown, query: Record<string, string>): DogClass {
    const Pact = pact as DogClass;
    return class TestQuery extends Pact {
        get name(): string {
            return 'TestQuery';
        }
        protected yieldCollectorFactory = async (): Promise<Record<string, string>> => query;
    };
}

/** Laesst den Dog in einem Kennel laufen; liefert Ergebnis, Fehler, die abgerufene URL und den Cache-Mitschnitt. */
async function run(
    dog: DogClass,
    pact: unknown,
    query: Record<string, string>,
    body: unknown,
): Promise<{ result?: SolarRadiationResult; error?: string; urls: string[]; cache: Recorder }> {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const cache = new Recorder();
    try {
        const map = new Map<string, DogClass>();
        for (const C of [QueryRetriever, BodyRetriever, dog, supplier(pact, query)]) map.set(new C().name, C);
        const name = new dog().name;
        const season = await new KennelRun(
            { id: 'test-solar', dogIds: [`base:${name}`, 'base:TestQuery'] },
            map,
            undefined,
            {},
            undefined,
            [],
            cache as unknown as ICacheHandler,
        ).run();
        const d = season.exhausted.find((x) => x.name === name) as unknown as
            { collected?: SolarRadiationResult; error?: unknown } | undefined;
        return { result: d?.collected, error: d?.error ? String(d.error) : undefined, urls, cache };
    } finally {
        globalThis.fetch = realFetch;
    }
}

const BERLIN = { lat: '52.52', lng: '13.41' };

test('SolarRadiationRetriever: Vorhersage-URL, Stunden, Tagessummen, Zellen-Schluessel, 30 min', async () => {
    const r = await run(SolarRadiationRetriever as unknown as DogClass, SolarRadiationQueryPact, { ...BERLIN, days: '5' }, fixture(true));
    assert.ok(r.result, r.error);
    const url = new URL(r.urls[0]);
    assert.equal(url.host, 'api.open-meteo.com');
    assert.equal(url.searchParams.get('forecast_days'), '7', 'die Vorhersage-Zelle haelt immer 7 Tage');
    assert.equal(url.searchParams.get('hourly')?.split(',').length, 7);
    assert.equal(url.searchParams.get('tilt'), null, 'keine Neigung (10-0)');
    assert.equal(r.result.kind, 'forecast');
    assert.equal(r.result.hours.length, 48);
    assert.deepEqual(r.result.hours[12], {
        time: '2026-11-10T12:00',
        ghi: 400,
        directHorizontal: 200,
        dhi: 200,
        dni: 600,
        cloudCover: 50,
        temperature: 3.5,
        windSpeed: 2.1,
    });
    assert.deepEqual(r.result.days[0], {
        date: '2026-11-10',
        ghiKWhPerM2: 0.5,
        directKWhPerM2: 0.25,
        diffuseKWhPerM2: 0.25,
        hoursWithData: 24,
    });
    assert.match(r.result.source, /CC BY 4\.0/);
    assert.match(r.cache.keys[0], /^openmeteo-cell:.*forecast_days=7/);
    assert.match(new SolarRadiationRetriever().description, /data up to 30 min old/);
});

test('SolarRadiationRetriever: Tage auf 7 geklemmt, ungueltiger Ort wirft', async () => {
    const r = await run(SolarRadiationRetriever as unknown as DogClass, SolarRadiationQueryPact, { ...BERLIN, days: '40' }, fixture(true));
    assert.equal(new URL(r.urls[0]).searchParams.get('forecast_days'), '7');
    const bad = await run(SolarRadiationRetriever as unknown as DogClass, SolarRadiationQueryPact, { lat: '95', lng: '13' }, fixture(true));
    assert.equal(bad.result, undefined);
    assert.equal(bad.urls.length, 0, 'ungueltiger Ort darf nicht abrufen');
});

test('SolarRadiationHistoryRetriever: Archiv-URL und Zeitraum im Schluessel', async () => {
    const q = { ...BERLIN, startDate: '2023-01-01', endDate: '2023-12-31' };
    const r = await run(SolarRadiationHistoryRetriever as unknown as DogClass, SolarRadiationHistoryQueryPact, q, fixture(true));
    assert.ok(r.result, r.error);
    const url = new URL(r.urls[0]);
    assert.equal(url.host, 'archive-api.open-meteo.com');
    assert.equal(url.searchParams.get('start_date'), '2023-01-01');
    assert.equal(url.searchParams.get('end_date'), '2023-12-31');
    assert.equal(r.result.kind, 'archive');
    assert.match(r.cache.keys[0], /^solar-archive:.*end=2023-12-31.*start=2023-01-01/);
    assert.deepEqual(r.cache.ttls, [30 * DAY], 'abgeschlossene Vergangenheit: 30 Tage');
});

test('SolarRadiationHistoryRetriever: Zeitraum-Regeln und Haltezeit', () => {
    const now = Date.parse('2026-11-23T10:00:00Z');
    assert.deepEqual(resolveRange({ lat: '1', lng: '1' }, now), { startDate: '2026-11-11', endDate: '2026-11-17' });
    assert.throws(() => resolveRange({ lat: '1', lng: '1', startDate: '2024-01-01', endDate: '2025-06-01' }, now), /exceeds 366/);
    assert.throws(() => resolveRange({ lat: '1', lng: '1', startDate: '2024-02-02', endDate: '2024-02-01' }, now), /after endDate/);
    assert.throws(() => resolveRange({ lat: '1', lng: '1', endDate: '2026-12-01' }, now), /future/);
    assert.throws(() => resolveRange({ lat: '1', lng: '1', startDate: '1939-12-31', endDate: '1940-01-05' }, now), /1940/);
    assert.throws(() => resolveRange({ lat: '1', lng: '1', endDate: '23.11.2026' }, now), /invalid endDate/);
    assert.equal(historyTtl('2026-11-01', now), 30 * DAY);
    assert.equal(historyTtl('2026-11-20', now), 6 * 60 * 60_000, 'juengste Tage kann das Archiv noch nachliefern');
});

test('SatelliteRadiationRetriever: Satelliten-URL, Zukunft (null) faellt weg, kein Wetter, 15 min', async () => {
    const r = await run(
        SatelliteRadiationRetriever as unknown as DogClass,
        SatelliteRadiationQueryPact,
        { ...BERLIN, pastDays: '3' },
        fixture(false, 40),
    );
    assert.ok(r.result, r.error);
    const url = new URL(r.urls[0]);
    assert.equal(url.host, 'satellite-api.open-meteo.com');
    assert.equal(url.searchParams.get('models'), 'satellite_radiation_seamless');
    assert.equal(url.searchParams.get('past_days'), '7', 'die Zelle haelt immer 7 Tage, der Dog schneidet seine 3 + heute heraus');
    assert.equal(r.result.kind, 'satellite');
    assert.equal(r.result.hours.length, 40);
    assert.equal(r.result.hours[0].temperature, undefined);
    assert.equal(r.result.days[1].hoursWithData, 16);
    assert.match(r.cache.keys[0], /^openmeteo-cell:.*models=satellite_radiation_seamless.*past_days=7/);
    assert.match(new SatelliteRadiationRetriever().description, /data up to 15 min old/);
});
