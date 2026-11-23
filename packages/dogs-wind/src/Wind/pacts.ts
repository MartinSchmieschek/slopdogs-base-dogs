/**
 * =========================================================================
 *  WIND PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Windprofil-Abfrage */
export interface WindProfileQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 3, max: 16) */
    days?: string;
}

export const WindProfileQueryPact = createPact<WindProfileQuery>('WindProfileQueryProvider', { fromSourceType: 'WindProfileQuery' });
