import { JsonAsset, resources } from 'cc';
import { ChartData, ChartDifficulty, ChartMeta, ChartNote } from './ChartTypes';
import { GameConfig } from './GameConfig';

/**
 * ChartStore —— 琴谱仓库
 *
 * 职责：
 *   1. 内置 3 套不同难度的示例谱（程序生成，不占包体）
 *   2. 玩家自制谱的增删改查（微信 storage / 浏览器 localStorage）
 *   3. 从 JSON 或简谱文本导入谱面
 *   4. 兼容旧的 resources/charts/*.json 资源加载方式
 */

// ======================================================================
// 一、内置示例谱
// ======================================================================

const BPM_BY_DIFF: Record<ChartDifficulty, number> = { EASY: 90, NORMAL: 120, HARD: 150 };
/** 相邻格子的拍数：简单=四分音符，普通=八分，困难=十六分 */
const STEP_BEATS: Record<ChartDifficulty, number> = { EASY: 1, NORMAL: 0.5, HARD: 0.25 };
const REPEAT_BY_DIFF: Record<ChartDifficulty, number> = { EASY: 1, NORMAL: 2, HARD: 4 };

/** 每套谱 4 个小节模式，每格 8 个位置，-1 表示空拍 */
const BARS_BY_DIFF: Record<ChartDifficulty, number[][]> = {
    EASY: [
        [0, -1, 1, -1, 2, -1, 3, -1],
        [-1, 4, -1, 3, -1, 2, -1, 1],
        [0, -1, 2, -1, 4, -1, 2, -1],
        [1, -1, 3, -1, 1, -1, 3, -1],
    ],
    NORMAL: [
        [0, -1, 1, 2, -1, 3, -1, 4],
        [4, -1, 3, 2, -1, 1, -1, 0],
        [0, 1, 2, 3, 4, 3, 2, 1],
        [-1, 2, -1, 3, -1, 4, -1, 0],
    ],
    HARD: [
        [0, 1, 2, 3, 4, 3, 2, 1],
        [0, -1, 2, 4, 3, -1, 1, 0],
        [4, 3, 2, 1, 0, 1, 2, 3],
        [1, 3, 0, 2, 4, 2, 0, 3],
    ],
};

function buildSampleChart(id: string, name: string, difficulty: ChartDifficulty): ChartData {
    const bpm = BPM_BY_DIFF[difficulty];
    const stepMs = (60000 / bpm) * STEP_BEATS[difficulty];
    const notes: ChartNote[] = [];
    let cursor = GameConfig.leadInMs;

    for (let repeat = 0; repeat < REPEAT_BY_DIFF[difficulty]; repeat++) {
        for (const bar of BARS_BY_DIFF[difficulty]) {
            for (let i = 0; i < bar.length; i++) {
                const lane = bar[i];
                if (lane >= 0) {
                    notes.push({ time: cursor + i * stepMs, lane, type: 'Tap' });
                }
            }
            cursor += bar.length * stepMs;
        }
    }

    return {
        name,
        bpm,
        offset: 0,
        notes,
        meta: { id, name, bpm, difficulty, builtin: true, noteCount: notes.length },
    };
}

const BUILTIN_DEFS: Array<{ id: string; name: string; diff: ChartDifficulty }> = [
    { id: 'builtin-easy', name: '五音 · 初识', diff: 'EASY' },
    { id: 'builtin-normal', name: '五音 · 流云', diff: 'NORMAL' },
    { id: 'builtin-hard', name: '五音 · 疾风', diff: 'HARD' },
];

/**
 * 内置旋律谱：收录完整的五声民歌 / 古曲。
 *
 * grid 编码规则：
 *   '1'~'5'  宫商角徵羽，各占一格
 *   '-'      空拍，占一格
 *   '|' 空格 仅用于排版，不占格
 * 格长由难度决定：EASY 一拍 / NORMAL 半拍 / HARD 四分之一拍。
 * 旋律为五声音阶，跨八度的同名音统一落到同一轨（本项目只有五条固定音高轨道）。
 */
interface MelodyChartDef {
    id: string;
    name: string;
    difficulty: ChartDifficulty;
    bpm: number;
    grid: string;
}

