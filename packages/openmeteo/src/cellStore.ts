/**
 * =========================================================================
 *  OPEN-METEO CELL STORE — ein Cache-Eintrag je Zelle, API und festen Parametern
 * =========================================================================
 *
 *  PLAN-OPEN-METEO-DOGS.md, S3. Ein Eintrag haelt alles, was an einer 1-km-Zelle je
 *  gefragt wurde: je Variable Werte, Einheit und Abrufzeit, dazu die gemeinsamen
 *  Zeitachsen (hourly, daily, current) und den Ort. Ein Dog nennt nur seine
 *  Variablen und sein maxAge.
 *
 *  - Die Haltezeit gehoert der Variable (variableTtl.ts); der Dog kann sie nur verkuerzen:
 *    min(TTL der Variable, maxAge des Dogs).
 *  - Abgerufen wird nur, wenn eine gefragte Variable fehlt oder aelter als ihre Haltezeit
 *    ist. Frische traege Variablen loesen nie einen Abruf aus.
 *  - Ein ausgeloester Abruf nimmt die uebrigen gefragten Variablen des Abschnitts mit,
 *    solange es hoechstens 10 bleiben (kostet nichts, ein Ergebnis aus einem Modelllauf);
 *    darueber nur die faelligen plus die gefragten derselben TTL-Klasse wie eine veraltete.
 *  - hourly, daily und current bleiben getrennt: eigene Zeitachse, eigene Werte, eigene
 *    Abrufzeit. temperature_2m in current ist ein anderer Wert als in hourly; keiner fuellt
 *    den anderen.
 *  - Buendelung: Anfragen derselben Zelle innerhalb von 50 ms werden ein Abruf.
 *  - Lesen, Mischen, Schreiben je Zelle laufen im Prozess nacheinander.
 *  - Neue Zeitachse (Tageswechsel, neue current-Zeit) ersetzt den ganzen Abschnitt.
 *  - Gemessenes (Satellit), Vorhersage und Luftqualitaet sind verschiedene APIs und damit
 *    verschiedene Eintraege; der Schluessel traegt API und feste Parameter (models, past_days).
 *  - Abgerufen wird immer die Zellmitte — alle Variablen eines Eintrags stammen vom selben Punkt.
 *  - Ist das Budget erschoepft oder scheitert Open-Meteo voruebergehend (429, 5xx, Timeout,
 *    Netz), kommt Gespeichertes auch ueber maxAge hinaus (`stale: true`), sofern jede
 *    gefragte Variable gespeichert ist.
 *  - Cache-Statistik (withDogCacheStats zaehlt getOrFetch): jede Anfrage zaehlt genau einmal.
 *    Der Abruf laeuft ueber getOrFetch('openmeteo-fetch:<sha256(url)>', 60 s) — Fehlschlag fuer den
 *    Ausloeser, Treffer fuer Partner derselben Welle; wer nur aus dem Eintrag bedient wird, liest
 *    ihn ueber getOrFetch(Zellschluessel) — Treffer.
 */

import { createHash } from 'node:crypto';
import { geoBucketCenter, type ICacheHandler } from '@martinschmieschek/slopdogs-core';
import {
    OPEN_METEO_AIR_QUALITY_URL,
    OPEN_METEO_FORECAST_URL,
    OPEN_METEO_SATELLITE_URL,
    OpenMeteoHttpError,
    fetchOpenMeteo,
    openMeteoCacheKey,
    type OpenMeteoResponse,
} from './api';
import { OPEN_METEO_MAX_VARIABLES, OpenMeteoBudgetError, openMeteoBudget, openMeteoCallWeight } from './budget';
import { openMeteoTtlClass, openMeteoVariableTtlMs } from './variableTtl';

