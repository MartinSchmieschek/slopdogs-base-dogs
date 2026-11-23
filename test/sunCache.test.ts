/**
 * SunRetriever: zweiter Lauf am selben Ort kommt aus dem Cache, nicht von Open-Meteo.
 * Fetch und Cache-Handler sind Attrappen — der Test geht nicht ins Netz.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ICacheHandler, IHuntingDog } from '@martinschmieschek/slopdogs-core';
import { KennelRun, QueryRetriever, BodyRetriever } from '@martinschmieschek/slopdogs-core/runtime';
import { SunRetriever, SunQueryPact } from '@martinschmieschek/slopdogs-dogs-sun';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

const FIXTURE = {
    latitude: 51.72,
    longitude: 8.75,
    timezone: 'Europe/Berlin',
    daily: {
        time: ['2026-11-23'],
        sunrise: ['2026-11-23T07:58'],
        sunset: ['2026-11-23T16:27'],
        daylight_duration: [30540],
        sunshine_duration: [7200],
        uv_index_max: [0.8],
    },
};

class MemoryCache {
    readonly keys: string[] = [];
    readonly ttls: number[] = [];
    private readonly store = new Map<string, unknown>();
    /** KennelRun reicht den Tile-Cache an Flaechen-Dogs weiter; der SunRetriever braucht ihn nicht. */
    getTileFeatureCache(): undefined {
        return undefined;
    }
    async getOrFetch<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
        this.keys.push(key);
        this.ttls.push(ttlMs);
        if (this.store.has(key)) return this.store.get(key) as T;
        const value = await factory();
        this.store.set(key, value);
        return value;
    }
}

/**
 * Liefert den SunQueryProvider-Pact mit fester Query. Im Server fuellt ihn ein MimicDog mit Nutzer-Code;
 * ein Auto-Mimic ohne Code liefert nichts, darum hier ein eigener kleiner Lieferant.
 */
function sunQuerySupplier(query: Record<string, string>): DogClass {
    const Pact = SunQueryPact as unknown as DogClass;
    return class TestSunQuery extends Pact {
        get name(): string {
            return 'TestSunQuery';
        }
        protected yieldCollectorFactory = async (): Promise<Record<string, string>> => query;
    };
}

async function runSun(query: Record<string, string>, cache: MemoryCache): Promise<unknown> {
    const map = new Map<string, DogClass>();
    for (const C of [QueryRetriever, BodyRetriever, SunRetriever, sunQuerySupplier(query)] as DogClass[]) map.set(new C().name, C);
    const run = new KennelRun(
        { id: 'test-sun-cache', dogIds: ['base:SunRetriever', 'base:TestSunQuery'] },
        map,
        undefined,
        {},
        undefined,
        [],
        cache as unknown as ICacheHandler,
    );
    const season = await run.run();
    const sun = season.exhausted.find((d) => d.name === 'SunRetriever');
    assert.ok(sun, 'SunRetriever lief nicht');
    return sun.collected;
}

test('SunRetriever: gleicher Ort (auch mit GPS-Jitter) holt nur einmal, Haltezeit eine Stunde', async (t) => {
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        fetches++;
        return new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    t.after(() => {
        globalThis.fetch = realFetch;
    });

    const cache = new MemoryCache();
    const first = await runSun({ lat: '51.7189', lng: '8.7575' }, cache);
    const second = await runSun({ lat: '51.7190', lng: '8.7576' }, cache); // ~12 m daneben

    assert.equal(fetches, 1, 'zweiter Lauf ging an Open-Meteo statt in den Cache');
    assert.deepEqual(second, first);
    assert.equal(cache.keys.length, 2);
    assert.equal(cache.keys[0], cache.keys[1], 'Jitter erzeugt einen neuen Schluessel');
    assert.match(cache.keys[0], /^sun:.*days=7/);
    assert.match(cache.keys[0], /date=\d{4}-\d{2}-\d{2}/);
    assert.deepEqual(cache.ttls, [3_600_000, 3_600_000]);
});

test('SunRetriever: andere Tageszahl ist ein eigener Schluessel, Tage werden auf 1..16 geklemmt', async (t) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    t.after(() => {
        globalThis.fetch = realFetch;
    });

    const cache = new MemoryCache();
    await runSun({ lat: '51.7189', lng: '8.7575', days: '3' }, cache);
    await runSun({ lat: '51.7189', lng: '8.7575', days: '99' }, cache);
    await runSun({ lat: '51.7189', lng: '8.7575', days: 'abc' }, cache);

    assert.match(cache.keys[0], /days=3/);
    assert.match(cache.keys[1], /days=16/);
    assert.match(cache.keys[2], /days=7/);
});