const MELODY_DEFS: MelodyChartDef[] = [
    {
        id: 'builtin-zizhudiao',
        name: '紫竹调',
        difficulty: 'EASY',
        bpm: 90,
        grid: `
            6 5 6 1 | 5 6 5 3 | 6 5 6 1 | 5 6 4 3 |
            2 3 5 7 | 6 5 3 2 | 1 5 6 3 | 1 7 6 5 |
            3 2 3 5 | 6 5 6 -
        `,
    },
    {
        id: 'builtin-molihua',
        name: '茉莉花',
        difficulty: 'EASY',
        bpm: 90,
        grid: `
            3 3 5 ^1 | ^1 6 5 - | 3 3 5 ^1 | ^1 6 5 - |
            5 5 5 3 | 5 6 6 5 | 3 2 3 5 | 3 2 1 -
        `,
    },
    {
        id: 'builtin-dongfanghong',
        name: '东方红',
        difficulty: 'EASY',
        bpm: 90,
        grid: `
            5 5 6 2 | 1 1 6 2 | 5 5 6 ^1 | 6 5 1 1 |
            6 2 5 2 | 1 7 6 5 | _5 2 3 2 | 1 1 6 2 |
            3 2 1 2 | 1 7 6 5
        `,
    },
    {
        id: 'builtin-jinshekuangwu',
        name: '金蛇狂舞',
        difficulty: 'HARD',
        bpm: 150,
        grid: `
            2 - 1 - 6 - 1 - 5 - - - 6 - 5 - |
            6 - 5 - 6 - 5 - 3 - 2 - 3 - 2 - |
            1 - 2 - 1 - 6 - 1 - 5 - - - - - |
            5 - 6 - 1 - 2 - 3 - 5 - 6 - 5 - |
            3 - 2 - 1 - 6 - 5 - 6 - 1 - 2 - |
            2 - 1 - 6 - 1 - 5 - 5 - 5 - - - |
            5 - 6 - 1 - 2 - 3 - 5 - 6 - 5 - |
            3 - 2 - 1 - 6 - 5 - - - - - - - |
            2 - 1 - 6 - 1 - 5 - 6 - 5 - 3 - |
            2 - 1 - 6 - 1 - 5 - 5 - 5 - - - |
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 3 - 2 - 1 - 2 - 2 - 2 - - - |
            5 - 6 - 1 - 2 - 3 - 5 - 6 - 5 - |
            3 - 2 - 1 - 6 - 5 - 6 - 1 - 2 - |
            2 - 1 - 6 - 1 - 5 - 6 - 5 - 3 - |
            2 - 1 - 6 - 1 - 5 - - - - - - -
        `,
    },
    {
        id: 'builtin-liuyanghe',
        name: '浏阳河',
        difficulty: 'EASY',
        bpm: 90,
        grid: `
            - 1 1 2 | 5 5 3 2 | 3 1 - 5 | 3 5 6 5 |
            3 5 3 2 | 3 2 6 5 | 6 1 - - | 5 3 2 -
        `,
    },
    {
        id: 'builtin-caiyunzuiyue',
        name: '彩云追月',
        difficulty: 'NORMAL',
        bpm: 120,
        grid: `
            5 6 1 2 3 5 6 - | 5 5 5 4 5 - - - |
            6 1 6 5 3 5 - - | 6 1 6 5 3 5 - - |
            3 5 3 2 1 2 - - | 3 5 3 2 1 2 - - |
            5 6 1 2 3 5 6 - | 5 5 5 4 5 - - - |
            3 5 6 1 6 5 3 - | 2 3 5 3 2 1 6 - |
            5 6 1 2 3 5 6 - | 5 - - - - - - -
        `,
    },
    {
        id: 'builtin-cuihuchunxiao',
        name: '翠湖春晓',
        difficulty: 'NORMAL',
        bpm: 120,
        grid: `
            5 6 1 2 3 2 1 - | 6 5 3 5 6 - - - |
            5 6 1 2 3 5 6 - | 5 3 2 1 2 - - - |
            3 5 6 1 6 5 3 - | 2 3 5 3 2 1 6 - |
            5 6 1 2 3 2 1 - | 6 5 3 2 1 - - - |
            3 5 6 1 2 3 5 - | 6 5 3 2 1 - - - |
            5 6 1 2 3 2 1 - | 6 5 3 2 1 - - -
        `,
    },
    {
        id: 'builtin-yuzhouchangwan',
        name: '渔舟唱晚',
        difficulty: 'NORMAL',
        bpm: 120,
        grid: `
            3 - 5 6 1 2 - - | 1 - 3 5 6 3 5 3 |
            2 1 - - 3 5 6 1 | 1 3 5 2 3 2 1 6 |
            - 1 2 - 5 - - - | 3 - 5 6 1 2 - - |
            1 - 3 5 6 3 5 3 | 2 1 - - 3 5 6 1 |
            1 3 5 2 3 2 1 6 | 5 - - - 3 - 2 - |
            1 - 6 - 5 - - -
        `,
    },
    {
        id: 'builtin-saima',
        name: '赛马',
        difficulty: 'HARD',
        bpm: 150,
        grid: `
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 3 - 2 - 1 - 2 - 2 - 2 - - - |
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 3 - 2 - 1 - 2 - 2 - 2 - - - |
            5 - 6 - 1 - 2 - 3 - 5 - 6 - 5 - |
            3 - 2 - 1 - 6 - 5 - 6 - 1 - 2 - |
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 2 - 2 - - - 5 - 6 - 5 - - - |
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 3 - 2 - 1 - 2 - 2 - 2 - - - |
            5 - 6 - 1 - 2 - 3 - 5 - 6 - 5 - |
            3 - 2 - 1 - 6 - 5 - 6 - 1 - 2 - |
            2 - 3 - 2 - 1 - 2 - 3 - 2 - 1 - |
            2 - 2 - 2 - - - 5 - 6 - 5 - - - |
            2 - 1 - 6 - 1 - 5 - 5 - 5 - - - |
            2 - 1 - 6 - 1 - 5 - - - - - - -
        `,
    },
];

