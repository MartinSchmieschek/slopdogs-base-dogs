/**
 * =========================================================================
 *  HUMIDITY RETRIEVER — Luftfeuchte, Taupunkt, Feuchtkugeltemperatur
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
import type { HumidityDay, HumidityHour, HumidityResult } from './interfaces/humidityTypes';
import { HumidityQueryPact, type HumidityQuery } from './pacts';

const FIELDS = {
    temperature: 'temperature_2m',
    relativeHumidity: 'relative_humidity_2m',
    dewPoint: 'dew_point_2m',
    wetBulbTemperature: 'wet_bulb_temperature_2m',
    vapourPressureDeficit: 'vapour_pressure_deficit',
};
const TTL_MS = 30 * 60_000;

function humidityDays(hours: HumidityHour[]): HumidityDay[] {
    const col = (h: HumidityHour[], k: keyof Omit<HumidityHour, 'time'>) => h.map((x) => x[k]);
    return [...groupByDate(hours).entries()].map(([date, h]) => ({
        date,
        relativeHumidityMean: aggregate(col(h, 'relativeHumidity'), 'mean'),
        relativeHumidityMax: aggregate(col(h, 'relativeHumidity'), 'max'),
        dewPointMean: aggregate(col(h, 'dewPoint'), 'mean'),
        wetBulbTemperatureMin: aggregate(col(h, 'wetBulbTemperature'), 'min'),
        temperatureMean: aggregate(col(h, 'temperature'), 'mean'),
    }));
}

export async function getHumidity(lat: number, lng: number, days: number, cache?: ICacheHandler): Promise<HumidityResult> {
    const data = sliceDays(await fetchCellVariables(cache, forecastCellRequest(lat, lng, { hourly: Object.values(FIELDS) }, TTL_MS)), days);
    const hours: HumidityHour[] = hourlyRows(data, FIELDS);
    return withStale(
        { location: toLocation(data), hours, days: humidityDays(hours), units: hourlyUnits(data, FIELDS), source: OPEN_METEO_SOURCE },
        data,
    );
}

export class HumidityRetriever extends Dog<HumidityResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return HumidityRetriever.name;
    }
    get description(): string {
        return 'Hourly humidity forecast: temperature, relative humidity (%), dew point and wet-bulb temperature (°C), vapour pressure deficit (kPa), with daily means, for GPS coordinates. For heat pumps (defrost, icing), drying, mould risk. Up to 7 days. Shared Open-Meteo cell cache, data up to 30 min old.';
    }
    get icon(): string | undefined {
        return '💧';
    }
    get required(): DogClass[] {
        return [HumidityQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<HumidityResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(HumidityQueryPact, d));
        const query = (queryDog?.collected as HumidityQuery | undefined) ?? ({} as HumidityQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 7, 1, OPEN_METEO_FORECAST_DAYS);

        return getHumidity(lat, lng, days, this.cacheHandler);
    };
}
