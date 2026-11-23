/**
 * =========================================================================
 *  WIND PROFILE RETRIEVER — Wind in 10, 80, 120 und 180 m
 * =========================================================================
 *
 *  Fuer Windenergie, Drohnen, Drachen, Kraene: Bodenwind allein sagt wenig,
 *  in Nabenhoehe weht es oft doppelt so stark.
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
import type { WindDay, WindHour, WindProfileResult } from './interfaces/windTypes';
import { WindProfileQueryPact, type WindProfileQuery } from './pacts';

const FIELDS = {
    speed10m: 'wind_speed_10m',
    speed80m: 'wind_speed_80m',
    speed120m: 'wind_speed_120m',
    speed180m: 'wind_speed_180m',
    direction10m: 'wind_direction_10m',
    direction80m: 'wind_direction_80m',
    direction120m: 'wind_direction_120m',
    direction180m: 'wind_direction_180m',
    gust10m: 'wind_gusts_10m',
};
/** Vorhersage wird stuendlich neu gerechnet. */
const TTL_MS = 30 * 60_000;

function windDays(hours: WindHour[]): WindDay[] {
    return [...groupByDate(hours).entries()].map(([date, h]) => ({
        date,
        gustMax: aggregate(
            h.map((x) => x.gust10m),
            'max',
        ),
        speed10mMax: aggregate(
            h.map((x) => x.speed10m),
            'max',
        ),
        speed120mMean: aggregate(
            h.map((x) => x.speed120m),
            'mean',
        ),
    }));
}

export async function getWindProfile(lat: number, lng: number, days: number, cache?: ICacheHandler): Promise<WindProfileResult> {
    const data = sliceDays(await fetchCellVariables(cache, forecastCellRequest(lat, lng, { hourly: Object.values(FIELDS) }, TTL_MS)), days);
    const hours: WindHour[] = hourlyRows(data, FIELDS);
    return withStale(
        { location: toLocation(data), hours, days: windDays(hours), units: hourlyUnits(data, FIELDS), source: OPEN_METEO_SOURCE },
        data,
    );
}

export class WindProfileRetriever extends Dog<WindProfileResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return WindProfileRetriever.name;
    }
    get description(): string {
        return 'Hourly wind profile forecast: speed and direction at 10/80/120/180 m plus 10 m gusts (m/s), with daily gust max and 120 m mean, for GPS coordinates. Up to 7 days. Shared Open-Meteo cell cache, data up to 30 min old.';
    }
    get icon(): string | undefined {
        return '🌬️';
    }
    get required(): DogClass[] {
        return [WindProfileQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<WindProfileResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(WindProfileQueryPact, d));
        const query = (queryDog?.collected as WindProfileQuery | undefined) ?? ({} as WindProfileQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 3, 1, OPEN_METEO_FORECAST_DAYS);

        return getWindProfile(lat, lng, days, this.cacheHandler);
    };
}
