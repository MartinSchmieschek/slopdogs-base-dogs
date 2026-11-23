/**
 * Zellen-Speicher, Vorher-Nachher: jeder umgezogene Dog liefert fuer die aufgezeichneten Faelle (Tage <= 7) genau
 * die Ausgabe des alten Stands — mit Cache und ohne. Tage > 7 werden auf 7 geklemmt. Dazu die Kontingent-Messung:
 * gewichtete Abrufe vorher (alter Stand, nachgerechnet) und nachher (gemessen) fuer die Szenarien a-d.
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { geoBucketKey } from '@martinschmieschek/slopdogs-core';
import { openMeteoBudget } from '@martinschmieschek/slopdogs-openmeteo';
import { FIXED_NOW, FakeOpenMeteo, MemoryCacheHandler, runDog, vendorWeight } from './support/openMeteoKit';
import { DOG_CASES, PADERBORN, PADERBORN_NORTH, allForecastDogs, energyForecast, type Wave } from './support/openMeteoCases';

const before_ = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'test', 'fixtures', 'openMeteoBefore.json'), 'utf8')) as Record<
    string,
    unknown
>;
const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

before(() => mock.timers.enable({ apis: ['Date'], now: FIXED_NOW }));
after(() => mock.timers.reset());

for (const c of DOG_CASES) {
    test(`${c.id}: Ausgabe wie vor dem Zellen-Speicher (mit Cache und ohne)`, async () => {
        const fake = new FakeOpenMeteo(0);
        try {
            openMeteoBudget.reset();
            assert.deepEqual(json(await runDog(c.dog, c.pact, c.query, new MemoryCacheHandler().asHandler())), before_[c.id]);
            assert.deepEqual(json(await runDog(c.dog, c.pact, c.query)), before_[c.id]);
        } finally {
            fake.restore();
        }
    });
}

test('Tage > 7 werden auf 7 geklemmt: gleiche Ausgabe wie days=7, Abruf mit forecast_days=7', async () => {
    const fake = new FakeOpenMeteo(0);
    try {
        for (const c of DOG_CASES.filter((x) => x.query.days !== undefined)) {
            const seven = await runDog(c.dog, c.pact, { ...c.query, days: '7' });
            const many = await runDog(c.dog, c.pact, { ...c.query, days: '16' });
            assert.deepEqual(json(many), json(seven), c.id);
        }
        assert.ok(fake.urls.every((u) => new URL(u).searchParams.get('forecast_days') === '7'));
    } finally {
        fake.restore();
    }
});

/**
 * Vorher, nachgerechnet aus dem alten Code: jeder Dog rief selbst ab, mit seinen Variablen und seinem Zeitraum
 * (forecast_days = days), gecacht je Dog, 1-km-Zelle und days. Weather: 6 current + 6 hourly, 2 Tage; Sun und
 * Astronomy: 5 daily. Am alten Stand gemessen (FakeOpenMeteo, 23.11.2026): a 3, b 3, c 3, d 10,2.
 */
const OLD_VARIABLES: Record<string, { vars: number; defaultDays: number }> = {
    SolarRadiationRetriever: { vars: 7, defaultDays: 3 },
    HumidityRetriever: { vars: 5, defaultDays: 7 },
    SnowRetriever: { vars: 6, defaultDays: 7 },
    SoilRetriever: { vars: 9, defaultDays: 3 },
    EvapotranspirationRetriever: { vars: 5, defaultDays: 7 },
    ThunderstormRetriever: { vars: 7, defaultDays: 3 },
    WindProfileRetriever: { vars: 9, defaultDays: 3 },
    WeatherRetriever: { vars: 12, defaultDays: 2 },
    SunRetriever: { vars: 5, defaultDays: 7 },
    AstronomyRetriever: { vars: 5, defaultDays: 1 },
};
const MEASURED_BEFORE = { a: 3, b: 3, c: 3, d: 10.2 };

function replayBefore(seen: Set<string>, wave: Wave): number {
    let weight = 0;
    for (const { dog, query } of wave) {
        const name = (dog as { name: string }).name;
        const old = OLD_VARIABLES[name];
        const days = Number(query.days ?? old.defaultDays);
        const key = `${name}|${geoBucketKey('x', Number(query.lat), Number(query.lng), 1000, { bucketM: 1000 })}|${days}`;
        if (seen.has(key)) continue;
        seen.add(key);
        weight += Math.max(1, old.vars / 10) * Math.max(1, days / 14);
    }
    return Math.round(weight * 1000) / 1000;
}

async function measureAfter(cache: MemoryCacheHandler, wave: Wave): Promise<{ calls: number; weight: number }> {
    const fake = new FakeOpenMeteo(5);
    try {
        await Promise.all(wave.map((d) => runDog(d.dog, d.pact, d.query, cache.asHandler())));
        return { calls: fake.urls.length, weight: Math.round(fake.urls.reduce((s, u) => s + vendorWeight(u), 0) * 1000) / 1000 };
    } finally {
        fake.restore();
    }
}

test('Kontingent: gewichtete Abrufe vorher/nachher, Szenarien a-d', async () => {
    openMeteoBudget.reset();
    const seen = new Set<string>();
    const cache = new MemoryCacheHandler();
    const rows = {
        'a energy-forecast days=3': {
            before: replayBefore(seen, energyForecast('3')),
            after: await measureAfter(cache, energyForecast('3')),
        },
        'b dasselbe mit days=7': { before: replayBefore(seen, energyForecast('7')), after: await measureAfter(cache, energyForecast('7')) },
        'c zweiter Ort 500 m': {
            before: replayBefore(seen, energyForecast('7', PADERBORN_NORTH)),
            after: await measureAfter(cache, energyForecast('7', PADERBORN_NORTH)),
        },
        'd alle Vorhersage-Dogs, eine Zelle': {
            before: replayBefore(new Set(), allForecastDogs(PADERBORN)),
            after: await measureAfter(new MemoryCacheHandler(), allForecastDogs(PADERBORN)),
        },
    };
    console.log('Szenario | vorher (gewichtet) | nachher (Abrufe / gewichtet)');
    for (const [name, r] of Object.entries(rows)) console.log(`${name} | ${r.before} | ${r.after.calls} / ${r.after.weight}`);

    const values = Object.values(rows);
    assert.deepEqual(
        values.map((r) => r.before),
        Object.values(MEASURED_BEFORE),
        'Nachrechnung passt zur Messung am alten Stand',
    );
    assert.deepEqual(
        values.map((r) => r.after),
        [
            { calls: 1, weight: 1.6 },
            { calls: 0, weight: 0 },
            { calls: 1, weight: 1.6 },
            { calls: 2, weight: 5.7 },
        ],
    );
    assert.notEqual(
        geoBucketKey('x', Number(PADERBORN.lat), Number(PADERBORN.lng), 1000, { bucketM: 1000 }),
        geoBucketKey('x', Number(PADERBORN_NORTH.lat), Number(PADERBORN_NORTH.lng), 1000, { bucketM: 1000 }),
        'der zweite Ort liegt in einer anderen 1-km-Zelle',
    );
});
