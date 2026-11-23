/**
 * Zellen-Speicher (slopdogs-openmeteo, PLAN-OPEN-METEO-DOGS S3): Treffer, Teil-Fehlschlag, Ueberlappung,
 * Buendelungsfenster, Achsenwechsel, Budget und Gewicht. Fetch ist eine Attrappe, der Cache liegt im Speicher.
 */

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    CELL_TTL_MS,
    OPEN_METEO_AIR_QUALITY_URL,
    OPEN_METEO_FORECAST_URL,
    OPEN_METEO_SATELLITE_URL,
    fetchCellVariables,
    forecastCellRequest,
    openMeteoBudget,
    openMeteoBudgetStatus,
    openMeteoCallWeight,
    openMeteoCellKey,
    openMeteoVariableTtlMs,
    hourlyRows,
    type CellRequest,
} from '@martinschmieschek/slopdogs-openmeteo';
import { SolarRadiationRetriever, SolarRadiationQueryPact } from '@martinschmieschek/slopdogs-dogs-solar';
import { HumidityRetriever, HumidityQueryPact, type HumidityResult } from '@martinschmieschek/slopdogs-dogs-humidity';
import { SnowRetriever, SnowQueryPact } from '@martinschmieschek/slopdogs-dogs-snow';
import { FakeOpenMeteo, MemoryCacheHandler, fakeOpenMeteoResponse, runDog, runDogWithStats } from './support/openMeteoKit';

const LAT = 51.7189;
const LNG = 8.7575;
const HOUR = 60 * 60_000;

const req = (hourly: string[], maxAgeMs = HOUR): CellRequest => forecastCellRequest(LAT, LNG, { hourly }, maxAgeMs);

const hourlyOf = (url: string) => new URL(url).searchParams.get('hourly')?.split(',') ?? [];

let fake: FakeOpenMeteo;
let cache: MemoryCacheHandler;

beforeEach(() => {
    openMeteoBudget.reset();
    fake = new FakeOpenMeteo();
    cache = new MemoryCacheHandler();
});
afterEach(() => fake.restore());

test('Treffer: zweite Anfrage derselben Variablen ruft nicht ab', async () => {
    const first = await fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover']));
    const second = await fetchCellVariables(cache.asHandler(), req(['cloud_cover']));
    assert.equal(fake.urls.length, 1);
    assert.deepEqual(second.hourly?.cloud_cover, first.hourly?.cloud_cover);
    assert.deepEqual(Object.keys(second.hourly ?? {}), ['time', 'cloud_cover'], 'nur die gefragten Variablen');
    assert.deepEqual(Object.keys(second.hourly_units ?? {}), ['time', 'cloud_cover']);
    assert.equal(second.stale, false);
    assert.equal(second.fetchedAt, first.fetchedAt);
    assert.equal(hourlyRows(second, { cc: 'cloud_cover' }).length, 7 * 24, 'Helfer lesen die Form weiter');
});

test('Teil-Fehlschlag: der Abschnitt der Anfrage kommt ganz aus einem Abruf, ein Eintrag je Zelle mit 2 h Haltezeit', async () => {
    const first = await fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover']));
    await new Promise((r) => setTimeout(r, 5));
    const r = await fetchCellVariables(cache.asHandler(), req(['cloud_cover', 'snowfall']));
    assert.equal(fake.urls.length, 2);
    assert.deepEqual(hourlyOf(fake.urls[1]), ['cloud_cover', 'snowfall'], 'fehlt snowfall, kommt cloud_cover mit (ein Modelllauf)');
    assert.ok(r.fetchedAt > first.fetchedAt, 'fetchedAt = aelteste zurueckgegebene Variable, hier beide neu');
    const kept = await fetchCellVariables(cache.asHandler(), req(['temperature_2m']));
    assert.equal(kept.fetchedAt, first.fetchedAt, 'temperature_2m bleibt aus dem ersten Abruf gespeichert');
    assert.equal(fake.urls.length, 2);
    assert.ok(r.hourly?.cloud_cover && r.hourly.snowfall);
    assert.equal(cache.cellKeys().length, 1, 'ein Eintrag je Zelle, nicht je Variable');
    const key = cache.cellKeys()[0];
    const entry = cache.store.get(key) as { value: unknown; expires: number };
    assert.equal(key, openMeteoCellKey(req([])));
    assert.deepEqual(Object.keys((entry.value as { sections: { hourly: { variables: object } } }).sections.hourly.variables).sort(), [
        'cloud_cover',
        'snowfall',
        'temperature_2m',
    ]);
    assert.ok(Math.abs(entry.expires - Date.now() - CELL_TTL_MS) < 1000, 'jedes Schreiben verlaengert auf 2 h');
});