/**
 * 简谱数字 -> 轨道号（五声音阶：宫商角徵羽）
 * 不能用 '12345'.indexOf()：那样 5 会落到羽轨、6 会被丢弃。
 */
const LANE_BY_DIGIT: Record<string, number> = {
    '1': 0,
    '2': 1,
    '3': 2,
    '5': 3,
    '6': 4,
};

/** 五轨基础 MIDI（与 GameConfig.laneBaseMidi 一致） */
const LANE_BASE_MIDI = [60, 62, 64, 67, 69];

/** 五声轨道容纳不下的半音：4(fa)=65、7(si)=71，作为自动音符播放 */
const SEMITONE_MIDI: Record<string, number> = {
    '4': 65,
    '7': 71,
};

function buildMelodyChart(def: MelodyChartDef): ChartData {
    const stepMs = (60000 / def.bpm) * STEP_BEATS[def.difficulty];
    const notes: ChartNote[] = [];
    let cursor = GameConfig.leadInMs;
    let index = 0;

    // 按空格 / 竖线切分成「格」；'^' 升八度、'_' 降八度（只改音高，不改轨道）
    for (const token of def.grid.split(/[\s|]+/)) {
        if (!token) {
            continue;
        }
        if (token === '-') {
            index++;
            continue;
        }
        let octave = 0;
        let key = token;
        if (key.charAt(0) === '^') {
            octave = 12;
            key = key.slice(1);
        } else if (key.charAt(0) === '_') {
            octave = -12;
            key = key.slice(1);
        }
        const time = Math.round(cursor + index * stepMs);

        const lane = LANE_BY_DIGIT[key];
        if (lane !== undefined) {
            notes.push({ time, lane, type: 'Tap', midi: LANE_BASE_MIDI[lane] + octave });
        } else {
            const semi = SEMITONE_MIDI[key];
            if (semi !== undefined) {
                // 半音不进轨道：自动发声，玩家不需要按键
                notes.push({ time, lane: 0, type: 'Tap', midi: semi + octave, auto: true });
            }
        }
        index++;
    }

    return {
        name: def.name,
        bpm: def.bpm,
        offset: 0,
        notes,
        meta: {
            id: def.id,
            name: def.name,
            bpm: def.bpm,
            difficulty: def.difficulty,
            builtin: true,
            noteCount: notes.length,
        },
    };
}

