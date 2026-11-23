/**
 * dogs-rain-radar: Entpacken und Einheit, Projektion und Kacheln, geteilter Kachel-Cache, Laufwechsel,
 * stale bei Fehlern, Waechter, Pruefung der Abfrage. Bright Sky ist eine Attrappe, der Cache liegt im Speicher.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
    BRIGHT_SKY_REQUESTS_PER_MINUTE,
    RADAR_STEP_MS,
    RadarTile,
    RadarWindow,
    RainRadarQueryError,
    RainRadarQueryPact,
    RainRadarRetriever,
    RainRadarUnavailableError,
    RequestGuard,
    brightSkyGuard,
    decodeRadarFrame,
    fetchRadarTile,
    getRainRadar,
    gridPixelOf,
    parseRainRadarQuery,
    projectToRadar,
    radarSlot,
    radarSlotKey,
    rawToMmPerHour,
    type RainRadarParams,
    type RainRadarResult,
} from '@martinschmieschek/slopdogs-dogs-rain-radar';
import { MemoryCacheHandler, runDog } from './support/openMeteoKit';

const MINUTE = 60_000;
/** 23.11.2026 19:57 UTC — der Slot ist der Lauf 19:50. */
const NOW = Date.parse('2026-11-23T19:57:00Z');
const PADERBORN = { lat: 51.7189, lng: 8.7575 };
/** Bright Skys latlon_position fuer Paderborn (23.11.2026): bbox [513,451,…] + (2.448, 2.382), Pixelmitte = ganze Zahl. */
const PADERBORN_PIXEL = { x: 453, y: 515 };

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', '+00:00');

/** Rohwert der Attrappe: aus Zelle und Zeit, nicht aus der Lage in der Antwort. */
function fakeRaw(x: number, y: number, time: number): number {
    return (x % 7) + (y % 5) * 10 + ((time / RADAR_STEP_MS) % 3) * 100;
}

function encode(values: number[]): string {
    return deflateSync(Buffer.from(new Uint16Array(values).buffer)).toString('base64');
}

/** Bright Sky /radar fuer bbox-Abfragen: neuester Lauf `run` (Vorgabe: der Schritt nach `date`), 25 Frames je Lauf. */
class FakeBrightSky {
    readonly urls: string[] = [];
    run: number | undefined;
    status = 200;
    private readonly realFetch = globalThis.fetch;

    constructor() {
        globalThis.fetch = (async (input: string | URL) => {
            const url = new URL(String(input));
            this.urls.push(url.toString());
            await new Promise((r) => setTimeout(r, 5));
            if (this.status !== 200) return new Response('upstream says no', { status: this.status, statusText: 'Service Unavailable' });
            return new Response(JSON.stringify(this.answer(url)), { status: 200 });
        }) as typeof fetch;
    }

    private answer(url: URL): unknown {
        const [top, left, bottom, right] = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
        const from = Date.parse(url.searchParams.get('date') ?? '');
        const to = Date.parse(url.searchParams.get('last_date') ?? '');
        const run = this.run ?? from + RADAR_STEP_MS;
        const radar = [];
        for (let t = from; t <= Math.min(to, run + 120 * MINUTE); t += RADAR_STEP_MS) {
            const values: number[] = [];
            for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) values.push(fakeRaw(x, y, t));
            radar.push({ timestamp: iso(t), source: `RADARCOMP::RV::${iso(Math.min(t, run))}`, precipitation_5: encode(values) });
        }
        return { radar, geometry: { type: 'Polygon', coordinates: [] } };
    }

    restore(): void {
        globalThis.fetch = this.realFetch;
    }
}

const params = (over: Partial<RainRadarParams> = {}): RainRadarParams => ({ ...PADERBORN, radiusKm: 2, horizonMin: 120, ...over });

let fake: FakeBrightSky;
let cache: MemoryCacheHandler;

beforeEach(() => {
    brightSkyGuard.reset();
    fake = new FakeBrightSky();
    cache = new MemoryCacheHandler();
});
afterEach(() => fake.restore());