test('Zu alt fuer maxAge: die Variable wird neu geholt', async () => {
    await fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover']));
    await new Promise((r) => setTimeout(r, 5));
    await fetchCellVariables(cache.asHandler(), req(['cloud_cover'], 1));
    assert.equal(fake.urls.length, 2);
    assert.deepEqual(hourlyOf(fake.urls[1]), ['cloud_cover']);
});

test('Ueberlappung und Buendelung: gleichzeitige Anfragen werden ein Abruf, gemeinsame Variablen einmal', async () => {
    const [a, b] = await Promise.all([
        fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover'])),
        fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'snowfall'])),
    ]);
    assert.equal(fake.urls.length, 1);
    assert.deepEqual(hourlyOf(fake.urls[0]), ['cloud_cover', 'snowfall', 'temperature_2m']);
    assert.deepEqual(Object.keys(a.hourly ?? {}), ['time', 'temperature_2m', 'cloud_cover']);
    assert.deepEqual(Object.keys(b.hourly ?? {}), ['time', 'temperature_2m', 'snowfall']);
});

test('Buendelung: Solar, Feuchte und Schnee gleichzeitig an einer Zelle = ein Abruf an der Zellmitte', async () => {
    const place = { lat: String(LAT), lng: String(LNG), days: '3' };
    await Promise.all([
        runDog(SolarRadiationRetriever, SolarRadiationQueryPact, place, cache.asHandler()),
        runDog(HumidityRetriever, HumidityQueryPact, place, cache.asHandler()),
        runDog(SnowRetriever, SnowQueryPact, place, cache.asHandler()),
    ]);
    assert.equal(fake.urls.length, 1);
    const url = new URL(fake.urls[0]);
    assert.equal(url.searchParams.get('forecast_days'), '7');
    assert.equal(hourlyOf(fake.urls[0]).length, 16, '7 + 5 + 6 Variablen, temperature_2m einmal');
    assert.notEqual(url.searchParams.get('latitude'), String(LAT), 'abgerufen wird die Zellmitte, nicht der erste Punkt');
});

test('Identische Abrufe ohne Cache laufen nur einmal', async () => {
    await Promise.all([fetchCellVariables(undefined, req(['snowfall'])), fetchCellVariables(undefined, req(['snowfall']))]);
    assert.equal(fake.urls.length, 1);
    assert.equal(new URL(fake.urls[0]).searchParams.get('latitude'), String(LAT), 'ohne Cache: der Punkt selbst');
});

/** Ersetzt die Attrappe durch eine eigene Antwort-Funktion; liefert die abgerufenen URLs. */
function stubFetch(body: (url: string) => unknown): { urls: string[]; restore: () => void } {
    fake.restore();
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
        urls.push(String(input));
        return new Response(JSON.stringify(body(String(input))), { status: 200 });
    }) as typeof fetch;
    return {
        urls,
        restore: () => {
            globalThis.fetch = realFetch;
        },
    };
}

test('Neue Zeitachse ersetzt den Abschnitt; weggefallene Variablen werden einmal nachgeholt', async () => {
    let day = '2026-11-23';
    const stub = stubFetch((url) => {
        const body = fakeOpenMeteoResponse(url) as { hourly: Record<string, unknown[]> };
        body.hourly.time = (body.hourly.time as string[]).map((t) => `${day}${t.slice(10)}`);
        return body;
    });
    try {
        const ten = Array.from({ length: 10 }, (_, i) => `v${i}`);
        await fetchCellVariables(cache.asHandler(), req(ten));
        day = '2026-11-24';
        const [t, s] = await Promise.all([
            fetchCellVariables(cache.asHandler(), req(ten)),
            fetchCellVariables(cache.asHandler(), req(['snowfall'])),
        ]);
        assert.deepEqual(stub.urls.map(hourlyOf), [ten, ['snowfall'], ten], '11 > 10: nur snowfall, dann die weggefallenen zehn');
        assert.equal((t.hourly?.time as string[])[0], '2026-11-24T00:00', 'keine Mischung zweier Achsen');
        assert.equal(Object.keys(t.hourly ?? {}).length, 11);
        assert.equal((s.hourly?.time as string[])[0], '2026-11-24T00:00');
    } finally {
        stub.restore();
    }
});

