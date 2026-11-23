/**
 * Open-Meteo-Grundlage (slopdogs-openmeteo) und die Themen-Dogs wind, soil, snow, storm, humidity:
 * URL, Variablen (hoechstens 10), Zuschnitt auf eigene Feldnamen, Tageswerte, Einheiten,
 * Cache-Schluessel und Haltezeit. Fetch und Cache sind Attrappen — kein Netz.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ICacheHandler } from '@martinschmieschek/slopdogs-core';
import { KennelRun, QueryRetriever, BodyRetriever } from '@martinschmieschek/slopdogs-core/runtime';
import { aggregate, hourlyRows, openMeteoUrl, parseLatLng, type DogClass } from '@martinschmieschek/slopdogs-openmeteo';
import { WindProfileRetriever, WindProfileQueryPact, type WindProfileResult } from '@martinschmieschek/slopdogs-dogs-wind';
import {
    SoilRetriever,
    SoilQueryPact,
    EvapotranspirationRetriever,
    EvapotranspirationQueryPact,
    type SoilResult,
    type EvapotranspirationResult,
} from '@martinschmieschek/slopdogs-dogs-soil';
import { SnowRetriever, SnowQueryPact, type SnowResult } from '@martinschmieschek/slopdogs-dogs-snow';
import { HumidityRetriever, HumidityQueryPact, type HumidityResult } from '@martinschmieschek/slopdogs-dogs-humidity';
import { ThunderstormRetriever, ThunderstormQueryPact, capeLevel, type ThunderstormResult } from '@martinschmieschek/slopdogs-dogs-storm';

/** Antwort im Open-Meteo-Format: zwei Tage, jede angefragte Variable mit Wert = Stundenindex, Einheit "u:<variable>". */
function fakeResponse(url: string, valueOf: (variable: string, i: number) => number | null = (_v, i) => i): unknown {
    const vars = (new URL(url).searchParams.get('hourly') ?? '').split(',');
    const time = Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? '23' : '24'}T${String(i % 24).padStart(2, '0')}:00`);
    const hourly: Record<string, unknown[]> = { time };
    const hourly_units: Record<string, string> = { time: 'iso8601' };
    for (const v of vars) {
        hourly[v] = time.map((_, i) => valueOf(v, i));
        hourly_units[v] = `u:${v}`;
    }
    return { latitude: 47.4, longitude: 10.98, elevation: 2962, timezone: 'Europe/Berlin', utc_offset_seconds: 3600, hourly, hourly_units };
}

class Recorder {
    readonly keys: string[] = [];
    readonly ttls: number[] = [];
    getTileFeatureCache(): undefined {
        return undefined;
    }
    async getOrFetch<T>(key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
        this.keys.push(key);
        this.ttls.push(ttl);
        return factory();
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

async function run<R>(
    dog: unknown,
    pact: unknown,
    query: Record<string, string>,
    valueOf?: (variable: string, i: number) => number | null,
): Promise<{ result: R; url: URL; cache: Recorder }> {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify(fakeResponse(String(url), valueOf)), { status: 200 });
    }) as typeof fetch;
    const cache = new Recorder();
    try {
        const D = dog as DogClass;
        const map = new Map<string, DogClass>();
        for (const C of [QueryRetriever, BodyRetriever, D, supplier(pact, query)] as DogClass[]) map.set(new C().name, C);
        const name = new D().name;
        const season = await new KennelRun(
            { id: 'test-open-meteo', dogIds: [`base:${name}`, 'base:TestQuery'] },
            map,
            undefined,
            {},
            undefined,
            [],
            cache as unknown as ICacheHandler,
        ).run();
        const result = season.exhausted.find((x) => x.name === name)?.collected as R | undefined;
        assert.ok(result, `${name} lieferte nichts`);
        return { result, url: new URL(urls[0]), cache };
    } finally {
        globalThis.fetch = realFetch;
    }
}

const PLACE = { lat: '47.42', lng: '10.98' };

test('openmeteo: URL mit Ortszeit und m/s, mehr als 10 Variablen wirft', () => {
    const url = new URL(openMeteoUrl('https://api.open-meteo.com/v1/forecast', 1.5, 2.5, { hourly: 'a,b', forecast_days: 2 }));
    assert.equal(url.searchParams.get('latitude'), '1.5');
    assert.equal(url.searchParams.get('timezone'), 'auto');
    assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
    assert.equal(url.searchParams.get('forecast_days'), '2');
    assert.throws(() => openMeteoUrl('https://x', 0, 0, { hourly: 'a,b,c,d,e,f,g,h,i,j,k' }), /11 hourly variables/);
});

test('openmeteo: Zeilen, Aggregat ohne null, Ortspruefung', () => {
    const rows = hourlyRows({ latitude: 0, longitude: 0, timezone: 'GMT', hourly: { time: ['t0', 't1'], x: [1, null] } }, { mine: 'x' });
    assert.deepEqual(rows, [
        { time: 't0', mine: 1 },
        { time: 't1', mine: null },
    ]);
    assert.equal(aggregate([1, null, 2], 'sum'), 3);
    assert.equal(aggregate([1, null, 2], 'mean'), 1.5);
    assert.equal(aggregate([null], 'max'), null);
    assert.throws(() => parseLatLng({ lat: 'x', lng: '1' }, 'D'), /D: Missing or invalid/);
});

test('WindProfileRetriever: vier Hoehen, Boeen, Tagesmaximum, 30 min', async () => {
    const { result, url, cache } = await run<WindProfileResult>(WindProfileRetriever, WindProfileQueryPact, { ...PLACE, days: '2' });
    assert.equal(url.host, 'api.open-meteo.com');
    assert.equal(url.searchParams.get('hourly')?.split(',').length, 9);
    assert.equal(result.hours[5].speed180m, 5);
    assert.equal(result.days[0].gustMax, 23);
    assert.equal(result.days[1].speed120mMean, 35.5);
    assert.equal(result.units.speed120m, 'u:wind_speed_120m');
    assert.match(cache.keys[0], /^wind:.*days=2/);
    assert.deepEqual(cache.ttls, [30 * 60_000]);
});

test('SoilRetriever: fuenf Feuchte-, vier Temperaturtiefen, Tagesmittel, 1 h', async () => {
    const { result, url, cache } = await run<SoilResult>(SoilRetriever, SoilQueryPact, PLACE);
    assert.equal(url.searchParams.get('hourly')?.split(',').length, 9);
    assert.equal(url.searchParams.get('forecast_days'), '3');
    assert.equal(result.hours[2].moisture27to81cm, 2);
    assert.equal(result.days[0].temperature6cmMean, 11.5);
    assert.match(cache.keys[0], /^soil:/);
    assert.deepEqual(cache.ttls, [60 * 60_000]);
});

test('EvapotranspirationRetriever: Tagesbilanz Niederschlag minus ET0', async () => {
    const value = (v: string, i: number) => (v === 'precipitation' ? (i < 24 ? 0.5 : 0) : v === 'et0_fao_evapotranspiration' ? 0.25 : i);
    const { result, url } = await run<EvapotranspirationResult>(EvapotranspirationRetriever, EvapotranspirationQueryPact, PLACE, value);
    assert.equal(url.searchParams.get('forecast_days'), '7');
    assert.deepEqual(
        result.days.map((d) => [d.precipitationSum, d.et0Sum, d.waterBalance]),
        [
            [12, 6, 6],
            [0, 6, -6],
        ],
    );
});

test('SnowRetriever: Neuschnee-Summe, tiefste Schneefallgrenze', async () => {
    const value = (v: string, i: number) => (v === 'snowfall' ? 1 : v === 'snowfall_height' ? 2000 - i * 10 : i);
    const { result, cache } = await run<SnowResult>(SnowRetriever, SnowQueryPact, PLACE, value);
    assert.equal(result.days[0].snowfallSum, 24);
    assert.equal(result.days[0].snowfallHeightMin, 1770);
    assert.equal(result.hours[0].snowfallHeight, 2000);
    assert.match(cache.keys[0], /^snow:.*days=7/);
});

test('ThunderstormRetriever: Gewitterstunden, CAPE-Stufe, 15 min', async () => {
    const value = (v: string, i: number) =>
        v === 'weather_code' ? (i === 15 ? 95 : 3) : v === 'cape' ? (i < 24 ? 120 : 1800) : v === 'lightning_potential' ? null : i;
    const { result, cache } = await run<ThunderstormResult>(ThunderstormRetriever, ThunderstormQueryPact, PLACE, value);
    assert.equal(result.hours[15].thunder, true);
    assert.equal(result.hours[14].thunder, false);
    assert.deepEqual(
        result.days.map((d) => [d.thunderHours, d.level, d.lightningPotentialMax]),
        [
            [1, 'low', null],
            [0, 'elevated', null],
        ],
    );
    assert.deepEqual(cache.ttls, [15 * 60_000]);
    assert.deepEqual([capeLevel(null), capeLevel(299), capeLevel(300), capeLevel(2500)], ['unknown', 'low', 'moderate', 'high']);
});

test('HumidityRetriever: Variablen, Tageswerte, 30 min je 1-km-Zelle', async () => {
    const value = (v: string, i: number) =>
        v === 'relative_humidity_2m' ? (i < 24 ? 80 + (i % 2) * 10 : 70) : v === 'wet_bulb_temperature_2m' ? -i : i;
    const { result, url, cache } = await run<HumidityResult>(HumidityRetriever, HumidityQueryPact, PLACE, value);
    assert.equal(
        url.searchParams.get('hourly'),
        'temperature_2m,relative_humidity_2m,dew_point_2m,wet_bulb_temperature_2m,vapour_pressure_deficit',
    );
    assert.equal(url.searchParams.get('forecast_days'), '7');
    assert.equal(result.hours[1].relativeHumidity, 90);
    assert.deepEqual(
        result.days.map((d) => [d.relativeHumidityMean, d.relativeHumidityMax, d.wetBulbTemperatureMin]),
        [
            [85, 90, -23],
            [70, 70, -47],
        ],
    );
    assert.equal(result.units.dewPoint, 'u:dew_point_2m');
    assert.equal(result.source, 'Open-Meteo.com (CC BY 4.0)');
    assert.match(cache.keys[0], /^humidity:.*days=7/);
    assert.deepEqual(cache.ttls, [30 * 60_000]);
});