/** Zeitraum der Vorhersage-Zelle: alle Vorhersage-Dogs teilen sich 7 Tage ab heute (Gewicht ohne Zeitraum-Aufschlag). */
export const OPEN_METEO_FORECAST_DAYS = 7;
/** Feste Parameter der gemeinsamen Vorhersage-Zelle. */
export const OPEN_METEO_FORECAST_PARAMS: Readonly<Record<string, string | number>> = {
    forecast_days: OPEN_METEO_FORECAST_DAYS,
    wind_speed_unit: 'ms',
};
/** So lange sammelt eine Zelle Anfragen, bevor sie abruft. */
export const CELL_BATCH_WINDOW_MS = 50;
/** Physische Haltezeit eines Zelleintrags; jedes Schreiben verlaengert sie. */
export const CELL_TTL_MS = 2 * 60 * 60_000;
/** So lange teilen sich gleiche Abruf-URLs die Antwort (getOrFetch im Cache-Handler). */
const FETCH_SHARE_MS = 60_000;
const FETCH_PREFIX = 'openmeteo-fetch';

const CELL_PREFIX = 'openmeteo-cell';
const CELL_SIZE_M = 1000;
const AXIS_KEYS = ['time', 'interval'];
const API_LABELS: Record<string, string> = {
    [OPEN_METEO_FORECAST_URL]: 'forecast',
    [OPEN_METEO_SATELLITE_URL]: 'satellite',
    [OPEN_METEO_AIR_QUALITY_URL]: 'air quality',
};

export type CellSectionName = 'hourly' | 'daily' | 'current';
const SECTIONS: CellSectionName[] = ['hourly', 'daily', 'current'];

/** Variablen je Abschnitt. */
export type CellVariables = Partial<Record<CellSectionName, string[]>>;

export interface CellRequest extends CellVariables {
    /** Basis-URL der API, z. B. OPEN_METEO_FORECAST_URL */
    api: string;
    lat: number;
    lng: number;
    /** Feste Nicht-Variablen-Parameter (Zeitraum, models, Einheiten) — Teil des Schluessels */
    params?: Readonly<Record<string, string | number>>;
    /** Hoechstalter, das der Dog verlangt; es verkuerzt die Haltezeit der Variable, verlaengert sie nie */
    maxAgeMs: number;
}

/** Open-Meteo-foermige Antwort, beschraenkt auf die gefragten Variablen. */
export interface CellResponse extends OpenMeteoResponse {
    /** Abrufzeit (ms) der aeltesten gefragten Variable */
    fetchedAt: number;
    /** true nur, wenn Budget oder ein voruebergehender Fehler die Auffrischung verhindert hat und eine Variable zu alt ist */
    stale: boolean;
}

type Value = number | string | null;
type SectionData = Record<string, unknown>;

interface StoredVariable {
    values: Value[] | Value;
    unit?: string;
    fetchedAt: number;
}

interface StoredSection {
    axis: SectionData;
    units: Record<string, string>;
    variables: Record<string, StoredVariable>;
}

type CellLocation = Pick<OpenMeteoResponse, 'latitude' | 'longitude' | 'elevation' | 'timezone' | 'utc_offset_seconds'>;

interface StoredCell {
    location: CellLocation;
    sections: Partial<Record<CellSectionName, StoredSection>>;
}

/** Hoechstalter einer Variable fuer diese Anfrage: TTL der Variable, hoechstens maxAge des Dogs. */
function maxAgeOf(section: CellSectionName, variable: string, req: CellRequest): number {
    return Math.min(openMeteoVariableTtlMs(section, variable, req.api), req.maxAgeMs);
}

function pick<T>(source: Record<string, T>, keys: string[]): Record<string, T> {
    return Object.fromEntries(keys.filter((k) => k in source).map((k) => [k, source[k]]));
}

/** Ein Zelleintrag: was gespeichert ist, was fehlt, wie Neues hineinkommt und was eine Anfrage zurueckbekommt. */
export class CellEntry {
    private constructor(private cell: StoredCell | undefined) {}

    static from(stored: unknown): CellEntry {
        return new CellEntry(stored as StoredCell | undefined);
    }

    toJSON(): StoredCell | undefined {
        return this.cell;
    }

