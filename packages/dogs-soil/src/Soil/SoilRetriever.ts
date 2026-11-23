/**
 * =========================================================================
 *  SOIL RETRIEVER — Bodentemperatur und Bodenfeuchte in fuenf Tiefen
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
import type { SoilDay, SoilHour, SoilResult } from './interfaces/soilTypes';
import { SoilQueryPact, type SoilQuery } from './pacts';

const FIELDS = {
    temperature0cm: 'soil_temperature_0cm',
    temperature6cm: 'soil_temperature_6cm',
    temperature18cm: 'soil_temperature_18cm',
    temperature54cm: 'soil_temperature_54cm',
    moisture0to1cm: 'soil_moisture_0_to_1cm',
    moisture1to3cm: 'soil_moisture_1_to_3cm',
    moisture3to9cm: 'soil_moisture_3_to_9cm',
    moisture9to27cm: 'soil_moisture_9_to_27cm',
    moisture27to81cm: 'soil_moisture_27_to_81cm',
};
/** Boden aendert sich traege — eine Stunde halten. */
const TTL_MS = 60 * 60_000;

function soilDays(hours: SoilHour[]): SoilDay[] {
    const mean = (h: SoilHour[], k: keyof SoilHour) =>
        aggregate(
            h.map((x) => x[k] as number | null),
            'mean',
        );
    return [...groupByDate(hours).entries()].map(([date, h]) => ({
        date,
        temperature6cmMean: mean(h, 'temperature6cm'),
        temperature54cmMean: mean(h, 'temperature54cm'),
        moisture3to9cmMean: mean(h, 'moisture3to9cm'),
        moisture27to81cmMean: mean(h, 'moisture27to81cm'),
    }));
}

export async function getSoil(lat: number, lng: number, days: number): Promise<SoilResult> {
    const data = await fetchOpenMeteo(
        openMeteoUrl(OPEN_METEO_FORECAST_URL, lat, lng, { hourly: hourlyVariables(FIELDS), forecast_days: days }),
        'soil',
    );
    const hours: SoilHour[] = hourlyRows(data, FIELDS);
    return { location: toLocation(data), hours, days: soilDays(hours), units: hourlyUnits(data, FIELDS), source: OPEN_METEO_SOURCE };
}

export class SoilRetriever extends Dog<SoilResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return SoilRetriever.name;
    }
    get description(): string {
        return 'Hourly soil forecast: soil temperature at 0/6/18/54 cm (°C) and soil moisture in five layers 0-81 cm (m³/m³), with daily means, for GPS coordinates. For gardening, frost in the ground, sowing. Open-Meteo, cached 1 h per 1 km cell.';
    }
    get icon(): string | undefined {
        return '🪴';
    }
    get required(): DogClass[] {
        return [SoilQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SoilResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SoilQueryPact, d));
        const query = (queryDog?.collected as SoilQuery | undefined) ?? ({} as SoilQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 3, 1, 16);

        const fetchIt = () => getSoil(lat, lng, days);
        if (!this.cacheHandler) return fetchIt();
        return this.cacheHandler.getOrFetch(openMeteoCacheKey('soil', lat, lng, { days, date: todayUtc() }), TTL_MS, fetchIt);
    };
}
