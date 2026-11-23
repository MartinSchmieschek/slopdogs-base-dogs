/**
 * =========================================================================
 *  STORM TYPES — Gewitterneigung
 * =========================================================================
 */

/** Eine Stunde Gewitter-Kenngroessen */
export interface ThunderstormHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    /** Labilitaetsenergie (CAPE), J/kg — Treibstoff fuer Gewitter */
    cape: number | null;
    /** Lifted Index, K — negativ heisst labil, je tiefer desto heftiger */
    liftedIndex: number | null;
    /** Konvektionshemmung (CIN), J/kg — Deckel, der Gewitter zurueckhaelt */
    convectiveInhibition: number | null;
    /** Blitzpotenzial (Lightning Potential Index), J/kg — nur wo ICON rechnet (Europa), sonst null */
    lightningPotential: number | null;
    /** Boeen 10 m, m/s */
    gust: number | null;
    /** Niederschlag, mm */
    precipitation: number | null;
    /** WMO-Wettercode */
    weatherCode: number | null;
    /** Wettercode 95–99 (Gewitter) in dieser Stunde */
    thunder: boolean;
}

/** Tageswerte */
export interface ThunderstormDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    capeMax: number | null;
    liftedIndexMin: number | null;
    lightningPotentialMax: number | null;
    gustMax: number | null;
    /** Stunden mit Gewitter-Wettercode */
    thunderHours: number;
    /** Einstufung nach hoechstem CAPE: low < 300, moderate < 1000, elevated < 2500, high ab 2500 J/kg; unknown ohne Werte */
    level: 'low' | 'moderate' | 'elevated' | 'high' | 'unknown';
}

export interface ThunderstormResult {
    location: { lat: number; lng: number; elevation: number | null; timezone: string; utcOffsetSeconds: number };
    hours: ThunderstormHour[];
    days: ThunderstormDay[];
    units: Record<string, string>;
    source: string;
}