    /** Gefragte Variablen, die fehlen oder aelter als ihr Hoechstalter sind. */
    due(req: CellRequest, now: number): CellVariables {
        return this.select(req, (name, v, stored) => !stored || now - stored.fetchedAt > maxAgeOf(name, v, req));
    }

    /** Gefragte Variablen, die gespeichert, aber zu alt sind. */
    expired(req: CellRequest, now: number): CellVariables {
        return this.select(req, (name, v, stored) => !!stored && now - stored.fetchedAt > maxAgeOf(name, v, req));
    }

    /** Gefragte Variablen, die gar nicht gespeichert sind. */
    absent(req: CellRequest): CellVariables {
        return this.select(req, (_name, _v, stored) => !stored);
    }

    /** Mischt eine Antwort ein. Weicht die Zeitachse eines Abschnitts ab, ersetzt sie ihn samt aller Variablen. */
    merge(data: OpenMeteoResponse, fetched: CellVariables, now: number): void {
        const sections = { ...this.cell?.sections };
        for (const name of SECTIONS) {
            const incoming = data[name] as SectionData | undefined;
            const wanted = fetched[name] ?? [];
            if (!incoming || wanted.length === 0) continue;
            const units = data[`${name}_units`] ?? {};
            const axis = pick(incoming, AXIS_KEYS);
            const kept = sections[name];
            const section: StoredSection =
                kept && JSON.stringify(kept.axis) === JSON.stringify(axis)
                    ? { ...kept, variables: { ...kept.variables } }
                    : { axis, units: pick(units, AXIS_KEYS), variables: {} };
            for (const v of wanted) {
                if (!(v in incoming)) continue;
                section.variables[v] = { values: incoming[v] as Value[] | Value, unit: units[v], fetchedAt: now };
            }
            sections[name] = section;
        }
        const location: CellLocation = {
            latitude: data.latitude,
            longitude: data.longitude,
            elevation: data.elevation,
            timezone: data.timezone,
            utc_offset_seconds: data.utc_offset_seconds,
        };
        this.cell = { location, sections };
    }

    /** Die Antwort fuer eine Anfrage: Ort, gefragte Abschnitte mit Zeitachse, Werten und Einheiten. */
    answer(req: CellRequest, now: number, degraded = false): CellResponse {
        const cell = this.cell as StoredCell;
        const response: Record<string, unknown> = { ...cell.location };
        let oldest = Infinity;
        let stale = false;
        for (const name of SECTIONS) {
            const section = cell.sections[name];
            const wanted = req[name] ?? [];
            if (!section || wanted.length === 0) continue;
            const values: SectionData = { ...section.axis };
            const units: Record<string, string> = { ...section.units };
            for (const v of wanted) {
                const stored = section.variables[v];
                if (!stored) continue;
                values[v] = stored.values;
                if (stored.unit !== undefined) units[v] = stored.unit;
                oldest = Math.min(oldest, stored.fetchedAt);
                stale ||= degraded && now - stored.fetchedAt > maxAgeOf(name, v, req);
            }
            response[name] = values;
            response[`${name}_units`] = units;
        }
        return { ...response, fetchedAt: oldest === Infinity ? now : oldest, stale } as CellResponse;
    }

    private select(
        req: CellRequest,
        test: (name: CellSectionName, v: string, stored: StoredVariable | undefined) => boolean,
    ): CellVariables {
        const out: CellVariables = {};
        for (const name of SECTIONS) {
            const vars = (req[name] ?? []).filter((v) => test(name, v, this.cell?.sections[name]?.variables[v]));
            if (vars.length > 0) out[name] = vars;
        }
        return out;
    }
}

/**
 * Was ein Abruf der Welle holt: alle faelligen Variablen. Dazu die uebrigen gefragten Variablen der
 * ausgeloesten Abschnitte, solange es hoechstens 10 bleiben (Gewicht unveraendert 1, ein Modelllauf);
 * darueber nur die gefragten, die eine TTL-Klasse mit einer veralteten teilen.
 */