test('current und hourly bleiben getrennt: dieselbe Variable mit zwei Werten, keiner fuellt den anderen', async () => {
    const stub = stubFetch((url) => {
        const body = fakeOpenMeteoResponse(url) as { current?: Record<string, unknown> };
        if (body.current) body.current.temperature_2m = 99;
        return body;
    });
    try {
        const both = { ...req(['temperature_2m']), current: ['temperature_2m'] };
        await fetchCellVariables(cache.asHandler(), both);
        const r = await fetchCellVariables(cache.asHandler(), both);
        assert.equal(stub.urls.length, 1);
        assert.equal(r.current?.temperature_2m, 99);
        assert.notEqual((r.hourly?.temperature_2m as number[])[12], 99);
        assert.deepEqual(Object.keys(r.current ?? {}), ['time', 'interval', 'temperature_2m']);

        const onlyHourly = await fetchCellVariables(cache.asHandler(), req(['temperature_2m']));
        assert.equal(onlyHourly.current, undefined, 'hourly-Anfrage bekommt kein current');
        await fetchCellVariables(cache.asHandler(), { ...req([]), current: ['relative_humidity_2m'] });
        assert.deepEqual(hourlyOf(stub.urls[1]), [], 'current-Anfrage holt kein hourly');
        assert.equal(new URL(stub.urls[1]).searchParams.get('current'), 'relative_humidity_2m');
    } finally {
        stub.restore();
    }
});

test('current gilt hoechstens 15 min, auch wenn der Dog 1 h erlaubt; neue current-Zeit ersetzt den Abschnitt', async () => {
    let time = '2026-11-23T12:00';
    const stub = stubFetch((url) => {
        const body = fakeOpenMeteoResponse(url) as { current?: Record<string, unknown> };
        if (body.current) body.current.time = time;
        return body;
    });
    const t0 = Date.now();
    mock.timers.enable({ apis: ['Date'], now: t0 });
    try {
        const both = { ...req(['temperature_2m', 'cloud_cover'], HOUR), current: ['temperature_2m', 'cloud_cover'] };
        await fetchCellVariables(cache.asHandler(), both);
        mock.timers.setTime(t0 + 14 * 60_000);
        await fetchCellVariables(cache.asHandler(), both);
        assert.equal(stub.urls.length, 1);

        time = '2026-11-23T12:15';
        mock.timers.setTime(t0 + 16 * 60_000);
        await fetchCellVariables(cache.asHandler(), { ...req([], HOUR), current: ['temperature_2m'] });
        assert.equal(stub.urls.length, 2);
        assert.equal(new URL(stub.urls[1]).searchParams.get('current'), 'temperature_2m');
        assert.equal(new URL(stub.urls[1]).searchParams.get('hourly'), null, 'hourly ist noch frisch');

        const r = await fetchCellVariables(cache.asHandler(), both);
        assert.equal(stub.urls.length, 3, 'cloud_cover fiel mit der alten current-Zeit weg');
        assert.equal(new URL(stub.urls[2]).searchParams.get('current'), 'cloud_cover,temperature_2m');
        assert.equal(r.current?.time, '2026-11-23T12:15');
    } finally {
        mock.timers.reset();
        stub.restore();
    }
});

