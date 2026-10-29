import { GameStats } from './GameMain';

/**
 * ScoreStore —— 单曲最佳成绩持久化
 *
 * 存储键：`wuyin.best.<chartId>`，值为 BestRecord 的 JSON。
 * 读取时对损坏 / 非法数据做降级（返回 null），绝不因为脏数据让结算崩溃。
 */
export interface BestRecord {
    score: number;
    /** 0~1 */
    accuracy: number;
    maxCombo: number;
    /** 写入时间（毫秒时间戳，仅用于展示与排查） */
    time: number;
}

const KEY = (chartId: string) => `wuyin.best.${chartId}`;

function storageGet(key: string): string | null {
    const g: any = globalThis as any;
    try {
        if (g.wx && typeof g.wx.getStorageSync === 'function') {
            const v = g.wx.getStorageSync(key);
            return typeof v === 'string' && v.length > 0 ? v : null;
        }
        const ls = g.localStorage;
        return ls ? ls.getItem(key) : null;
    } catch (e) {
        return null;
    }
}

function storageSet(key: string, value: string): void {
    const g: any = globalThis as any;
    try {
        if (g.wx && typeof g.wx.setStorageSync === 'function') {
            g.wx.setStorageSync(key, value);
            return;
        }
        if (g.localStorage) {
            g.localStorage.setItem(key, value);
        }
    } catch (e) {
        console.warn('[ScoreStore] 写入失败', e);
    }
}

/** 读取某首谱的最佳成绩；无记录或数据损坏时返回 null */
export function getBest(chartId: string): BestRecord | null {
    if (!chartId) {
        return null;
    }
    const raw = storageGet(KEY(chartId));
    if (!raw) {
        return null;
    }
    try {
        const obj = JSON.parse(raw);
        const score = Number(obj && obj.score);
        if (!isFinite(score) || score < 0) {
            return null;
        }
        const accuracy = Number(obj && obj.accuracy);
        const maxCombo = Number(obj && obj.maxCombo);
        const time = Number(obj && obj.time);
        return {
            score: Math.round(score),
            accuracy: isFinite(accuracy) ? Math.max(0, Math.min(1, accuracy)) : 0,
            maxCombo: isFinite(maxCombo) ? Math.max(0, Math.round(maxCombo)) : 0,
            time: isFinite(time) ? time : 0,
        };
    } catch (e) {
        console.warn('[ScoreStore] 成绩解析失败，按无记录处理', chartId);
        return null;
    }
}

/**
 * 结算时调用：分数更高才覆盖旧记录。
 *
 * 返回最终的最佳成绩与是否刷新纪录；
 * 分数为 0 且从未记录过时不写入（避免用空成绩占坑）。
 */
export function saveBest(
    chartId: string,
    stats: GameStats,
): { best: BestRecord | null; isNew: boolean } {
    if (!chartId) {
        return { best: null, isNew: false };
    }

    const prev = getBest(chartId);
    const rawScore = Number(stats && stats.score);
    const score = isFinite(rawScore) ? Math.max(0, Math.round(rawScore)) : 0;
    const rawAcc = Number(stats && stats.accuracy);
    const accuracy = isFinite(rawAcc) ? Math.max(0, Math.min(1, rawAcc)) : 0;
    const rawCombo = Number(stats && stats.maxCombo);
    const maxCombo = isFinite(rawCombo) ? Math.max(0, Math.round(rawCombo)) : 0;

    if (prev && prev.score >= score) {
        return { best: prev, isNew: false };
    }
    if (score <= 0) {
        return { best: prev, isNew: false };
    }

    const best: BestRecord = { score, accuracy, maxCombo, time: Date.now() };
    storageSet(KEY(chartId), JSON.stringify(best));
    return { best, isNew: true };
}

/** 清空某首谱的最佳成绩（调试 / 玩家重置入口预留） */
export function clearBest(chartId: string): void {
    const g: any = globalThis as any;
    const key = KEY(chartId);
    try {
        if (g.wx && typeof g.wx.removeStorageSync === 'function') {
            g.wx.removeStorageSync(key);
            return;
        }
        if (g.localStorage) {
            g.localStorage.removeItem(key);
        }
    } catch (e) {
        console.warn('[ScoreStore] 清除失败', e);
    }
}
