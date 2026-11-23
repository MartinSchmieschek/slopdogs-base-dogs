/**
 * =========================================================================
 *  OPEN-METEO BUDGET — gewichtete Abrufe zaehlen, bevor Open-Meteo es tut
 * =========================================================================
 *
 *  Die freie API erlaubt 600 Abrufe je Minute, 5.000 je Stunde, 10.000 je Tag
 *  und 300.000 je Monat — fuer alle Kennels hinter der einen Server-IP zusammen.
 *  Der Waechter zaehlt im Prozess und bleibt mit festen Grenzen darunter.
 */

/** Ab so vielen Variablen zaehlt ein Abruf anteilig mehr (Open-Meteo). */
export const OPEN_METEO_MAX_VARIABLES = 10;
/** Ab so vielen Tagen Zeitraum zaehlt ein Abruf anteilig mehr (Open-Meteo). */
export const OPEN_METEO_FREE_PERIOD_DAYS = 14;

/**
 * Eigene Grenzen je Fenster, mit Abstand unter den freien Grenzen 600/min, 5.000/h, 10.000/Tag —
 * Spielraum fuer Abrufe, die an diesem Waechter vorbeigehen (Archiv-Dogs, Marine, ein zweiter Prozess).
 */
export const OPEN_METEO_BUDGET_PER_MINUTE = 500;
export const OPEN_METEO_BUDGET_PER_HOUR = 4500;
export const OPEN_METEO_BUDGET_PER_DAY = 9000;

/**
 * Gewicht eines Abrufs (ein Ort) wie im Open-Meteo-Server, `calculateQueryWeight` in
 * https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Writer/ForecastApiResult.swift:
 * `max(1, (Variablen × Modelle / 10) × max(1, Tage / 14))`. Das `max(1, …)` gilt dem Produkt, nicht jedem
 * Faktor: 5 Variablen ueber 28 Tage = 1, 15 Variablen ueber 14 Tage = 1,5. Variablen zaehlen ueber hourly,
 * daily und current zusammen, Tage = forecast_days + past_days.
 */
export function openMeteoCallWeight(variables: number, days: number, models = 1): number {
    return Math.max(1, ((variables * models) / OPEN_METEO_MAX_VARIABLES) * Math.max(1, days / OPEN_METEO_FREE_PERIOD_DAYS));
}

/** Abruf verweigert: das Budget eines Fensters ist voll. */
export class OpenMeteoBudgetError extends Error {
    constructor(readonly retryInSeconds: number) {
        super(`Open-Meteo budget reached, retry in ${retryInSeconds} s`);
        this.name = 'OpenMeteoBudgetError';
    }
}

export interface OpenMeteoBudgetWindow {
    used: number;
    limit: number;
}

export interface OpenMeteoBudgetStatus {
    minute: OpenMeteoBudgetWindow;
    hour: OpenMeteoBudgetWindow;
    day: OpenMeteoBudgetWindow;
}

const WINDOWS = [
    { name: 'minute', ms: 60_000, limit: OPEN_METEO_BUDGET_PER_MINUTE },
    { name: 'hour', ms: 3_600_000, limit: OPEN_METEO_BUDGET_PER_HOUR },
    { name: 'day', ms: 86_400_000, limit: OPEN_METEO_BUDGET_PER_DAY },
] as const;

/** Gleitende Fenster ueber die gewichteten Abrufe der letzten 24 Stunden. */
export class OpenMeteoBudget {
    private calls: Array<{ at: number; weight: number }> = [];

    /** Passt ein Abruf dieses Gewichts in alle Fenster? Bucht nichts. */
    fits(weight: number, now = Date.now()): boolean {
        this.prune(now);
        return WINDOWS.every((w) => this.used(w.ms, now) + weight <= w.limit);
    }

    /** Bucht den Abruf, wenn er in alle Fenster passt; sonst `false`, ohne zu buchen. */
    tryConsume(weight: number, now = Date.now()): boolean {
        if (!this.fits(weight, now)) return false;
        this.calls.push({ at: now, weight });
        return true;
    }

    /** Sekunden, bis ein Abruf dieses Gewichts wieder in alle Fenster passt. */
    retryInSeconds(weight: number, now = Date.now()): number {
        let waitMs = 0;
        for (const w of WINDOWS) {
            let excess = this.used(w.ms, now) + weight - w.limit;
            for (const c of this.calls) {
                if (excess <= 0) break;
                if (c.at <= now - w.ms) continue;
                excess -= c.weight;
                waitMs = Math.max(waitMs, c.at + w.ms - now);
            }
        }
        return Math.max(1, Math.ceil(waitMs / 1000));
    }

    status(now = Date.now()): OpenMeteoBudgetStatus {
        this.prune(now);
        const window = (ms: number, limit: number) => ({ used: Math.round(this.used(ms, now) * 1000) / 1000, limit });
        return {
            minute: window(WINDOWS[0].ms, WINDOWS[0].limit),
            hour: window(WINDOWS[1].ms, WINDOWS[1].limit),
            day: window(WINDOWS[2].ms, WINDOWS[2].limit),
        };
    }

    reset(): void {
        this.calls = [];
    }

    private used(windowMs: number, now: number): number {
        return this.calls.reduce((sum, c) => (c.at > now - windowMs ? sum + c.weight : sum), 0);
    }

    private prune(now: number): void {
        const dayAgo = now - WINDOWS[2].ms;
        if (this.calls.length > 0 && this.calls[0].at <= dayAgo) this.calls = this.calls.filter((c) => c.at > dayAgo);
    }
}

/** Der eine Waechter des Prozesses — alle Zellen-Abrufe buchen hier. */
export const openMeteoBudget = new OpenMeteoBudget();

/** Verbrauch und Grenzen je Fenster, fuer Tests und Diagnose. */
export function openMeteoBudgetStatus(): OpenMeteoBudgetStatus {
    return openMeteoBudget.status();
}
