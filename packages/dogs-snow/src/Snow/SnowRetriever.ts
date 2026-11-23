/**
 * =========================================================================
 *  SNOW RETRIEVER — Schneehoehe, Neuschnee, Schneefall- und Nullgradgrenze
 * =========================================================================
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
import type { SnowDay, SnowHour, SnowResult } from './interfaces/snowTypes';
import { SnowQueryPact, type SnowQuery } from './pacts';

const FIELDS = {
    snowDepth: 'snow_depth',
    snowfall: 'snowfall',
    snowfallHeight: 'snowfall_height',
    freezingLevel: 'freezing_level_height',
    temperature: 'temperature_2m',
    precipitation: 'precipitation',
};
const TTL_MS = 60 * 60_000;

function snowDays(hours: SnowHour[]): SnowDay[] {
    const col = (h: SnowHour[], k: keyof Omit<SnowHour, 'time'>) => h.map((x) => x[k]);
    return [...groupByDate(hours).entries()].map(([date, h]) => ({
        date,
        snowfallSum: aggregate(col(h, 'snowfall'), 'sum'),
        snowDepthMax: aggregate(col(h, 'snowDepth'), 'max'),
        snowfallHeightMin: aggregate(col(h, 'snowfallHeight'), 'min'),
        freezingLevelMin: aggregate(col(h, 'freezingLevel'), 'min'),
    }));
}

export async function getSnow(lat: number, lng: number, days: number, cache?: ICacheHandler): Promise<SnowResult> {
    const data = sliceDays(await fetchCellVariables(cache, forecastCellRequest(lat, lng, { hourly: Object.values(FIELDS) }, TTL_MS)), days);
    const hours: SnowHour[] = hourlyRows(data, FIELDS);
    return withStale(
        { location: toLocation(data), hours, days: snowDays(hours), units: hourlyUnits(data, FIELDS), source: OPEN_METEO_SOURCE },
        data,
    );
}

export class SnowRetriever extends Dog<SnowResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return SnowRetriever.name;
    }
    get description(): string {
        return 'Hourly snow forecast: snow depth (m), snowfall (cm), snowfall line and freezing level (m above sea level), temperature, precipitation, with daily sums and lowest snowfall line, for GPS coordinates. Up to 7 days. Shared Open-Meteo cell cache, data up to 60 min old.';
    }
    get icon(): string | undefined {
        return '❄️';
    }
    get required(): DogClass[] {
        return [SnowQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SnowResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SnowQueryPact, d));
        const query = (queryDog?.collected as SnowQuery | undefined) ?? ({} as SnowQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 7, 1, OPEN_METEO_FORECAST_DAYS);

        return getSnow(lat, lng, days, this.cacheHandler);
    };
}