test('Entpacken: echte Bright-Sky-Antwort (Regen, 51×51 px) und Einheit 0,01 mm/5 min → mm/h', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'brightSkyRadarRain.json'), 'utf8'));
    const first = decodeRadarFrame(body.radar[0].precipitation_5, 51 * 51);
    assert.equal(first.length, 2601);
    assert.equal(first[29 * 51 + 27], 144);
    assert.equal(Math.max(...first), 144);
    assert.equal(rawToMmPerHour(144), 17.28);
    assert.equal(rawToMmPerHour(25), 3);
    assert.equal(rawToMmPerHour(1), 0.12);
    assert.equal(rawToMmPerHour(0), 0);
    assert.throws(() => decodeRadarFrame(body.radar[0].precipitation_5, 32 * 32), /2601 pixels, expected 1024/);

    fake.restore();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    try {
        const tile = await fetchRadarTile(new RadarTile(0, 0), NOW - 10 * MINUTE, NOW + 120 * MINUTE, NOW);
        assert.equal(tile.run, '2026-11-23T19:40:00Z', 'Lauf aus source RADARCOMP::RV::<Lauf>');
        assert.equal(tile.frames.length, 23);
        assert.equal(tile.frames[0].time, '2026-11-23T19:50:00Z');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('Projektion: DE1200-Ecken, Paderborn wie Bright Sky, Kachel und Fenster ueber eine Kachelgrenze', () => {
    for (const [lat, lng, x, y] of [
        [55.86208711, 1.46330151, -500, 500],
        [55.84543856, 18.73161645, 1099500, 500],
        [45.68460578, 16.58086935, 1099500, -1199500],
        [45.69642538, 3.566994635, -500, -1199500],
    ]) {
        const p = projectToRadar(lat, lng);
        assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, `Ecke ${lat},${lng}: ${p.x},${p.y}`);
    }
    assert.deepEqual(gridPixelOf(PADERBORN.lat, PADERBORN.lng), PADERBORN_PIXEL);

    const tile = RadarTile.containing(PADERBORN_PIXEL);
    assert.equal(tile.key, '14_16');
    assert.equal(tile.bbox, '512,448,543,479');
    assert.equal(new RadarTile(34, 37).bbox, '1184,1088,1199,1099', 'Randkachel schmaler');

    assert.deepEqual(
        new RadarWindow(PADERBORN_PIXEL, 2).tiles().map((t) => t.key),
        ['14_16'],
    );
    assert.deepEqual(
        new RadarWindow(PADERBORN_PIXEL, 5).tiles().map((t) => t.key),
        ['14_15', '14_16'],
        'Zeilen 510-520 kreuzen die Grenze bei 512',
    );
    assert.deepEqual(
        new RadarWindow(PADERBORN_PIXEL, 10).tiles().map((t) => t.key),
        ['13_15', '14_15', '13_16', '14_16'],
    );

    const corner = new RadarWindow({ x: 1, y: 1 }, 2);
    assert.equal(corner.coverage, 'partial');
    assert.equal(corner.pixelAt(0, 0), null);
    assert.deepEqual(corner.pixelAt(1, 1), { x: 0, y: 0 });
    assert.equal(new RadarWindow(gridPixelOf(30, -40)!, 10).coverage, 'none');
});

test('Ergebnis: 25 Schritte ab der Analyse, Raster Zeile 0 = Nord, Punktreihe = Mittelzelle, ueber eine Kachelgrenze', async () => {
    const result = await getRainRadar(params({ radiusKm: 5 }), cache.asHandler(), NOW);
    const run = Date.parse('2026-11-23T19:50:00Z');
    assert.equal(result.run, '2026-11-23T19:50:00Z');
    assert.equal(result.coverage, 'full');
    assert.deepEqual(result.location, { ...PADERBORN, gridX: 453, gridY: 515 });
    assert.equal(result.steps.length, 25);
    assert.deepEqual(result.steps[0], { time: '2026-11-23T19:50:00Z', forecast: false });
    assert.deepEqual(result.steps[24], { time: '2026-11-23T21:50:00Z', forecast: true });
    assert.equal(result.grid.size, 11);
    assert.equal(result.grid.rows.length, 25);
    assert.equal(result.grid.rows[0].length, 11);
    for (const [s, row, col] of [
        [0, 0, 0],
        [0, 10, 10],
        [3, 1, 4],
        [24, 7, 2],
    ]) {
        const x = 453 - 5 + col;
        const y = 515 - 5 + row;
        assert.equal(result.grid.rows[s][row][col], rawToMmPerHour(fakeRaw(x, y, run + s * RADAR_STEP_MS)), `step ${s} cell ${row},${col}`);
    }
    assert.deepEqual(
        result.point.map((p) => p.mmPerHour),
        result.grid.rows.map((r) => r[5][5]),
    );
    assert.equal(result.point[0].mmPerHour, rawToMmPerHour(fakeRaw(453, 515, run)));
    assert.equal(fake.urls.length, 2, 'zwei Kacheln');
    assert.equal(result.stale, undefined);
    assert.match(result.attribution, /Deutscher Wetterdienst \(CC BY 4\.0\)/);

    const short = await getRainRadar(params({ horizonMin: 0, radiusKm: 0 }), cache.asHandler(), NOW);
    assert.equal(short.steps.length, 1);
    assert.deepEqual(short.grid.rows, [[[short.point[0].mmPerHour]]]);
});

