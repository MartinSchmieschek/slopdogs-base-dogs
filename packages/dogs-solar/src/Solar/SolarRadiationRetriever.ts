/**
 * =========================================================================
 *  SOLAR RADIATION RETRIEVER — Einstrahlung der naechsten Tage
 * =========================================================================
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import type { SolarRadiationResult } from './interfaces/solarTypes';
import { SolarRadiationQueryPact, type SolarRadiationQuery } from './pacts';
import {
    OPEN_METEO_FORECAST_URL,
    clampInt,
    fetchOpenMeteo,
    openMeteoCacheKey,
    openMeteoUrl,
    parseLatLng,
    todayUtc,
    type DogClass,
} from '@martinschmieschek/slopdogs-openmeteo';
import { solarVariables, toHours, toResult } from './openMeteoSolar';

/** Open-Meteo rechnet die Vorhersage stuendlich neu — eine halbe Stunde halten. */
const TTL_MS = 30 * 60_000;

export async function getSolarForecast(lat: number, lng: number, days: number): Promise<SolarRadiationResult> {
    const url = openMeteoUrl(OPEN_METEO_FORECAST_URL, lat, lng, { hourly: solarVariables(true), forecast_days: days });
    const data = await fetchOpenMeteo(url, 'solar forecast');
    return toResult(data, toHours(data, true), 'forecast');
}

export class SolarRadiationRetriever extends Dog<SolarRadiationResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return SolarRadiationRetriever.name;
    }
    get description(): string {
        return 'Hourly solar irradiance forecast (GHI, DNI, DHI, direct horizontal; W/m², horizontal plane) plus cloud cover, temperature and wind, with daily kWh/m² sums, for GPS coordinates. Open-Meteo, cached 30 min per 1 km cell.';
    }
    get icon(): string | undefined {
        return '🔆';
    }
    get required(): DogClass[] {
        return [SolarRadiationQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SolarRadiationResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SolarRadiationQueryPact, d));
        const query = (queryDog?.collected as SolarRadiationQuery | undefined) ?? ({} as SolarRadiationQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 3, 1, 16);

        const fetchIt = () => getSolarForecast(lat, lng, days);
        if (!this.cacheHandler) return fetchIt();
        // UTC-Datum im Schluessel: die Vorhersage beginnt mit dem heutigen Tag, ein Eintrag vom Vortag passt nicht.
        const key = openMeteoCacheKey('solar-forecast', lat, lng, { days, date: todayUtc() });
        return this.cacheHandler.getOrFetch(key, TTL_MS, fetchIt);
    };
}
