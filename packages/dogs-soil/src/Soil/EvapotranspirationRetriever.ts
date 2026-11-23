/**
 * =========================================================================
 *  EVAPOTRANSPIRATION RETRIEVER — Verdunstung, Niederschlag, Wasserbilanz
 * =========================================================================
 *
 *  Wie viel Wasser der Boden verliert und wie viel nachkommt — die Grundlage
 *  fuer Giessplaene.
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_FORECAST_DAYS,
    OPEN_METEO_SOURCE,
    aggregate,
    clampInt,
    fetchCellVariables,
    forecastCellRequest,
    groupByDate,
    hourlyRows,
    hourlyUnits,
    parseLatLng,
    sliceDays,
    toLocation,
    withStale,
    type DogClass,
} from '@martinschmieschek/slopdogs-openmeteo';
import type { EvapotranspirationDay, EvapotranspirationHour, EvapotranspirationResult } from './interfaces/soilTypes';
import { EvapotranspirationQueryPact, type EvapotranspirationQuery } from './pacts';

const FIELDS = {
    et0: 'et0_fao_evapotranspiration',
    evapotranspiration: 'evapotranspiration',
    vaporPressureDeficit: 'vapour_pressure_deficit',
    precipitation: 'precipitation',
    temperature: 'temperature_2m',
};
const TTL_MS = 60 * 60_000;

export function waterBalanceDays(hours: EvapotranspirationHour[]): EvapotranspirationDay[] {
    return [...groupByDate(hours).entries()].map(([date, h]) => {
        const et0Sum = aggregate(
            h.map((x) => x.et0),
            'sum',
        );
        const precipitationSum = aggregate(
            h.map((x) => x.precipitation),
            'sum',
        );
        return {
            date,
            et0Sum,
            precipitationSum,
            waterBalance: et0Sum === null || precipitationSum === null ? null : Math.round((precipitationSum - et0Sum) * 1000) / 1000,
            vaporPressureDeficitMax: aggregate(
                h.map((x) => x.vaporPressureDeficit),
                'max',
            ),
        };
    });
}

export async function getEvapotranspiration(
    lat: number,
    lng: number,
    days: number,
    cache?: ICacheHandler,
): Promise<EvapotranspirationResult> {
    const data = sliceDays(await fetchCellVariables(cache, forecastCellRequest(lat, lng, { hourly: Object.values(FIELDS) }, TTL_MS)), days);
    const hours: EvapotranspirationHour[] = hourlyRows(data, FIELDS);
    return withStale(
        {
            location: toLocation(data),
            hours,
            days: waterBalanceDays(hours),
            units: hourlyUnits(data, FIELDS),
            source: OPEN_METEO_SOURCE,
        },
        data,
    );
}

export class EvapotranspirationRetriever extends Dog<EvapotranspirationResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return EvapotranspirationRetriever.name;
    }
    get description(): string {
        return 'Hourly water balance forecast: reference evapotranspiration ET0 (FAO-56), modelled evapotranspiration, vapour pressure deficit, precipitation, temperature, with daily sums and water balance (precipitation minus ET0, negative = watering need), for GPS coordinates. Up to 7 days. Shared Open-Meteo cell cache, data up to 60 min old.';
    }
    get icon(): string | undefined {
        return '💧';
    }
    get required(): DogClass[] {
        return [EvapotranspirationQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<EvapotranspirationResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(EvapotranspirationQueryPact, d));
        const query = (queryDog?.collected as EvapotranspirationQuery | undefined) ?? ({} as EvapotranspirationQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 7, 1, OPEN_METEO_FORECAST_DAYS);

        return getEvapotranspiration(lat, lng, days, this.cacheHandler);
    };
}
