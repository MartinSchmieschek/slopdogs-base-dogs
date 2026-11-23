/**
 * =========================================================================
 *  SUN RETRIEVER — tracking the celestial void's daily arc
 * =========================================================================
 *
 *  Arr, matey! This hound follows GPS coordinates and tracks the sun
 *  across the sky — sunrise, sunset, daylight hours, UV index.
 * =========================================================================
 */

import { Dog, IHuntingDog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import { OPEN_METEO_FORECAST_DAYS } from '@martinschmieschek/slopdogs-openmeteo';
import { getSunData } from './sunApiClient';
import type { SunResult } from './interfaces/sunTypes';
import { SunQueryPact, type SunQuery } from './pacts';

export class SunRetriever extends Dog<SunResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }

    get name(): string {
        return SunRetriever.name;
    }
    get description(): string {
        return 'Fetches sunrise, sunset, and daylight data for given GPS coordinates, 1-7 days. Shared Open-Meteo cell cache, data up to 60 min old.';
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

        // Die Vorhersage-Zelle haelt 7 Tage; der Dog schneidet seine Tage heraus.
        const clampedDays = Math.min(Math.max(isNaN(days) ? 7 : days, 1), OPEN_METEO_FORECAST_DAYS);
        return getSunData(lat, lng, clampedDays, this.cacheHandler);
    };
}
