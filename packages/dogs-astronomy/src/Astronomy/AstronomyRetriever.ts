import { Dog, IHuntingDog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_FORECAST_DAYS,
    OPEN_METEO_FORECAST_URL,
    fetchCellVariables,
    forecastCellRequest,
    withStale,
} from '@martinschmieschek/slopdogs-openmeteo';
import { AstronomyQueryPact, type AstronomyQuery } from './pacts';

export interface AstronomyMoon {
    phase: string;
    illumination: number;
    age: number;
}

export interface AstronomySun {
    sunrise: string;
    sunset: string;
    daylightMinutes: number;
    sunshineMinutes: number;
    uvIndexMax: number;
}

export interface AstronomyResult {
    sun: AstronomySun;
    moon: AstronomyMoon;
    date: string;
    /** Nur gesetzt (true), wenn das Open-Meteo-Budget erschoepft ist und aeltere Daten aus dem Zellen-Speicher kommen */
    stale?: boolean;
}

/** Dieselben Tagesvariablen liest SunRetriever — beide teilen sich die Vorhersage-Zelle. */
const SUN_DAILY_VARIABLES = ['sunrise', 'sunset', 'daylight_duration', 'sunshine_duration', 'uv_index_max'];
const MAX_AGE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/** Liegt das Datum (UTC-Kalender, ein Tag Spielraum fuer Ortszeit) in den Tagen der Vorhersage-Zelle? */
function inForecastCell(date: string, now = Date.now()): boolean {
    const t = Date.parse(`${date}T00:00:00Z`);
    const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
    return t >= today - DAY_MS && t <= today + OPEN_METEO_FORECAST_DAYS * DAY_MS;
}

/**
 * Tageswerte eines Datums: aus der gemeinsamen Vorhersage-Zelle, wenn es dort liegt; sonst ein eigener
 * Eintrag fuer genau diesen Tag (start_date = end_date), wie der Dog ihn schon immer abrief.
 */
async function sunDay(
    lat: number,
    lng: number,
    date: string,
    cache?: ICacheHandler,
): Promise<{ daily: Record<string, Array<number | string | null> | undefined>; stale: boolean }> {
    if (inForecastCell(date)) {
        const cell = await fetchCellVariables(cache, forecastCellRequest(lat, lng, { daily: SUN_DAILY_VARIABLES }, MAX_AGE_MS));
        const i = ((cell.daily?.time ?? []) as string[]).indexOf(date);
        if (i >= 0) {
            return { daily: Object.fromEntries(SUN_DAILY_VARIABLES.map((v) => [v, [cell.daily?.[v]?.[i] ?? null]])), stale: cell.stale };
        }
    }
    const single = await fetchCellVariables(cache, {
        api: OPEN_METEO_FORECAST_URL,
        lat,
        lng,
        params: { forecast_days: 1, start_date: date, end_date: date },
        daily: SUN_DAILY_VARIABLES,
        maxAgeMs: MAX_AGE_MS,
    });
    return { daily: single.daily ?? {}, stale: single.stale };
}

const SYNODIC_MONTH = 29.53059;
const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();

function getMoonPhase(date: Date): AstronomyMoon {
    const diff = date.getTime() - KNOWN_NEW_MOON;
    const daysSince = diff / (1000 * 60 * 60 * 24);
    const age = ((daysSince % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;

    let phase: string;
    if (age < 1.85) phase = 'New Moon';
    else if (age < 7.38) phase = 'Waxing Crescent';
    else if (age < 11.07) phase = 'First Quarter';
    else if (age < 14.76) phase = 'Waxing Gibbous';
    else if (age < 16.61) phase = 'Full Moon';
    else if (age < 22.14) phase = 'Waning Gibbous';
    else if (age < 25.83) phase = 'Last Quarter';
    else phase = 'Waning Crescent';

    const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2) * 100);

    return { phase, illumination, age: Math.round(age * 10) / 10 };
}

export class AstronomyRetriever extends Dog<AstronomyResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }

    get name(): string {
        return AstronomyRetriever.name;
    }
    get description(): string {
        return 'Moon phase, sunrise/sunset, UV index and daylight data for given GPS coordinates. Shared Open-Meteo cell cache, data up to 60 min old.';
    }
    get icon(): string | undefined {
        return '\uD83C\uDF19';
    }
    get required(): (new (...args: any[]) => IHuntingDog<unknown>)[] {
        return [AstronomyQueryPact];
    }
    get optional(): (new (...args: any[]) => IHuntingDog<unknown>)[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<AstronomyResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(AstronomyQueryPact, d));
        const query = (queryDog?.collected as AstronomyQuery | undefined) ?? ({} as AstronomyQuery);

        const lat = parseFloat(query.lat);
        const lng = parseFloat(query.lng);
        if (isNaN(lat) || isNaN(lng)) {
            throw new Error('AstronomyRetriever: Missing required query params (lat, lng)');
        }

        const dateStr = query.date || new Date().toISOString().split('T')[0];
        const { daily, stale } = await sunDay(lat, lng, dateStr, this.cacheHandler);
        const first = (v: string) => daily[v]?.[0];

        const sun: AstronomySun = {
            sunrise: (first('sunrise') as string | undefined) ?? '',
            sunset: (first('sunset') as string | undefined) ?? '',
            daylightMinutes: Math.round(((first('daylight_duration') as number | undefined) ?? 0) / 60),
            sunshineMinutes: Math.round(((first('sunshine_duration') as number | undefined) ?? 0) / 60),
            uvIndexMax: (first('uv_index_max') as number | undefined) ?? 0,
        };
        return withStale({ sun, moon: getMoonPhase(new Date(dateStr)), date: dateStr }, { stale });
    };
}
