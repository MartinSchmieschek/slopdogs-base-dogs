/**
 * =========================================================================
 *  SOLAR TYPES — Einstrahlung auf die Waagerechte, wie Open-Meteo sie liefert
 * =========================================================================
 *
 *  Alle Strahlungswerte in W/m², jeweils Mittel der Stunde VOR dem Zeitstempel
 *  (Open-Meteo-Konvention: 13:00 = Mittel 12:00–13:00). Keine Neigung: wer auf
 *  eine geneigte Flaeche umrechnet, nimmt GHI, DNI und DHI.
 */

/** Eine Stunde Einstrahlung */
export interface SolarHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) — Ende der gemittelten Stunde */
    time: string;
    /** Globalstrahlung auf die Waagerechte (GHI), W/m² */
    ghi: number | null;
    /** Direktstrahlung auf die Waagerechte, W/m² */
    directHorizontal: number | null;
    /** Diffusstrahlung (DHI), W/m² */
    dhi: number | null;
    /** Direktnormalstrahlung (DNI), W/m² */
    dni: number | null;
    /** Bewoelkung in % (nur Vorhersage und Archiv) */
    cloudCover?: number | null;
    /** Lufttemperatur 2 m in °C (nur Vorhersage und Archiv) */
    temperature?: number | null;
    /** Wind 10 m in m/s (nur Vorhersage und Archiv) */
    windSpeed?: number | null;
}

/** Tagessumme aus den Stundenwerten */
export interface SolarDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    /** Globalstrahlung, kWh/m² */
    ghiKWhPerM2: number;
    /** Direktstrahlung auf die Waagerechte, kWh/m² */
    directKWhPerM2: number;
    /** Diffusstrahlung, kWh/m² */
    diffuseKWhPerM2: number;
    /** Stunden mit Messwert (fehlende Stunden zaehlen nicht mit) */
    hoursWithData: number;
}

/** Ergebnis aller drei Solar-Dogs */
export interface SolarRadiationResult {
    /** Standort, wie Open-Meteo ihn auf sein Raster gelegt hat */
    location: {
        lat: number;
        lng: number;
        elevation: number | null;
        timezone: string;
        utcOffsetSeconds: number;
    };
    /** Stundenwerte, aelteste zuerst */
    hours: SolarHour[];
    /** Tagessummen, aelteste zuerst */
    days: SolarDay[];
    /** Woher die Werte stammen: forecast | archive | satellite */
    kind: 'forecast' | 'archive' | 'satellite';
    /** Quellenangabe (CC BY 4.0 verlangt sie) */
    source: string;
    /** Nur gesetzt (true), wenn das Open-Meteo-Budget erschoepft ist und aeltere Daten aus dem Zellen-Speicher kommen */
    stale?: boolean;
}
