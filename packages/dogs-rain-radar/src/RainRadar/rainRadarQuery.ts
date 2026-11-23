/**
 * =========================================================================
 *  RAIN RADAR QUERY — Pruefung der Abfrage mit klaren Fehlern
 * =========================================================================
 */

import type { RainRadarQuery } from './pacts';

export const RADIUS_KM_DEFAULT = 2;
export const RADIUS_KM_MAX = 10;
export const HORIZON_MIN_DEFAULT = 120;
export const HORIZON_MIN_MAX = 120;
export const HORIZON_STEP_MIN = 5;

/** Ungueltige Abfrage — der Text sagt, welcher Parameter was erwartet. */
export class RainRadarQueryError extends Error {
    constructor(message: string) {
        super(`RainRadarRetriever: ${message}`);
        this.name = 'RainRadarQueryError';
    }
}

export interface RainRadarParams {
    lat: number;
    lng: number;
    radiusKm: number;
    horizonMin: number;
}

const isBlank = (raw: string | undefined): raw is undefined => raw === undefined || raw === null || String(raw).trim() === '';

function coordinate(raw: string | undefined, name: string, limit: number): number {
    const value = isBlank(raw) ? NaN : Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > limit) {
        throw new RainRadarQueryError(
            `${name} is required and must be a number between -${limit} and ${limit} (got ${JSON.stringify(raw ?? null)})`,
        );
    }
    return value;
}

function wholeNumber(raw: string | undefined, name: string, fallback: number, max: number, step: number, expected: string): number {
    if (isBlank(raw)) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > max || value % step !== 0) {
        throw new RainRadarQueryError(`${name} must be ${expected} (got ${JSON.stringify(raw)})`);
    }
    return value;
}

export function parseRainRadarQuery(query: Partial<RainRadarQuery>): RainRadarParams {
    return {
        lat: coordinate(query.lat, 'lat', 90),
        lng: coordinate(query.lng, 'lng', 180),
        radiusKm: wholeNumber(
            query.radiusKm,
            'radiusKm',
            RADIUS_KM_DEFAULT,
            RADIUS_KM_MAX,
            1,
            `a whole number of km from 0 to ${RADIUS_KM_MAX}`,
        ),
        horizonMin: wholeNumber(
            query.horizonMin,
            'horizonMin',
            HORIZON_MIN_DEFAULT,
            HORIZON_MIN_MAX,
            HORIZON_STEP_MIN,
            `a number of minutes from 0 to ${HORIZON_MIN_MAX} in steps of ${HORIZON_STEP_MIN}`,
        ),
    };
}