test('Cache: ein Abruf je Kachel und Slot, geteilt von zwei Anfragen (gleichzeitig und danach)', async () => {
    const nearby = { lat: 51.73, lng: 8.77 };
    assert.equal(RadarTile.containing(gridPixelOf(nearby.lat, nearby.lng)!).key, '14_16');
    const [a, b] = await Promise.all([
        getRainRadar(params(), cache.asHandler(), NOW),
        getRainRadar(params(nearby), cache.asHandler(), NOW),
    ]);
    assert.equal(fake.urls.length, 1);
    assert.equal(a.run, b.run);
    await getRainRadar(params(), cache.asHandler(), NOW + 2 * MINUTE);
    assert.equal(fake.urls.length, 1, 'gleicher Slot bis 19:62');

    const url = new URL(fake.urls[0]);
    assert.equal(url.searchParams.get('bbox'), '512,448,543,479');
    assert.equal(url.searchParams.get('date'), '2026-11-23T19:45:00Z', 'ein Schritt vor dem Slot');
    assert.equal(url.searchParams.get('last_date'), '2026-11-23T22:00:00Z');
    assert.equal(url.searchParams.get('format'), 'compressed');
    assert.ok(cache.store.has(radarSlotKey(new RadarTile(14, 16), radarSlot(NOW))));
    assert.equal(radarSlotKey(new RadarTile(14, 16), radarSlot(NOW)), 'rainradar:14_16:202611231950');
});

test('Slot: neuer Lauf 7 min nach der Laufzeit, er ersetzt den alten', async () => {
    assert.equal(radarSlot(Date.parse('2026-11-23T20:01:59Z')), Date.parse('2026-11-23T19:50:00Z'));
    assert.equal(radarSlot(Date.parse('2026-11-23T20:02:00Z')), Date.parse('2026-11-23T19:55:00Z'));

    const first = await getRainRadar(params(), cache.asHandler(), NOW);
    const later = await getRainRadar(params(), cache.asHandler(), NOW + 5 * MINUTE);
    assert.equal(first.run, '2026-11-23T19:50:00Z');
    assert.equal(later.run, '2026-11-23T19:55:00Z');
    assert.equal(later.steps[0].time, '2026-11-23T19:55:00Z');
    assert.equal(fake.urls.length, 2);
    assert.equal(
        cache.store.get('rainradar:14_16:last')?.value && (cache.store.get('rainradar:14_16:last')!.value as { run: string }).run,
        '2026-11-23T19:55:00Z',
    );

    fake.run = Date.parse('2026-11-23T19:55:00Z');
    const late = await getRainRadar(params(), cache.asHandler(), NOW + 10 * MINUTE);
    assert.equal(late.run, '2026-11-23T19:55:00Z', 'Bright Sky spaet: der vorige Lauf samt Analyse');
    assert.equal(late.point[0].mmPerHour, rawToMmPerHour(fakeRaw(453, 515, Date.parse('2026-11-23T19:55:00Z'))));
});

test('stale: 503 liefert den letzten Lauf der Kachel, ohne gespeicherten Lauf ein lesbarer Fehler', async () => {
    const fresh = await getRainRadar(params(), cache.asHandler(), NOW);
    fake.status = 503;
    const stale = await getRainRadar(params(), cache.asHandler(), NOW + 5 * MINUTE);
    assert.equal(stale.stale, true);
    assert.equal(stale.run, fresh.run);
    assert.deepEqual(stale.point, fresh.point);

    await assert.rejects(
        getRainRadar(params(), new MemoryCacheHandler().asHandler(), NOW),
        (e: unknown) =>
            e instanceof RainRadarUnavailableError &&
            /Bright Sky radar failed: 503/.test(e.message) &&
            /no earlier radar run is stored/.test(e.message),
    );
    await assert.rejects(getRainRadar(params(), undefined, NOW), RainRadarUnavailableError, 'ohne Cache ebenso');

    fake.status = 400;
    await assert.rejects(
        getRainRadar(params(), cache.asHandler(), NOW + 10 * MINUTE),
        /Bright Sky radar failed: 400/,
        '400 bleibt ein Fehler',
    );
});

