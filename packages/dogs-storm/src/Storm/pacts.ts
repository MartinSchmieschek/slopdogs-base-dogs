/**
 * =========================================================================
 *  STORM PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Gewitter-Abfrage */
export interface ThunderstormQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 3, max: 16) */
    days?: string;
}

export const ThunderstormQueryPact = createPact<ThunderstormQuery>('ThunderstormQueryProvider', { fromSourceType: 'ThunderstormQuery' });
