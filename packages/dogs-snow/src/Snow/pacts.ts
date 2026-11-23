/**
 * =========================================================================
 *  SNOW PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Schnee-Abfrage */
export interface SnowQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 7, max: 7) */
    days?: string;
}

export const SnowQueryPact = createPact<SnowQuery>('SnowQueryProvider', { fromSourceType: 'SnowQuery' });