test('Gemessen und Vorhersage: Satellit und Vorhersage derselben Zelle sind getrennte Eintraege', async () => {
    const forecast = req(['shortwave_radiation']);
    const satellite: CellRequest = {
        api: OPEN_METEO_SATELLITE_URL,
        lat: LAT,
        lng: LNG,
        params: { models: 'satellite_radiation_seamless', past_days: 7, forecast_days: 1 },
        hourly: ['shortwave_radiation'],
        maxAgeMs: HOUR,
    };
    const [f, s] = await Promise.all([fetchCellVariables(cache.asHandler(), forecast), fetchCellVariables(cache.asHandler(), satellite)]);
    assert.equal(fake.urls.length, 2);
    assert.equal(cache.cellKeys().length, 2);
    assert.notEqual(openMeteoCellKey(forecast), openMeteoCellKey(satellite));
    assert.notDeepEqual(f.hourly?.time, s.hourly?.time, 'eigene Zeitachse: 7 Tage zurueck statt 7 voraus');
});

test('TTL je Variable: Klassen current 15 min, schnell 30 min, traege 60 min, astronomisch 24 h, Unbekanntes 30 min', () => {
    assert.deepEqual(
        [
            openMeteoVariableTtlMs('current', 'temperature_2m'),
            openMeteoVariableTtlMs('hourly', 'temperature_2m'),
            openMeteoVariableTtlMs('hourly', 'cape'),
            openMeteoVariableTtlMs('hourly', 'soil_temperature_0cm'),
            openMeteoVariableTtlMs('hourly', 'soil_temperature_54cm'),
            openMeteoVariableTtlMs('hourly', 'snow_depth'),
            openMeteoVariableTtlMs('daily', 'sunrise'),
            openMeteoVariableTtlMs('daily', 'sunshine_duration'),
            openMeteoVariableTtlMs('hourly', 'something_new'),
            openMeteoVariableTtlMs('current', 'pm10', OPEN_METEO_AIR_QUALITY_URL),
            openMeteoVariableTtlMs('current', 'temperature_2m', OPEN_METEO_FORECAST_URL),
        ].map((ms) => ms / 60_000),
        [15, 30, 30, 30, 60, 60, 1440, 30, 30, 60, 15],
        'current: Vorhersage 15 min, Luftqualitaet (CAMS, stuendlich) 60 min',
    );
});

/** Laesst die Uhr laufen: Date ist gemockt, setTimeout bleibt echt (Buendelungsfenster). */
function clock(): { at: (minutes: number) => void } {
    const t0 = Date.now();
    mock.timers.enable({ apis: ['Date'], now: t0 });
    return { at: (minutes) => mock.timers.setTime(t0 + minutes * 60_000) };
}

test('Traege Variablen bleiben unberuehrt, waehrend schnelle aufgefrischt werden', async () => {
    const time = clock();
    try {
        await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 2 * HOUR));
        await fetchCellVariables(cache.asHandler(), req(['temperature_2m'], 2 * HOUR));
        time.at(31);
        const fast = await fetchCellVariables(cache.asHandler(), req(['temperature_2m'], 2 * HOUR));
        assert.deepEqual(hourlyOf(fake.urls[2]), ['temperature_2m']);
        time.at(45);
        const slow = await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 2 * HOUR));
        assert.equal(fake.urls.length, 3, 'frische traege Variable loest keinen Abruf aus');
        assert.ok(slow.fetchedAt < fast.fetchedAt, 'snow_depth stammt noch aus dem ersten Abruf');
    } finally {
        mock.timers.reset();
    }
});

test('Mitnahme bis 10 Variablen: ein faelliger Wert holt die uebrigen gefragten des Abschnitts mit', async () => {
    const time = clock();
    try {
        await fetchCellVariables(cache.asHandler(), req(['snow_depth', 'temperature_2m'], 2 * HOUR));
        time.at(31);
        const r = await fetchCellVariables(cache.asHandler(), req(['snow_depth', 'temperature_2m'], 2 * HOUR));
        assert.deepEqual(hourlyOf(fake.urls[1]), ['snow_depth', 'temperature_2m'], 'kostet nichts, ein Modelllauf');
        assert.equal(r.fetchedAt, Date.now());
        assert.equal(r.stale, false);
    } finally {
        mock.timers.reset();
    }
});