test('Waechter: 60 Abrufe je Minute, darueber stale ohne Abruf', async () => {
    const guard = new RequestGuard(BRIGHT_SKY_REQUESTS_PER_MINUTE);
    for (let i = 0; i < 60; i++) assert.equal(guard.tryConsume(NOW + i * 100), true);
    assert.equal(guard.tryConsume(NOW + 6000), false);
    assert.equal(guard.retryInSeconds(NOW + 6000), 54);
    assert.equal(guard.tryConsume(NOW + MINUTE + 1), true, 'der erste Abruf ist aus dem Fenster');

    await getRainRadar(params(), cache.asHandler(), NOW);
    for (let i = 0; i < 60; i++) brightSkyGuard.tryConsume(NOW + 5 * MINUTE);
    const calls = fake.urls.length;
    const guarded = await getRainRadar(params(), cache.asHandler(), NOW + 5 * MINUTE);
    assert.equal(fake.urls.length, calls, 'kein Abruf ueber den Waechter hinaus');
    assert.equal(guarded.stale, true);
    await assert.rejects(getRainRadar(params(), undefined, NOW + 5 * MINUTE), /request limit \(60\/min\) reached, retry in \d+ s/);
});

test('Pruefung: klare Fehler, Vorgaben radiusKm 2 und horizonMin 120', () => {
    assert.deepEqual(parseRainRadarQuery({ lat: '51.7', lng: '8.75' }), { lat: 51.7, lng: 8.75, radiusKm: 2, horizonMin: 120 });
    assert.deepEqual(parseRainRadarQuery({ lat: '51.7', lng: '8.75', radiusKm: '0', horizonMin: '35' }), {
        lat: 51.7,
        lng: 8.75,
        radiusKm: 0,
        horizonMin: 35,
    });
    const fails: Array<[Record<string, string>, RegExp]> = [
        [{ lng: '8' }, /lat is required and must be a number between -90 and 90 \(got null\)/],
        [{ lat: 'abc', lng: '8' }, /lat is required .* \(got "abc"\)/],
        [{ lat: '51', lng: '181' }, /lng is required and must be a number between -180 and 180/],
        [{ lat: '51', lng: '8', radiusKm: '11' }, /radiusKm must be a whole number of km from 0 to 10 \(got "11"\)/],
        [{ lat: '51', lng: '8', radiusKm: '1.5' }, /radiusKm must be a whole number/],
        [{ lat: '51', lng: '8', radiusKm: '-1' }, /radiusKm must be/],
        [{ lat: '51', lng: '8', horizonMin: '7' }, /horizonMin must be a number of minutes from 0 to 120 in steps of 5 \(got "7"\)/],
        [{ lat: '51', lng: '8', horizonMin: '125' }, /horizonMin must be/],
    ];
    for (const [query, message] of fails) {
        assert.throws(
            () => parseRainRadarQuery(query),
            (e: unknown) => e instanceof RainRadarQueryError && message.test(e.message) && e.message.startsWith('RainRadarRetriever: '),
            JSON.stringify(query),
        );
    }
});

test('Dog: RainRadarRetriever im Kennel ueber den Pact, ausserhalb des Gitters ohne Abruf', async () => {
    const result = await runDog<RainRadarResult>(
        RainRadarRetriever,
        RainRadarQueryPact,
        { lat: '51.7189', lng: '8.7575', radiusKm: '1', horizonMin: '30' },
        cache.asHandler(),
    );
    assert.equal(result.steps.length, 7);
    assert.equal(result.grid.rows[0].length, 3);
    assert.equal(fake.urls.length, 1);
    assert.ok(new RainRadarRetriever().description.includes('advection'));

    const away = await getRainRadar(params({ lat: 30, lng: -40 }), cache.asHandler(), NOW);
    assert.equal(away.coverage, 'none');
    assert.equal(away.run, null);
    assert.deepEqual(away.steps, []);
    assert.equal(fake.urls.length, 1);
});
