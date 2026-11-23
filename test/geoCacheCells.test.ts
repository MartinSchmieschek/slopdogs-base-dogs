/**
 * Open-Meteo-Punkt-Dogs teilen sich eine 1-km-Zelle: zwei Orte, die in verschiedenen 200-m-Zellen,
 * aber derselben 1-km-Zelle liegen, ergeben denselben Cache-Schluessel. Frueher uebergaben Weather,
 * Water und Air-Quality nur den Radius 1000 — daraus wurden 200-m-Zellen.
 * Der Cache-Handler ist eine Attrappe, die nie den Upstream ruft.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoBucketKey, type ICacheHandler, type IHuntingDog } from '@martinschmieschek/slopdogs-core';
import { KennelRun, QueryRetriever, BodyRetriever } from '@martinschmieschek/slopdogs-core/runtime';
import { WeatherRetriever, WeatherQueryPact } from '@martinschmieschek/slopdogs-dogs-weather';
import { WaterRetriever, WaterQueryPact } from '@martinschmieschek/slopdogs-dogs-water';
import { AirQualityRetriever, AirQualityQueryPact } from '@martinschmieschek/slopdogs-dogs-air-quality';
import { SunRetriever, SunQueryPact } from '@martinschmieschek/slopdogs-dogs-sun';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

/** Zeichnet nur den Schluessel auf und liefert einen Platzhalter — kein Netz. */
class KeyRecorder {
    readonly keys: string[] = [];
    getTileFeatureCache(): undefined {
        return undefined;
    }
    async getOrFetch<T>(key: string): Promise<T> {
        this.keys.push(key);
        return {} as T;
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

async function keyOf(dog: DogClass, pact: unknown, query: Record<string, string>): Promise<string> {
    const recorder = new KeyRecorder();
    const map = new Map<string, DogClass>();
    for (const C of [QueryRetriever, BodyRetriever, dog, supplier(pact, query)]) map.set(new C().name, C);
    const name = new dog().name;
    await new KennelRun(
        { id: 'test-geo-cells', dogIds: [`base:${name}`, 'base:TestQuery'] },
        map,
        undefined,
        {},
        undefined,
        [],
        recorder as unknown as ICacheHandler,
    ).run();
    assert.equal(recorder.keys.length, 1, `${name} hat den Cache nicht genau einmal gefragt`);
    return recorder.keys[0];
}

/** Zwei Punkte rund 300 m auseinander: verschiedene 200-m-Zellen, dieselbe 1-km-Zelle. */
function pointPair(): [Record<string, string>, Record<string, string>] {
    for (let i = 0; i < 2000; i++) {
        const lat = 51 + i * 0.0007;
        const lng = 8.75;
        const lat2 = lat + 0.0027;
        const in200 = geoBucketKey('x', lat, lng, 1000) !== geoBucketKey('x', lat2, lng, 1000);
        const in1000 = geoBucketKey('x', lat, lng, 1000, { bucketM: 1000 }) === geoBucketKey('x', lat2, lng, 1000, { bucketM: 1000 });
        if (in200 && in1000)
            return [
                { lat: String(lat), lng: String(lng) },
                { lat: String(lat2), lng: String(lng) },
            ];
    }
    throw new Error('kein Punktpaar gefunden');
}

const dogs: Array<[string, DogClass, unknown]> = [
    ['WeatherRetriever', WeatherRetriever as unknown as DogClass, WeatherQueryPact],
    ['WaterRetriever', WaterRetriever as unknown as DogClass, WaterQueryPact],
    ['AirQualityRetriever', AirQualityRetriever as unknown as DogClass, AirQualityQueryPact],
    ['SunRetriever', SunRetriever as unknown as DogClass, SunQueryPact],
];

for (const [name, dog, pact] of dogs) {
    test(`${name}: zwei Orte in derselben 1-km-Zelle teilen den Cache-Schluessel`, async () => {
        const [a, b] = pointPair();
        const keyA = await keyOf(dog, pact, a);
        const keyB = await keyOf(dog, pact, b);
        assert.equal(keyA, keyB, `${name}: ${keyA} != ${keyB}`);
    });
}