function fetchPlan(entry: CellEntry, reqs: CellRequest[], now: number): CellVariables {
    const due = union(reqs.map((r) => entry.due(r, now)));
    const triggered = SECTIONS.filter((name) => due[name]?.length);
    if (triggered.length === 0) return {};
    const requested = union(reqs);
    const full = union([due, Object.fromEntries(triggered.map((name) => [name, requested[name] ?? []]))]);
    if (countVariables(full) <= OPEN_METEO_MAX_VARIABLES) return full;
    const expired = union(reqs.map((r) => entry.expired(r, now)));
    const classOf = (name: CellSectionName, v: string) => openMeteoTtlClass(name, v, reqs[0].api);
    const sameClass = Object.fromEntries(
        triggered.map((name) => {
            const classes = new Set((expired[name] ?? []).map((v) => classOf(name, v)));
            return [name, (requested[name] ?? []).filter((v) => classes.has(classOf(name, v)))];
        }),
    );
    return union([due, sameClass]);
}

function union(sets: CellVariables[]): CellVariables {
    const out: CellVariables = {};
    for (const name of SECTIONS) {
        const vars = [...new Set(sets.flatMap((s) => s[name] ?? []))].sort();
        if (vars.length > 0) out[name] = vars;
    }
    return out;
}

function without(vars: CellVariables, removed: CellVariables): CellVariables {
    return union([Object.fromEntries(SECTIONS.map((name) => [name, (vars[name] ?? []).filter((v) => !removed[name]?.includes(v))]))]);
}

function countVariables(vars: CellVariables): number {
    return SECTIONS.reduce((n, name) => n + (vars[name]?.length ?? 0), 0);
}

/** Tage, die ein Abruf mit diesen Parametern umfasst (fuer das Gewicht). */
function periodDays(params: CellRequest['params'] = {}): number {
    if (params.start_date && params.end_date) {
        return (Date.parse(String(params.end_date)) - Date.parse(String(params.start_date))) / 86_400_000 + 1;
    }
    return Number(params.forecast_days ?? OPEN_METEO_FORECAST_DAYS) + Number(params.past_days ?? 0);
}

function cellUrl(req: CellRequest, lat: number, lng: number, vars: CellVariables): string {
    const query: Record<string, string | number> = { latitude: lat, longitude: lng, timezone: 'auto', ...req.params };
    for (const name of SECTIONS) if (vars[name]?.length) query[name] = vars[name].join(',');
    return `${req.api}?${Object.entries(query)
        .map(([k, v]) => `${k}=${v}`)
        .join('&')}`;
}

/** Der Schluessel der Zelle: API, feste Parameter (sortiert), 1-km-Zelle. */
export function openMeteoCellKey(req: Pick<CellRequest, 'api' | 'lat' | 'lng' | 'params'>): string {
    return openMeteoCacheKey(CELL_PREFIX, req.lat, req.lng, { api: req.api, ...req.params });
}

const inFlight = new Map<string, Promise<OpenMeteoResponse>>();

function callWeight(req: CellRequest, vars: CellVariables): number {
    return openMeteoCallWeight(countVariables(vars), periodDays(req.params));
}

/** Der eigentliche Abruf: ein Abruf je URL zur selben Zeit, nur ein neu gestarteter bucht Budget. */
function fetchDirect(req: CellRequest, url: string, weight: number): Promise<OpenMeteoResponse> {
    const running = inFlight.get(url);
    if (running) return running;
    if (!openMeteoBudget.tryConsume(weight)) return Promise.reject(new OpenMeteoBudgetError(openMeteoBudget.retryInSeconds(weight)));
    const pending = fetchOpenMeteo(url, API_LABELS[req.api] ?? new URL(req.api).hostname).finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
    return pending;
}

/** Voruebergehend: 429, 5xx, Timeout, Netz. Andere HTTP-Fehler (400 …) sind Fehler der Anfrage und bleiben Fehler. */
function isTransient(e: unknown): boolean {
    return !(e instanceof OpenMeteoHttpError) || e.status === 429 || e.status >= 500;
}

