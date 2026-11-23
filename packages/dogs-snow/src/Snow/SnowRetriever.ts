/**
 * =========================================================================
 *  SNOW RETRIEVER — Schneehoehe, Neuschnee, Schneefall- und Nullgradgrenze
 * =========================================================================
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_FORECAST_URL,
    OPEN_METEO_SOURCE,
    aggregate,
    clampInt,
    fetchOpenMeteo,
    groupByDate,
    hourlyRows,
    hourlyUnits,
    hourlyVariables,
    openMeteoCacheKey,
    openMeteoUrl,
    parseLatLng,
    toLocation,
    todayUtc,
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

export async function getSnow(lat: number, lng: number, days: number): Promise<SnowResult> {
    const data = await fetchOpenMeteo(
        openMeteoUrl(OPEN_METEO_FORECAST_URL, lat, lng, { hourly: hourlyVariables(FIELDS), forecast_days: days }),
        'snow',
    );
    const hours: SnowHour[] = hourlyRows(data, FIELDS);
    return { location: toLocation(data), hours, days: snowDays(hours), units: hourlyUnits(data, FIELDS), source: OPEN_METEO_SOURCE };
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
        return 'Hourly snow forecast: snow depth (m), snowfall (cm), snowfall line and freezing level (m above sea level), temperature, precipitation, with daily sums and lowest snowfall line, for GPS coordinates. Open-Meteo, cached 1 h per 1 km cell.';
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
        const days = clampInt(query.days, 7, 1, 16);

        const fetchIt = () => getSnow(lat, lng, days);
        if (!this.cacheHandler) return fetchIt();
        return this.cacheHandler.getOrFetch(openMeteoCacheKey('snow', lat, lng, { days, date: todayUtc() }), TTL_MS, fetchIt);
    };
}
