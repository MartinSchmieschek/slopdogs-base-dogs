/**
 * SunRetriever im Zellen-Speicher: zweiter Lauf am selben Ort (auch mit GPS-Jitter) kommt aus dem Speicher,
 * verschiedene Tageszahlen teilen sich einen Eintrag, Tage werden auf 1..7 geklemmt, Auffrischung nach der Klasse der Variablen.
 * Fetch und Cache-Handler sind Attrappen — der Test geht nicht ins Netz.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openMeteoBudget } from '@martinschmieschek/slopdogs-openmeteo';
import { SunRetriever, SunQueryPact, type SunResult } from '@martinschmieschek/slopdogs-dogs-sun';
import { FakeOpenMeteo, MemoryCacheHandler, runDog } from './support/openMeteoKit';

const runSun = (query: Record<string, string>, cache: MemoryCacheHandler) =>
    runDog<SunResult>(SunRetriever, SunQueryPact, query, cache.asHandler());

test('SunRetriever: gleicher Ort (auch mit GPS-Jitter) holt nur einmal, Auffrischung nach 30 min (Sonnenstunden, UV)', async (t) => {
    openMeteoBudget.reset();
    const fake = new FakeOpenMeteo(0);
    const t0 = Date.now();
    mock.timers.enable({ apis: ['Date'], now: t0 });
    t.after(() => {
        fake.restore();
        mock.timers.reset();
    });

    const cache = new MemoryCacheHandler();
    const first = await runSun({ lat: '51.7189', lng: '8.7575' }, cache);
    const second = await runSun({ lat: '51.7190', lng: '8.7576' }, cache); // ~12 m daneben
    assert.equal(fake.urls.length, 1, 'zweiter Lauf ging an Open-Meteo statt in den Zellen-Speicher');
    assert.deepEqual(second, first);
    assert.equal(cache.cellKeys().length, 1);
    assert.match(cache.cellKeys()[0], /^openmeteo-cell:.*forecast_days=7/);

    mock.timers.setTime(t0 + 29 * 60_000);
    await runSun({ lat: '51.7189', lng: '8.7575' }, cache);
    assert.equal(fake.urls.length, 1, 'nach 29 min noch aus dem Speicher');
    mock.timers.setTime(t0 + 31 * 60_000);
    await runSun({ lat: '51.7189', lng: '8.7575' }, cache);
    assert.equal(fake.urls.length, 2, 'nach 31 min neu geholt');
});

test('SunRetriever: andere Tageszahl teilt den Eintrag, Tage werden auf 1..7 geklemmt', async (t) => {
    openMeteoBudget.reset();
    const fake = new FakeOpenMeteo(0);
    t.after(() => fake.restore());

    const cache = new MemoryCacheHandler();
    const three = await runSun({ lat: '51.7189', lng: '8.7575', days: '3' }, cache);
    const many = await runSun({ lat: '51.7189', lng: '8.7575', days: '99' }, cache);
    const fallback = await runSun({ lat: '51.7189', lng: '8.7575', days: 'abc' }, cache);

    assert.equal(fake.urls.length, 1, 'ein Abruf fuer alle Tageszahlen');
    assert.deepEqual([three.forecast.length, many.forecast.length, fallback.forecast.length], [3, 7, 7]);
});
