/**
 * ChartTypes —— 极简谱面数据格式
 *
 * 一份谱面就是一个 JSON：
 * {
 *   "name": "五音 · 四轨",
 *   "bpm": 120,
 *   "offset": 0,
 *   "notes": [
 *     { "time": 2000, "lane": 0, "type": "Tap" },
 *     ...
 *   ]
 * }
 *
 * 字段说明：
 *   time  : 毫秒时间戳（相对 BGM 第 0 帧，而非系统时间）
 *   lane  : 轨道编号 0~3（从左到右）
 *   type  : 仅支持 "Tap"
 */
export type NoteType = 'Tap';

/** 难度等级（仅影响选谱分类与默认 BPM，不影响判定规则） */
export type ChartDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface ChartNote {
    time: number;
    lane: number;
    type: NoteType;
    /** 精确 MIDI 音高（60=中音C，72=高音C）。缺省时回退到轨道基础音高。 */
    midi?: number;
    /**
     * 自动音符：到点自动发声，不生成下落方块、不参与判定。
     * 用于五声轨道容纳不下的半音（4 / 7），保证旋律完整。
     */
    auto?: boolean;
}

/** 谱面元信息：选谱列表与琴谱管理使用 */
export interface ChartMeta {
    id: string;
    name: string;
    bpm: number;
    difficulty: ChartDifficulty;
    /** 内置谱面不可删除 */
    builtin: boolean;
    noteCount: number;
}

export interface ChartData {
    name: string;
    bpm: number;
    /** 谱面整体偏移（毫秒），正数表示所有音符整体延后 */
    offset: number;
    notes: ChartNote[];
    /** 选谱页携带的元信息（旧谱面可缺省） */
    meta?: ChartMeta;
}

export type JudgeGrade = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

/** 一次判定的结果，供 HUD 与统计使用 */
export interface JudgeResult {
    grade: JudgeGrade;
    /** 实际偏差（毫秒）：负数=打早了，正数=打晚了 */
    diffMs: number;
    lane: number;
}
