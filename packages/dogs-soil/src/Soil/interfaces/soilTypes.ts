/**
 * =========================================================================
 *  SOIL TYPES — Boden und Wasserhaushalt
 * =========================================================================
 */

type Location = { lat: number; lng: number; elevation: number | null; timezone: string; utcOffsetSeconds: number };

/** Eine Stunde Boden: Temperatur in °C, Feuchte in m³/m³ (Volumenanteil Wasser) */
export interface SoilHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    temperature0cm: number | null;
    temperature6cm: number | null;
    temperature18cm: number | null;
    temperature54cm: number | null;
    moisture0to1cm: number | null;
    moisture1to3cm: number | null;
    moisture3to9cm: number | null;
    moisture9to27cm: number | null;
    moisture27to81cm: number | null;
}

/** Tagesmittel je Tiefe */
export interface SoilDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    temperature6cmMean: number | null;
    temperature54cmMean: number | null;
    /** Wurzelraum Rasen/Gemuese */
    moisture3to9cmMean: number | null;
    /** Wurzelraum Straeucher/Baeume */
    moisture27to81cmMean: number | null;
}

export interface SoilResult {
    location: Location;
    hours: SoilHour[];
    days: SoilDay[];
    units: Record<string, string>;
    source: string;
}

/** Eine Stunde Wasserhaushalt */
export interface EvapotranspirationHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    /** Referenzverdunstung FAO-56 (Gras, gut bewaessert), mm */
    et0: number | null;
    /** Tatsaechliche Verdunstung laut Modell, mm */
    evapotranspiration: number | null;
    /** Dampfdruckdefizit, kPa — wie stark die Luft Wasser zieht */
    vaporPressureDeficit: number | null;
    /** Niederschlag, mm */
    precipitation: number | null;
    /** Lufttemperatur 2 m, °C */
    temperature: number | null;
}

/** Tagesbilanz */
export interface EvapotranspirationDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    /** Summe Referenzverdunstung, mm */
    et0Sum: number | null;
    /** Summe Niederschlag, mm */
    precipitationSum: number | null;
    /** Niederschlag minus ET₀, mm — negativ heisst: der Boden verliert Wasser (Giessbedarf) */
    waterBalance: number | null;
    /** Hoechstes Dampfdruckdefizit, kPa */
    vaporPressureDeficitMax: number | null;
}

export interface EvapotranspirationResult {
    location: Location;
    hours: EvapotranspirationHour[];
    days: EvapotranspirationDay[];
    units: Record<string, string>;
    source: string;
}
