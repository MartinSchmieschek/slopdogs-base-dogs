/**
 * =========================================================================
 *  BRIGHT SKY RADAR — Abruf einer Kachel, Hoeflichkeits-Waechter, Fehler
 * =========================================================================
 *
 *  Bright Sky (https://brightsky.dev) stellt das RV-Komposit des DWD frei und ohne Schluessel
 *  bereit; eine Grenze ist nicht dokumentiert. Der Waechter haelt den Prozess trotzdem bei
 *  hoechstens 60 Abrufen je Minute.
 */

import type { RadarTile } from './radarGrid';
import type { StoredRadarFrame, StoredRadarTile } from './radarFrames';

export const BRIGHT_SKY_RADAR_URL = 'https://api.brightsky.dev/radar';
export const BRIGHT_SKY_REQUESTS_PER_MINUTE = 60;

const USER_AGENT = 'SlopDogs/0.3 (+https://github.com/MartinSchmieschek/SlopDogs)';
const TIMEOUT_MS = 15_000;
const SOURCE_RUN = /::(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))$/;

/** Bright Sky antwortete mit einem HTTP-Fehler. */
export class BrightSkyHttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'BrightSkyHttpError';
    }
}

/** Abruf verweigert: der Waechter hat sein Minutenkontingent verbraucht. */
export class BrightSkyGuardError extends Error {
    constructor(readonly retryInSeconds: number) {
        super(`Bright Sky request limit (${BRIGHT_SKY_REQUESTS_PER_MINUTE}/min) reached, retry in ${retryInSeconds} s`);
        this.name = 'BrightSkyGuardError';
    }
}

/** Gleitendes Fenster: hoechstens `limit` Abrufe je `windowMs`. */
export class RequestGuard {
    private calls: number[] = [];

    constructor(
        readonly limit: number,
        private readonly windowMs = 60_000,
    ) {}

    /** Bucht einen Abruf, wenn er ins Fenster passt; sonst `false`, ohne zu buchen. */
    tryConsume(now = Date.now()): boolean {
        this.calls = this.calls.filter((at) => at > now - this.windowMs);
        if (this.calls.length >= this.limit) return false;
        this.calls.push(now);
        return true;
    }

    /** Sekunden, bis wieder ein Abruf passt. */
    retryInSeconds(now = Date.now()): number {
        const oldest = this.calls[this.calls.length - this.limit];
        return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    }

    reset(): void {
        this.calls = [];
    }
}

/** Der eine Waechter des Prozesses — jeder Bright-Sky-Abruf bucht hier. */
export const brightSkyGuard = new RequestGuard(BRIGHT_SKY_REQUESTS_PER_MINUTE);

/**
 * Voruebergehend: Waechter voll, 429, 5xx, Timeout, Netz, leere Antwort. 404 zaehlt dazu — Bright Sky meldet so
 * eine Luecke in den Radardaten, die Anfrage selbst ist gueltig. Andere HTTP-Fehler sind Fehler der Anfrage.
 */
export function isTransientRadarError(e: unknown): boolean {
    return !(e instanceof BrightSkyHttpError) || e.status === 404 || e.status === 429 || e.status >= 500;
}

interface BrightSkyRadarRecord {
    timestamp: string;
    source: string;
    precipitation_5: string;
}

/** ISO-Zeit in UTC ohne Millisekunden, z. B. 2026-11-23T19:50:00Z. */
export function isoUtc(ms: number): string {
    return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function runOf(record: BrightSkyRadarRecord): number {
    const match = SOURCE_RUN.exec(record.source ?? '');
    const run = match ? Date.parse(match[1]) : NaN;
    if (Number.isNaN(run)) throw new Error(`Bright Sky radar: unreadable source "${record.source}"`);
    return run;
}

function recordsOf(body: unknown): BrightSkyRadarRecord[] {
    const radar = (body as { radar?: unknown } | null)?.radar;
    if (!Array.isArray(radar)) throw new Error('Bright Sky radar: response has no radar records');
    return radar as BrightSkyRadarRecord[];
}

/**
 * Holt eine Kachel fuer die Zeitpunkte `from` bis `to` (ms, UTC) und behaelt den neuesten Lauf:
 * dessen Analyse und alle Frames danach. Bucht vorher beim Waechter.
 */
export async function fetchRadarTile(tile: RadarTile, from: number, to: number, now = Date.now()): Promise<StoredRadarTile> {
    if (!brightSkyGuard.tryConsume(now)) throw new BrightSkyGuardError(brightSkyGuard.retryInSeconds(now));
    const url = `${BRIGHT_SKY_RADAR_URL}?bbox=${tile.bbox}&date=${isoUtc(from)}&last_date=${isoUtc(to)}&format=compressed`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
        res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BrightSkyHttpError(res.status, `Bright Sky radar failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`.trim());
    }
    const records = recordsOf(await res.json());
    if (records.length === 0) throw new Error(`Bright Sky radar returned no frames for ${isoUtc(from)} to ${isoUtc(to)}`);
    const run = Math.max(...records.map(runOf));
    const frames: StoredRadarFrame[] = records
        .map((r) => ({ at: Date.parse(r.timestamp), data: r.precipitation_5 }))
        .filter((f) => f.at >= run)
        .sort((a, b) => a.at - b.at)
        .map((f) => ({ time: isoUtc(f.at), data: f.data }));
    return { run: isoUtc(run), top: tile.top, left: tile.left, width: tile.width, height: tile.height, frames };
}