test('Keine Mitnahme ueber 10: nur faellige plus die gefragten derselben TTL-Klasse', async () => {
    const slow = ['soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm', 'soil_moisture_3_to_9cm', 'snow_depth'];
    const fast = ['temperature_2m', 'cloud_cover', 'precipitation', 'cape', 'wind_gusts_10m', 'dew_point_2m'];
    const time = clock();
    try {
        await fetchCellVariables(cache.asHandler(), req([...slow, ...fast], 2 * HOUR));
        time.at(5);
        await fetchCellVariables(cache.asHandler(), req(['relative_humidity_2m'], 2 * HOUR));
        time.at(31);
        const r = await fetchCellVariables(cache.asHandler(), req([...slow, ...fast, 'relative_humidity_2m'], 2 * HOUR));
        assert.deepEqual(hourlyOf(fake.urls[1]), ['relative_humidity_2m'], 'Neues allein: es ist nichts veraltet');
        assert.deepEqual(hourlyOf(fake.urls[2]), [...fast, 'relative_humidity_2m'].sort(), '12 > 10: nur die schnelle Klasse');
        assert.equal(Object.keys(r.hourly ?? {}).length, 13);
        assert.ok(r.fetchedAt < Date.now(), 'fetchedAt ist der aelteste Wert (die traegen)');
    } finally {
        mock.timers.reset();
    }
});

test('maxAge des Dogs verkuerzt nur, verlaengert nie', async () => {
    const time = clock();
    try {
        await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 10 * HOUR));
        time.at(59);
        await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 10 * HOUR));
        assert.equal(fake.urls.length, 1);
        time.at(61);
        await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 10 * HOUR));
        assert.equal(fake.urls.length, 2, '10 h vom Dog helfen nicht: snow_depth gilt 60 min');
        time.at(72);
        await fetchCellVariables(cache.asHandler(), req(['snow_depth'], 10 * 60_000));
        assert.equal(fake.urls.length, 3, '10 min vom Dog gelten: strenger als die Klasse');
    } finally {
        mock.timers.reset();
    }
});

test('Budget erschoepft: Gespeichertes kommt mit stale, leere Zelle wirft lesbar', async () => {
    const place = { lat: String(LAT), lng: String(LNG) };
    const fresh = await runDog<HumidityResult>(HumidityRetriever, HumidityQueryPact, place, cache.asHandler());
    assert.equal('stale' in fresh, false, 'frische Ergebnisse tragen kein stale');

    mock.timers.enable({ apis: ['Date'], now: Date.now() + 31 * 60_000 });
    try {
        assert.ok(openMeteoBudget.tryConsume(500), 'Minute auf 500 auffuellen');
        const humidity = await runDog<HumidityResult>(HumidityRetriever, HumidityQueryPact, place, cache.asHandler());
        assert.equal(humidity.stale, true, 'aelter als 30 min, aber das Budget ist voll');
        assert.deepEqual({ ...humidity, stale: undefined }, { ...fresh, stale: undefined });

        await assert.rejects(
            fetchCellVariables(cache.asHandler(), { ...req(['temperature_2m']), lat: 48.1, lng: 11.6 }),
            /Open-Meteo budget reached, retry in \d+ s/,
        );
        await assert.rejects(fetchCellVariables(cache.asHandler(), req(['snowfall'])), /Open-Meteo budget reached, retry in \d+ s/);
        assert.equal(fake.urls.length, 1, 'kein Abruf ueber dem Budget');
    } finally {
        mock.timers.reset();
    }
});

/** Antwortet mit einem Fehler: HTTP-Status, Netzfehler oder Timeout. */
function failingFetch(kind: number | 'network' | 'timeout'): { urls: string[]; restore: () => void } {
    fake.restore();
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
        urls.push(String(input));
        if (kind === 'network') throw new TypeError('fetch failed');
        if (kind === 'timeout') throw new DOMException('This operation was aborted', 'AbortError');
        return new Response('{"error":true,"reason":"test"}', { status: kind });
    }) as typeof fetch;
    return {
        urls,
        restore: () => {
            globalThis.fetch = realFetch;
        },
    };
}

for (const kind of [429, 503, 'network', 'timeout'] as const) {
    test(`Upstream scheitert (${kind}): alles gespeichert → Gespeichertes mit stale, kein Fehler`, async () => {
        const first = await fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover']));
        const time = clock();
        const failing = failingFetch(kind);
        try {
            time.at(31);
            const r = await fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'cloud_cover']));
            assert.equal(failing.urls.length, 1, 'es wurde versucht');
            assert.equal(r.stale, true);
            assert.deepEqual(r.hourly, first.hourly);
            assert.equal(r.fetchedAt, first.fetchedAt);
        } finally {
            mock.timers.reset();
            failing.restore();
        }
    });
}

