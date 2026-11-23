/**
 * =========================================================================
 *  SOLAR RADIATION RETRIEVER — Einstrahlung der naechsten Tage
 * =========================================================================
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import type { SolarRadiationResult } from './interfaces/solarTypes';
import { SolarRadiationQueryPact, type SolarRadiationQuery } from './pacts';
import {
    OPEN_METEO_FORECAST_DAYS,
    clampInt,
    fetchCellVariables,
    forecastCellRequest,
    parseLatLng,
    sliceDays,
    type DogClass,
} from '@martinschmieschek/slopdogs-openmeteo';
import { solarVariableList, toHours, toResult } from './openMeteoSolar';

/** Open-Meteo rechnet die Vorhersage stuendlich neu — eine halbe Stunde halten. */
const TTL_MS = 30 * 60_000;

export async function getSolarForecast(lat: number, lng: number, days: number, cache?: ICacheHandler): Promise<SolarRadiationResult> {
    const request = forecastCellRequest(lat, lng, { hourly: solarVariableList(true) }, TTL_MS);
    const data = sliceDays(await fetchCellVariables(cache, request), days);
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
        return 'Hourly solar irradiance forecast (GHI, DNI, DHI, direct horizontal; W/m², horizontal plane) plus cloud cover, temperature and wind, with daily kWh/m² sums, for GPS coordinates. Up to 7 days. Shared Open-Meteo cell cache, data up to 30 min old.';
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
        const days = clampInt(query.days, 3, 1, OPEN_METEO_FORECAST_DAYS);
        return getSolarForecast(lat, lng, days, this.cacheHandler);
    };
}