function builtinChart(id: string): ChartData | null {
    const melody = MELODY_DEFS.find((d) => d.id === id);
    if (melody) {
        return buildMelodyChart(melody);
    }
    const def = BUILTIN_DEFS.find((d) => d.id === id);
    return def ? buildSampleChart(def.id, def.name, def.diff) : null;
}

// ======================================================================
// 二、玩家谱存储（微信 storage / 浏览器 localStorage）
// ======================================================================

const KEY_INDEX = 'wuyin.chart.index';
const KEY_DATA = (id: string) => `wuyin.chart.data.${id}`;

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
        console.warn('[ChartStore] 写入存储失败', e);
    }
}

function storageRemove(key: string): void {
    const g: any = globalThis as any;
    try {
        if (g.wx && typeof g.wx.removeStorageSync === 'function') {
            g.wx.removeStorageSync(key);
            return;
        }
        if (g.localStorage) {
            g.localStorage.removeItem(key);
        }
    } catch (e) {
        /* 忽略 */
    }
}

/**
 * 校验并补齐元信息。
 * 旧版本写入的索引可能缺少 difficulty / bpm / noteCount 等字段，
 * 直接透传会让选谱页显示 "undefined BPM / undefined 音"，因此统一补默认值。
 */
function normalizeMeta(v: any): ChartMeta | null {
    if (!v || typeof v.id !== 'string' || v.id.length === 0 || typeof v.name !== 'string') {
        return null;
    }
    const difficulty: ChartDifficulty =
        v.difficulty === 'EASY' || v.difficulty === 'NORMAL' || v.difficulty === 'HARD'
            ? v.difficulty
            : 'NORMAL';
    const bpm = Number(v.bpm);
    const count = Number(v.noteCount);
    return {
        id: v.id,
        name: v.name,
        bpm: isFinite(bpm) && bpm > 0 ? bpm : 120,
        difficulty,
        builtin: v.builtin === true,
        noteCount: isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    };
}

/** 玩家自制谱的元信息列表 */
export function listCustomMetas(): ChartMeta[] {
    const raw = storageGet(KEY_INDEX);
    if (!raw) {
        return [];
    }
    let arr: any;
    try {
        arr = JSON.parse(raw);
    } catch (e) {
        return [];
    }
    if (!Array.isArray(arr)) {
        return [];
    }

    const metas: ChartMeta[] = [];
    for (const item of arr) {
        const meta = normalizeMeta(item);
        if (!meta) {
            continue;
        }
        // 索引里缺失的字段回落到谱面本体，避免显示 undefined
        const rawBpm = Number(item.bpm);
        const rawCount = Number(item.noteCount);
        if (!(isFinite(rawBpm) && rawBpm > 0) || !(isFinite(rawCount) && rawCount >= 0)) {
            const data = storageGet(KEY_DATA(meta.id));
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    const bodyBpm = Number(parsed && parsed.bpm);
                    if (!(isFinite(rawBpm) && rawBpm > 0) && isFinite(bodyBpm) && bodyBpm > 0) {
                        meta.bpm = bodyBpm;
                    }
                    if (!(isFinite(rawCount) && rawCount >= 0) && parsed && Array.isArray(parsed.notes)) {
                        meta.noteCount = parsed.notes.length;
                    }
                } catch (e) {
                    /* 谱面数据损坏时保留默认值 */
                }
            }
        }
        metas.push(meta);
    }
    return metas;
}

/** 内置 + 玩家谱，按难度排序 */
export function listAllMetas(): ChartMeta[] {
    const builtins: ChartMeta[] = BUILTIN_DEFS.map((d) => {
        const chart = buildSampleChart(d.id, d.name, d.diff);
        return chart.meta!;
    });
    for (const def of MELODY_DEFS) {
        builtins.push(buildMelodyChart(def).meta!);
    }
    return builtins.concat(listCustomMetas());
}