test('Upstream scheitert: nur teilweise gespeichert → der Fehler bleibt; 400 bleibt immer ein Fehler', async () => {
    await fetchCellVariables(cache.asHandler(), req(['temperature_2m']));
    let failing = failingFetch(503);
    try {
        await assert.rejects(fetchCellVariables(cache.asHandler(), req(['temperature_2m', 'snowfall'])), /Open-Meteo forecast failed: 503/);
    } finally {
        failing.restore();
    }
    const time = clock();
    failing = failingFetch(400);
    try {
        time.at(31);
        await assert.rejects(fetchCellVariables(cache.asHandler(), req(['temperature_2m'])), /Open-Meteo forecast failed: 400/);
    } finally {
        mock.timers.reset();
        failing.restore();
    }
});

test('Cache-Statistik (withDogCacheStats aus core): jede Anfrage zaehlt genau einmal', async () => {
    const place = { lat: String(LAT), lng: String(LNG), days: '3' };
    const wave = () =>
        Promise.all([
            runDogWithStats<{ stale?: boolean }>(SolarRadiationRetriever, SolarRadiationQueryPact, place, cache.asHandler()),
            runDogWithStats<{ stale?: boolean }>(HumidityRetriever, HumidityQueryPact, place, cache.asHandler()),
            runDogWithStats<{ stale?: boolean }>(SnowRetriever, SnowQueryPact, place, cache.asHandler()),
        ]);
    const tally = (runs: Array<{ stats: { hits: number; misses: number } }>) => ({
        hits: runs.reduce((n, r) => n + r.stats.hits, 0),
        misses: runs.reduce((n, r) => n + r.stats.misses, 0),
        each: runs.map((r) => r.stats.hits + r.stats.misses),
    });

    assert.deepEqual(tally(await wave()), { hits: 2, misses: 1, each: [1, 1, 1] }, 'ein Abruf: Ausloeser Fehlschlag, Partner Treffer');
    assert.deepEqual(tally(await wave()), { hits: 3, misses: 0, each: [1, 1, 1] }, 'aus dem Eintrag: Treffer');
    assert.equal(fake.urls.length, 1);

    const time = clock();
    try {
        time.at(31);
        assert.ok(openMeteoBudget.tryConsume(500));
        const budgetStale = await wave();
        assert.deepEqual(tally(budgetStale), { hits: 3, misses: 0, each: [1, 1, 1] }, 'Budget-stale zaehlt als Treffer');
        assert.ok(budgetStale.every((r) => r.result.stale === true));

        openMeteoBudget.reset();
        const failing = failingFetch(503);
        try {
            time.at(40);
            const errorStale = await wave();
            assert.deepEqual(tally(errorStale).each, [1, 1, 1], 'auch bei Fehler genau einmal');
            assert.ok(errorStale.every((r) => r.result.stale === true));
            assert.equal(failing.urls.length, 1);
        } finally {
            failing.restore();
        }
    } finally {
        mock.timers.reset();
    }
});

test('Gewicht nach Anbieter-Regel und Budget-Stand', async () => {
    assert.equal(openMeteoCallWeight(15, 14), 1.5);
    assert.equal(openMeteoCallWeight(5, 7), 1);
    assert.equal(openMeteoCallWeight(12, 7), 1.2);
    assert.equal(openMeteoCallWeight(10, 28), 2);
    assert.equal(Math.round(openMeteoCallWeight(40, 16) * 1000) / 1000, 4.571);

    await fetchCellVariables(cache.asHandler(), req(Array.from({ length: 15 }, (_, i) => `v${i}`)));
    assert.deepEqual(openMeteoBudgetStatus(), {
        minute: { used: 1.5, limit: 500 },
        hour: { used: 1.5, limit: 4500 },
        day: { used: 1.5, limit: 9000 },
    });
    assert.equal(
        openMeteoCellKey({ api: OPEN_METEO_FORECAST_URL, lat: LAT, lng: LNG, params: { b: 1, a: 2 } }).match(/:a=2:api=.*:b=1$/)?.length,
        1,
    );
});
