/**
 * =========================================================================
 *  RADAR TILE STORE — ein Abruf je Kachel und Slot fuer alle Anfragen
 * =========================================================================
 *
 *  - Der DWD rechnet alle 5 min einen Lauf; er liegt 3-4 min spaeter beim DWD und 0-3 min
 *    danach bei Bright Sky, also spaetestens 7 min nach der Laufzeit.
 *  - Slot = der Lauf, der jetzt sicher da ist: floor((jetzt − 7 min) / 5 min) × 5 min. Ein neuer
 *    Slot beginnt 7 min nach jeder Laufzeit; der erste Abruf darin holt den neuen Lauf, der die
 *    alte Kachel ersetzt. Daten sind beim Ausliefern 7-12 min alt.
 *  - Schluessel `rainradar:<Kachel>:<Slot>`, getOrFetch mit 10 min Haltezeit: alle Anfragen einer
 *    Kachel im Slot teilen einen Abruf, gleichzeitige teilen den laufenden.
 *  - Abgefragt wird ab einem Schritt vor dem Slot: kommt Bright Sky spaeter als erwartet, ist die
 *    Analyse des vorigen Laufs trotzdem dabei. Gespeichert wird der neueste Lauf der Antwort.
 *  - Jeder erfolgreiche Abruf legt die Kachel zusaetzlich als `rainradar:<Kachel>:last` ab (2 h —
 *    so weit reicht die Vorhersage eines Laufs). Scheitert Bright Sky voruebergehend oder ist der
 *    Waechter voll, kommt dieser Lauf mit `stale: true`; ohne ihn ein lesbarer Fehler.
 *  - Ohne Cache-Handler: direkter Abruf, kein Rueckgriff.
 */

import type { ICacheHandler } from '@martinschmieschek/slopdogs-core';
import { fetchRadarTile, isTransientRadarError } from './brightSky';
import { RadarTileFrames, type StoredRadarTile } from './radarFrames';
import type { RadarTile } from './radarGrid';

export const RADAR_STEP_MS = 5 * 60_000;
export const RADAR_AVAILABILITY_LAG_MS = 7 * 60_000;
export const RADAR_FORECAST_MS = 120 * 60_000;
export const RADAR_TILE_TTL_MS = 10 * 60_000;
export const RADAR_LAST_RUN_TTL_MS = RADAR_FORECAST_MS;

const KEY_PREFIX = 'rainradar';

/** Kein Lauf erreichbar und keiner gespeichert. */
export class RainRadarUnavailableError extends Error {
    constructor(tile: RadarTile, cause: unknown) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(`Rain radar unavailable: ${reason}; no earlier radar run is stored for this area (tile ${tile.key})`);
        this.name = 'RainRadarUnavailableError';
    }
}

/** Der Lauf (ms, UTC), der zu `now` sicher bei Bright Sky liegt — zugleich der Slot. */
export function radarSlot(now: number): number {
    return Math.floor((now - RADAR_AVAILABILITY_LAG_MS) / RADAR_STEP_MS) * RADAR_STEP_MS;
}

/** `rainradar:<Spalte>_<Zeile>:<JJJJMMTThhmm>` */
export function radarSlotKey(tile: RadarTile, slot: number): string {
    return `${KEY_PREFIX}:${tile.key}:${new Date(slot).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
}

export function radarLastRunKey(tile: RadarTile): string {
    return `${KEY_PREFIX}:${tile.key}:last`;
}

function fetchSlot(tile: RadarTile, slot: number, now: number): Promise<StoredRadarTile> {
    return fetchRadarTile(tile, slot - RADAR_STEP_MS, slot + RADAR_FORECAST_MS + 2 * RADAR_STEP_MS, now);
}

/** Die Kachel des aktuellen Slots — aus dem Cache, frisch abgerufen oder als frueherer Lauf (stale). */
export async function loadRadarTile(tile: RadarTile, cache: ICacheHandler | undefined, now = Date.now()): Promise<RadarTileFrames> {
    const slot = radarSlot(now);
    if (!cache) {
        try {
            return new RadarTileFrames(await fetchSlot(tile, slot, now));
        } catch (e) {
            throw isTransientRadarError(e) ? new RainRadarUnavailableError(tile, e) : e;
        }
    }
    try {
        const stored = await cache.getOrFetch(radarSlotKey(tile, slot), RADAR_TILE_TTL_MS, async () => {
            const fresh = await fetchSlot(tile, slot, now);
            await cache.set(radarLastRunKey(tile), fresh, RADAR_LAST_RUN_TTL_MS);
            return fresh;
        });
        return new RadarTileFrames(stored);
    } catch (e) {
        if (!isTransientRadarError(e)) throw e;
        const last = await cache.get<StoredRadarTile>(radarLastRunKey(tile));
        if (!last) throw new RainRadarUnavailableError(tile, e);
        return new RadarTileFrames(last, true);
    }
}