interface Waiter {
    req: CellRequest;
    /** Der Cache-Handler des Dogs (im Server je Dog mit withDogCacheStats umhuellt) */
    cache: ICacheHandler;
    /** Schon einmal ueber getOrFetch gezaehlt? Jede Anfrage zaehlt genau einmal. */
    counted: boolean;
    resolve: (r: CellResponse) => void;
    reject: (e: unknown) => void;
}

interface Batch {
    waiters: Waiter[];
}

/**
 * Ruft ab und zaehlt dabei die Anfragen, die den Abruf brauchen und noch nicht gezaehlt sind: jede geht ueber
 * getOrFetch ihres eigenen Handlers mit demselben Schluessel — der erste startet den Abruf (Fehlschlag), die
 * anderen teilen ihn (Treffer). `share: false` umgeht die 60-s-Teilung (Nachholen nach einem Achsenwechsel).
 */
async function upstream(req: CellRequest, url: string, weight: number, needing: Waiter[], share: boolean): Promise<OpenMeteoResponse> {
    const direct = () => fetchDirect(req, url, weight);
    const uncounted = needing.filter((w) => !w.counted);
    if (!share || uncounted.length === 0) return direct();
    const key = `${FETCH_PREFIX}:${createHash('sha256').update(url).digest('hex')}`;
    for (const w of uncounted) w.counted = true;
    const [first] = await Promise.all(uncounted.map((w) => w.cache.getOrFetch(key, FETCH_SHARE_MS, direct)));
    return first;
}

/**
 * Holt `vars` an der Zellmitte und mischt sie ein. Budget erschoepft oder voruebergehender Fehler: liefert den
 * Fehler zurueck, statt zu werfen — die Welle bedient dann aus dem Gespeicherten.
 */
async function refresh(entry: CellEntry, req: CellRequest, vars: CellVariables, needing: Waiter[], share = true): Promise<unknown> {
    const weight = callWeight(req, vars);
    if (!openMeteoBudget.fits(weight)) return new OpenMeteoBudgetError(openMeteoBudget.retryInSeconds(weight));
    const centre = geoBucketCenter(req.lat, req.lng, CELL_SIZE_M, CELL_SIZE_M);
    const url = cellUrl(req, Number(centre.lat.toFixed(6)), Number(centre.lng.toFixed(6)), vars);
    try {
        entry.merge(await upstream(req, url, weight, needing, share), vars, Date.now());
        return undefined;
    } catch (e) {
        if (e instanceof OpenMeteoBudgetError || isTransient(e)) return e;
        throw e;
    }
}

const batches = new Map<string, Batch>();
const queues = new Map<string, Promise<void>>();

/** Haengt eine Aufgabe an die Kette der Zelle — Lesen, Mischen, Schreiben einer Zelle nie gleichzeitig. */
function serialize(key: string, task: () => Promise<void>): void {
    const next = (queues.get(key) ?? Promise.resolve()).then(task);
    queues.set(key, next);
    void next.then(() => {
        if (queues.get(key) === next) queues.delete(key);
    });
}

/** Ein Abruf fuer alle Anfragen der Welle; ersetzte Abschnitte holen weggefallene Variablen einmal nach. */
async function settle(key: string, { waiters }: Batch): Promise<void> {
    try {
        const reqs = waiters.map((w) => w.req);
        const store = waiters[0].cache;
        const entry = CellEntry.from(await store.get(key));
        const started = Date.now();
        const plan = fetchPlan(entry, reqs, started);
        let problem: unknown;
        if (countVariables(plan) > 0) {
            const needing = waiters.filter((w) => countVariables(entry.due(w.req, started)) > 0);
            problem = await refresh(entry, reqs[0], plan, needing);
            if (problem === undefined) {
                const dropped = without(union(reqs.map((r) => entry.absent(r))), plan);
                if (countVariables(dropped) > 0) {
                    problem = await refresh(
                        entry,
                        reqs[0],
                        dropped,
                        waiters.filter((w) => countVariables(entry.absent(w.req)) > 0),
                        false,
                    );
                }
                await store.set(key, entry.toJSON(), CELL_TTL_MS);
            }
        }
        const now = Date.now();
        for (const w of waiters) {
            if (problem !== undefined && countVariables(entry.absent(w.req)) > 0) {
                w.reject(problem);
                continue;
            }
            if (!w.counted) {
                w.counted = true;
                await w.cache.getOrFetch(key, CELL_TTL_MS, async () => entry.toJSON());
            }
            w.resolve(entry.answer(w.req, now, problem !== undefined));
        }
    } catch (e) {
        for (const w of waiters) w.reject(e);
    }
}