/** 新建空白谱（编辑器入口用） */
export function createEmptyChart(name: string, bpm: number, difficulty: ChartDifficulty): ChartData {
    return {
        name,
        bpm,
        offset: 0,
        notes: [],
        meta: { id: '', name, bpm, difficulty, builtin: false, noteCount: 0 },
    };
}

/** 新建谱面 id 的自增序号，避免同一毫秒内连续新建时 id 冲突覆盖 */
let idSeq = 0;

/** 保存玩家谱（新建或覆盖），返回写入后的元信息 */
export function saveCustomChart(chart: ChartData): ChartMeta {
    const oldMeta = chart.meta;
    const id = oldMeta && oldMeta.id && !oldMeta.builtin
        ? oldMeta.id
        : `user-${Date.now()}-${(idSeq++).toString(36)}`;

    const meta: ChartMeta = {
        id,
        name: chart.name || '未命名琴谱',
        bpm: chart.bpm,
        difficulty: oldMeta ? oldMeta.difficulty : 'NORMAL',
        builtin: false,
        noteCount: chart.notes.length,
    };

    const payload: ChartData = { ...chart, meta };
    storageSet(KEY_DATA(id), JSON.stringify(payload));

    const list = listCustomMetas().filter((m) => m.id !== id);
    list.unshift(meta);
    storageSet(KEY_INDEX, JSON.stringify(list));
    return meta;
}

/** 删除玩家谱（内置谱不可删除） */
export function deleteCustomChart(id: string): void {
    if (id.indexOf('builtin-') === 0) {
        return;
    }
    storageRemove(KEY_DATA(id));
    const list = listCustomMetas().filter((m) => m.id !== id);
    storageSet(KEY_INDEX, JSON.stringify(list));
}

/** 按 id 加载谱面：内置谱即时生成，玩家谱读存储，失败回退兜底谱 */
export function loadChartById(id: string): Promise<ChartData> {
    const builtin = builtinChart(id);
    if (builtin) {
        return Promise.resolve(builtin);
    }
    const raw = storageGet(KEY_DATA(id));
    if (raw) {
        try {
            return Promise.resolve(normalizeChart(JSON.parse(raw)));
        } catch (e) {
            console.warn('[ChartStore] 玩家谱解析失败，回退兜底谱', id);
        }
    }
    return Promise.resolve(buildFallbackChart());
}

// ======================================================================
// 三、导入：JSON 谱面 / 简谱文本
// ======================================================================

/**
 * 解析导入文本：
 *   1. 以 { 开头 → 当作 JSON 谱面
 *   2. 否则当作简谱文本：每行一小节，1~5 表示宫商角徵羽，"." 或 "0" 为空拍，
 *      "|" 与空格作分隔，"-" 表示延音（不占格）
 */
export function parseChartText(
    text: string,
    name: string,
    bpm: number,
    difficulty: ChartDifficulty,
): ChartData | null {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.charAt(0) === '{') {
        try {
            const parsed = normalizeChart(JSON.parse(trimmed));
            if (parsed.notes.length === 0) {
                return null;
            }
            parsed.meta = { id: '', name, bpm: parsed.bpm, difficulty, builtin: false, noteCount: parsed.notes.length };
            return parsed;
        } catch (e) {
            return null;
        }
    }

    // 简谱文本：一格 = 半拍
    const stepMs = 30000 / bpm;
    const notes: ChartNote[] = [];
    let cursor = GameConfig.leadInMs;
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);

    for (const line of lines) {
        let index = 0;
        for (const ch of line) {
            if (ch === '|' || ch === ' ' || ch === '\t' || ch === '-') {
                continue;
            }
            const lane = '12345'.indexOf(ch);
            if (lane >= 0) {
                notes.push({ time: cursor + index * stepMs, lane, type: 'Tap' });
            }
            index++;
        }
        cursor += Math.max(index, 8) * stepMs;
    }

    if (notes.length === 0) {
        return null;
    }
    return {
        name,
        bpm,
        offset: 0,
        notes,
        meta: { id: '', name, bpm, difficulty, builtin: false, noteCount: notes.length },
    };
}

