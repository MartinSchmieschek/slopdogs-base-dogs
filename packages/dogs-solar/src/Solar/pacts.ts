/**
 * =========================================================================
 *  SOLAR PACTS — was ein Kennel den Solar-Dogs liefern muss
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Vorhersage der Einstrahlung */
export interface SolarRadiationQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 3, max: 7) */
    days?: string;
}

/** Einstrahlung eines vergangenen Zeitraums */
export interface SolarRadiationHistoryQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Erster Tag (YYYY-MM-DD, ab 1940). Default: sieben Tage vor endDate */
    startDate?: string;
    /** Letzter Tag (YYYY-MM-DD). Default: vor sechs Tagen (das Archiv hinkt rund fuenf Tage nach). Hoechstens 366 Tage Spanne */
    endDate?: string;
}

/** Gemessene Einstrahlung aus Satellitendaten */
export interface SatelliteRadiationQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Zurueckliegende Tage zusaetzlich zu heute (default: 1, max: 7) */
    pastDays?: string;
}

export const SolarRadiationQueryPact = createPact<SolarRadiationQuery>('SolarRadiationQueryProvider', {
    fromSourceType: 'SolarRadiationQuery',
});

export const SolarRadiationHistoryQueryPact = createPact<SolarRadiationHistoryQuery>('SolarRadiationHistoryQueryProvider', {
    fromSourceType: 'SolarRadiationHistoryQuery',
});

export const SatelliteRadiationQueryPact = createPact<SatelliteRadiationQuery>('SatelliteRadiationQueryProvider', {
    fromSourceType: 'SatelliteRadiationQuery',
});