/**
 * Liefert die gefragten Variablen einer Zelle — aus dem Zelleintrag, soweit jung genug, sonst in einem
 * gebuendelten Abruf nachgeholt. Ohne Cache-Handler: ein einfacher Abruf genau dieser Variablen am Punkt.
 * Wirft `OpenMeteoBudgetError` (Budget erschoepft) oder den Abruffehler, wenn nicht jede gefragte Variable
 * gespeichert ist.
 */
export function fetchCellVariables(cache: ICacheHandler | undefined, req: CellRequest): Promise<CellResponse> {
    if (!cache) return fetchUncached(req);
    const key = openMeteoCellKey(req);
    return new Promise<CellResponse>((resolve, reject) => {
        let batch = batches.get(key);
        if (!batch) {
            const opened: Batch = { waiters: [] };
            batches.set(key, opened);
            setTimeout(() => {
                batches.delete(key);
                serialize(key, () => settle(key, opened));
            }, CELL_BATCH_WINDOW_MS);
            batch = opened;
        }
        batch.waiters.push({ req, cache, counted: false, resolve, reject });
    });
}

async function fetchUncached(req: CellRequest): Promise<CellResponse> {
    const vars = union([req]);
    const weight = callWeight(req, vars);
    if (!openMeteoBudget.fits(weight)) throw new OpenMeteoBudgetError(openMeteoBudget.retryInSeconds(weight));
    const data = await fetchDirect(req, cellUrl(req, req.lat, req.lng, vars), weight);
    const entry = CellEntry.from(undefined);
    const now = Date.now();
    entry.merge(data, vars, now);
    return entry.answer(req, now);
}

/** Anfrage an die gemeinsame Vorhersage-Zelle (7 Tage, Wind in m/s). */
export function forecastCellRequest(lat: number, lng: number, variables: CellVariables, maxAgeMs: number): CellRequest {
    return { api: OPEN_METEO_FORECAST_URL, lat, lng, params: OPEN_METEO_FORECAST_PARAMS, ...variables, maxAgeMs };
}

/**
 * Schneidet hourly und daily auf die ersten (oder letzten) `days` Ortsdaten zu — so liefert die 7-Tage-Zelle,
 * was frueher ein Abruf mit `forecast_days=days` lieferte.
 */
export function sliceDays<T extends OpenMeteoResponse>(data: T, days: number, fromEnd = false): T {
    const out = { ...data };
    for (const name of ['hourly', 'daily'] as const) {
        const section = data[name];
        const times = section?.time as string[] | undefined;
        if (!section || !times) continue;
        const dates = [...new Set(times.map((t) => t.slice(0, 10)))];
        const keep = new Set(fromEnd ? dates.slice(-days) : dates.slice(0, days));
        const index = times.flatMap((t, i) => (keep.has(t.slice(0, 10)) ? [i] : []));
        out[name] = Object.fromEntries(Object.entries(section).map(([k, col]) => [k, col && index.map((i) => col[i])]));
    }
    return out;
}

/** Haengt `stale: true` an ein Ergebnis — nur dann; frische Ergebnisse bleiben unveraendert. */
export function withStale<T extends object>(result: T, data: { stale: boolean }): T & { stale?: boolean } {
    return data.stale ? { ...result, stale: true } : result;
}
