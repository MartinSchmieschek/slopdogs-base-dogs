/**
 * =========================================================================
 *  THUNDERSTORM RETRIEVER — Gewitterneigung aus CAPE, Lifted Index, CIN, Blitzpotenzial
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
import type { ThunderstormDay, ThunderstormHour, ThunderstormResult } from './interfaces/stormTypes';
import { ThunderstormQueryPact, type ThunderstormQuery } from './pacts';

const FIELDS = {
    cape: 'cape',
    liftedIndex: 'lifted_index',
    convectiveInhibition: 'convective_inhibition',
    lightningPotential: 'lightning_potential',
    gust: 'wind_gusts_10m',
    precipitation: 'precipitation',
    weatherCode: 'weather_code',
};
/** Gewitterlagen wechseln schnell — eine Viertelstunde halten. */
const TTL_MS = 15 * 60_000;

/** Einstufung nach hoechstem CAPE des Tages. */
export function capeLevel(capeMax: number | null): ThunderstormDay['level'] {
    if (capeMax === null) return 'unknown';
    if (capeMax < 300) return 'low';
    if (capeMax < 1000) return 'moderate';
    if (capeMax < 2500) return 'elevated';
    return 'high';
}

export function thunderstormDays(hours: ThunderstormHour[]): ThunderstormDay[] {
    return [...groupByDate(hours).entries()].map(([date, h]) => {
        const capeMax = aggregate(
            h.map((x) => x.cape),
            'max',
        );
        return {
            date,
            capeMax,
            liftedIndexMin: aggregate(
                h.map((x) => x.liftedIndex),
                'min',
            ),
            lightningPotentialMax: aggregate(
                h.map((x) => x.lightningPotential),
                'max',
            ),
            gustMax: aggregate(
                h.map((x) => x.gust),
                'max',
            ),
            thunderHours: h.filter((x) => x.thunder).length,
            level: capeLevel(capeMax),
        };
    });
}

export async function getThunderstorm(lat: number, lng: number, days: number): Promise<ThunderstormResult> {
    const data = await fetchOpenMeteo(
        openMeteoUrl(OPEN_METEO_FORECAST_URL, lat, lng, { hourly: hourlyVariables(FIELDS), forecast_days: days }),
        'thunderstorm',
    );
    const hours: ThunderstormHour[] = hourlyRows(data, FIELDS).map((r) => ({
        ...r,
        thunder: r.weatherCode !== null && r.weatherCode >= 95,
    }));
    return {
        location: toLocation(data),
        hours,
        days: thunderstormDays(hours),
        units: hourlyUnits(data, FIELDS),
        source: OPEN_METEO_SOURCE,
    };
}

export class ThunderstormRetriever extends Dog<ThunderstormResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return ThunderstormRetriever.name;
    }
    get description(): string {
        return 'Hourly thunderstorm potential: CAPE, lifted index, convective inhibition, lightning potential index (Europe/ICON only), gusts, precipitation, weather code with thunder flag, plus daily max values and a CAPE-based level (low/moderate/elevated/high), for GPS coordinates. Open-Meteo, cached 15 min per 1 km cell.';
    }
    get icon(): string | undefined {
        return '⛈️';
    }
    get required(): DogClass[] {
        return [ThunderstormQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<ThunderstormResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(ThunderstormQueryPact, d));
        const query = (queryDog?.collected as ThunderstormQuery | undefined) ?? ({} as ThunderstormQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const days = clampInt(query.days, 3, 1, 16);

        const fetchIt = () => getThunderstorm(lat, lng, days);
        if (!this.cacheHandler) return fetchIt();
        return this.cacheHandler.getOrFetch(openMeteoCacheKey('thunderstorm', lat, lng, { days, date: todayUtc() }), TTL_MS, fetchIt);
    };
}