/** 从剪贴板读取并解析（微信优先，浏览器兜底） */
export function importFromClipboard(
    name: string,
    bpm: number,
    difficulty: ChartDifficulty,
): Promise<ChartData | null> {
    return new Promise<ChartData | null>((resolve) => {
        const g: any = globalThis as any;
        try {
            if (g.wx && typeof g.wx.getClipboardData === 'function') {
                g.wx.getClipboardData({
                    success: (res: any) => resolve(parseChartText(String(res.data || ''), name, bpm, difficulty)),
                    fail: () => resolve(null),
                });
                return;
            }
        } catch (e) {
            /* 继续尝试浏览器剪贴板 */
        }
        try {
            const nav: any = g.navigator;
            if (nav && nav.clipboard && typeof nav.clipboard.readText === 'function') {
                nav.clipboard.readText()
                    .then((t: string) => resolve(parseChartText(t, name, bpm, difficulty)))
                    .catch(() => resolve(null));
                return;
            }
        } catch (e) {
            /* 忽略 */
        }
        resolve(null);
    });
}

// ======================================================================
// 四、资源谱面（兼容旧路径）
// ======================================================================

export function loadChart(path: string = GameConfig.chartPath): Promise<ChartData> {
    return new Promise<ChartData>((resolve) => {
        resources.load(path, JsonAsset, (err, asset) => {
            if (err || !asset) {
                console.warn('[ChartStore] 未找到谱面资源，使用内置兜底谱面:', path);
                resolve(buildFallbackChart());
                return;
            }
            resolve(normalizeChart(asset.json));
        });
    });
}

/** 校验 + 归一化，过滤非法字段，并按时间排序 */
export function normalizeChart(raw: any): ChartData {
    const notes: ChartNote[] = [];
    const list = raw && Array.isArray(raw.notes) ? raw.notes : [];

    for (const item of list) {
        if (!item) {
            continue;
        }
        const time = Number(item.time);
        const lane = Number(item.lane);
        const type = item.type;

        if (!isFinite(time) || !isFinite(lane)) {
            continue;
        }
        // 极简格式：只支持 Tap
        if (type !== 'Tap') {
            continue;
        }
        if (lane < 0 || lane >= GameConfig.laneCount) {
            continue;
        }
        // 保留 MIDI，导入带音高的谱面时可直接发声
        const midi = Number(item.midi);
        const hasMidi = isFinite(midi) && midi > 0 && midi < 128;
        notes.push({
            time,
            lane: Math.floor(lane),
            type: 'Tap',
            ...(hasMidi ? { midi: Math.round(midi) } : {}),
        });
    }

    notes.sort((a, b) => a.time - b.time);

    return {
        name: typeof raw?.name === 'string' ? raw.name : '五音 · 五轨',
        bpm: Number(raw?.bpm) || 120,
        offset: Number(raw?.offset) || 0,
        notes,
        meta: raw?.meta,
    };
}

/** 相邻八分音符 = 250ms（120 BPM） */
const STEP_MS = 250;

/** 一小节 8 个八分位置，-1 表示空拍 */
const PATTERNS: number[][] = [
    [0, -1, 1, -1, 2, -1, 3, -1],
    [-1, 1, -1, 2, -1, 3, -1, 4],
    [0, -1, 2, -1, 4, -1, 2, -1],
    [1, 2, 1, 2, 3, 4, 3, 4],
    [0, 1, 2, 3, 4, 3, 2, 1],
    [4, -1, 3, -1, 2, -1, 1, -1],
    [0, 0, 2, 2, 4, 4, 2, 2],
    [0, 2, 4, 2, 1, 3, 1, 3],
];

/** 内置兜底谱面：128 个八分位置循环两遍，约 34 秒 */
export function buildFallbackChart(): ChartData {
    const notes: ChartNote[] = [];
    let cursor = GameConfig.leadInMs;

    for (let repeat = 0; repeat < 2; repeat++) {
        for (const bar of PATTERNS) {
            for (let i = 0; i < bar.length; i++) {
                const lane = bar[i];
                if (lane >= 0) {
                    notes.push({
                        time: cursor + i * STEP_MS,
                        lane,
                        type: 'Tap',
                    });
                }
            }
            cursor += bar.length * STEP_MS;
        }
    }

    return {
        name: '五音 · 五轨',
        bpm: 120,
        offset: 0,
        notes,
    };
}
