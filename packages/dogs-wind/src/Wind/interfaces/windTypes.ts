/**
 * =========================================================================
 *  WIND TYPES — Windprofil in vier Hoehen
 * =========================================================================
 */

/** Eine Stunde Wind. Geschwindigkeiten in m/s, Richtungen in Grad (woher der Wind kommt). */
export interface WindHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    speed10m: number | null;
    speed80m: number | null;
    speed120m: number | null;
    speed180m: number | null;
    direction10m: number | null;
    direction80m: number | null;
    direction120m: number | null;
    direction180m: number | null;
    /** Boeen 10 m (Maximum der vorangehenden Stunde) */
    gust10m: number | null;
}

/** Tageswerte aus den Stunden */
export interface WindDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    /** Staerkste Boee 10 m, m/s */
    gustMax: number | null;
    /** Hoechstes Stundenmittel 10 m, m/s */
    speed10mMax: number | null;
    /** Mittel 120 m (Nabenhoehe typischer Windraeder), m/s */
    speed120mMean: number | null;
}

/** Ergebnis des WindProfileRetriever */
export interface WindProfileResult {
    location: { lat: number; lng: number; elevation: number | null; timezone: string; utcOffsetSeconds: number };
    hours: WindHour[];
    days: WindDay[];
    /** Einheit je Feld, wie Open-Meteo sie meldet */
    units: Record<string, string>;
    source: string;
}
