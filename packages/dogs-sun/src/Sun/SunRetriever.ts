/**
 * =========================================================================
 *  SUN RETRIEVER — tracking the celestial void's daily arc
 * =========================================================================
 *
 *  Arr, matey! This hound follows GPS coordinates and tracks the sun
 *  across the sky — sunrise, sunset, daylight hours, UV index.
 * =========================================================================
 */

import { Dog, IHuntingDog, IHuntingSeason, type ICacheHandler, type ICacheable, geoBucketKey } from '@martinschmieschek/slopdogs-core';
import { getSunData } from './sunApiClient';
import type { SunResult } from './interfaces/sunTypes';
import { SunQueryPact, type SunQuery } from './pacts';

/**
 * Haltezeit: Auf- und Untergang aendern sich ueber den Tag nicht, Sonnenstunden und UV-Index
 * sind aber Vorhersagen, die Open-Meteo stuendlich neu rechnet — daher eine Stunde wie Astronomy.
 */
const SUN_CACHE_TTL_MS = 60 * 60_000;

/**
 * Cache-Schluessel: 1-km-Zelle (bucketM ausdruecklich — ohne waere 1000 nur der Radius und die
 * Zelle 200 m), dazu die Zahl der Tage und das UTC-Datum, damit ein Eintrag nicht ueber den
 * Tageswechsel hinaus den Vortag als `today` liefert.
 */
function sunCacheKey(lat: number, lng: number, days: number, now: Date = new Date()): string {
    return geoBucketKey('sun', lat, lng, 1000, {
        bucketM: 1000,
        extras: { days, date: now.toISOString().slice(0, 10) },
    });
}

export class SunRetriever extends Dog<SunResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }

    get name(): string {
        return SunRetriever.name;
    }
    get description(): string {
        return 'Fetches sunrise, sunset, and daylight data for given GPS coordinates.';
    }
    get icon(): string | undefined {
        return '\u2600\uFE0F';
    }
    get required(): (new (...args: any[]) => IHuntingDog<unknown>)[] {
        return [SunQueryPact];
    }
    get optional(): (new (...args: any[]) => IHuntingDog<unknown>)[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SunResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SunQueryPact, d));
        const query = (queryDog?.collected as SunQuery | undefined) ?? ({} as SunQuery);

        const lat = parseFloat(query['lat']);
        const lng = parseFloat(query['lng']);
        const days = parseInt(query['days'] ?? '7', 10);

        if (isNaN(lat) || isNaN(lng)) {
            throw new Error('SunRetriever: Missing required query params (lat, lng)');
        }

        // getSunData klemmt die Tage auf 1..16 — der Schluessel muss dieselbe Zahl tragen.
        const clampedDays = Math.min(Math.max(isNaN(days) ? 7 : days, 1), 16);

        if (this.cacheHandler) {
            return this.cacheHandler.getOrFetch(sunCacheKey(lat, lng, clampedDays), SUN_CACHE_TTL_MS, () =>
                getSunData(lat, lng, clampedDays),
            );
        }
        return await getSunData(lat, lng, clampedDays);
    };
}
