import { GameConfig } from './GameConfig';
import { AudioManager } from './AudioManager';
import { NotePool, NoteView } from './NotePool';
import { ChartData, ChartNote, JudgeGrade, JudgeResult } from './ChartTypes';

/** 轨道布局（由 SceneBuilder 计算后注入，GameMain 只依赖数值） */
export interface LaneLayout {
    /** 判定线的 Y 坐标（相对 Canvas 中心） */
    judgeY: number;
    /** 轨道可视顶部 Y 坐标 */
    topY: number;
    /** 四条轨道的中心 X 坐标 */
    laneX: number[];
}

export interface GameStats {
    total: number;
    totalJudged: number;
    perfect: number;
    great: number;
    good: number;
    miss: number;
    combo: number;
    maxCombo: number;
    /** 0~1 */
    accuracy: number;
    score: number;
}

export interface GameCallbacks {
    onJudge?: (result: JudgeResult, stats: GameStats) => void;
    /** 命中时触发轨道光效，并带回该音符的 MIDI 音高 */
    onHit?: (lane: number, midi: number) => void;
    /** 自动音符到点发声（半音伴奏，不需要玩家按键） */
    onAuto?: (midi: number) => void;
    onFinish?: (stats: GameStats) => void;
}

interface ActiveNote {
    data: ChartNote;
    view: NoteView;
}

type GameState = 'ready' | 'playing' | 'finished';

/**
 * GameMain —— 核心玩法主循环
 *
 * 关键约定：
 *   1. 唯一时间源是 AudioManager.getAudioTimeMs()，本类不读取任何系统时间。
 *   2. 音符位置严格按 y = judgeY + (note.time - currentAudioTime) * fallSpeed 计算。
 *   3. 点击时在"同轨道未判定音符"中取时间差最小者，
 *      再按 ±40 / ±80 / ±120 的区间给出 PERFECT / GREAT / GOOD；
 *      超过 ±120ms 则视为空气打（无判定），音符本身由主循环在超窗后标记 MISS。
 */
export class GameMain {
    private readonly _audio: AudioManager;
    private readonly _pool: NotePool;
    private readonly _callbacks: GameCallbacks;

    private _layout: LaneLayout = {
        judgeY: -400,
        topY: 600,
        laneX: [-180, -60, 60, 180],
    };

    private _notes: ChartNote[] = [];
    /** 自动播放的半音音符（不判定、不显示） */
    private _autoNotes: ChartNote[] = [];
    private _autoIndex = 0;
    private _active: ActiveNote[] = [];
    private _spawnIndex = 0;
    private _spawnAheadMs = 3000;
    private _lastNoteTime = 0;
    private _state: GameState = 'ready';
    private _stats: GameStats = this._emptyStats();
    private _score = 0;
    private _combo = 0;

    constructor(audio: AudioManager, pool: NotePool, callbacks: GameCallbacks = {}) {
        this._audio = audio;
        this._pool = pool;
        this._callbacks = callbacks;
    }

    // ------------------------------------------------------------------
    // 对外接口
    // ------------------------------------------------------------------

    public setLayout(layout: LaneLayout): void {
        this._layout = layout;
        // 可视区高度换算成"提前多少毫秒开始生成音符"
        this._spawnAheadMs = (layout.topY - layout.judgeY) / GameConfig.fallSpeed + 260;
    }

    public get state(): GameState {
        return this._state;
    }

    public get stats(): GameStats {
        return { ...this._stats };
    }

    /** 装载谱面并复位（不启动时钟） */
    public load(chart: ChartData): void {
        this._releaseAllActive();

        // 谱面 offset 在这里统一应用，判定/显示都使用同一份时间轴。
        // 同时在这里做最后一道防线：外部（导入 / 自定义）谱面可能带非法轨道、
        // 非数字时间或已经过去的音符，直接使用会让对象池越界或开局瞬间大量 MISS。
        const offset = isFinite(Number(chart.offset)) ? Number(chart.offset) : 0;
        const source = Array.isArray(chart.notes) ? chart.notes : [];
        const notes: ChartNote[] = [];
        const autoNotes: ChartNote[] = [];
        for (const note of source) {
            if (!note) {
                continue;
            }
            const time = Number(note.time);
            const lane = Number(note.lane);
            if (!isFinite(time) || !isFinite(lane)) {
                continue;
            }
            if (lane < 0 || lane >= GameConfig.laneCount) {
                continue;
            }
            if (note.type !== undefined && note.type !== 'Tap') {
                continue;
            }
            const shifted = time + offset;
            // 时间轴为负的音符在开局时已经错过判定窗口，直接丢弃
            if (shifted < 0) {
                continue;
            }
            // 保留谱面 MIDI；缺失时由 _noteMidi 回退到轨道基础音高
            const midi = Number(note.midi);
            const hasMidi = isFinite(midi) && midi > 0 && midi < 128;
            const item: ChartNote = {
                time: shifted,
                lane: Math.floor(lane),
                type: 'Tap',
                ...(hasMidi ? { midi: Math.round(midi) } : {}),
            };
            if (note.auto === true) {
                autoNotes.push(item);
            } else {
                notes.push(item);
            }
        }
        notes.sort((a, b) => a.time - b.time);
        autoNotes.sort((a, b) => a.time - b.time);
        this._notes = notes;
        this._autoNotes = autoNotes;
        this._autoIndex = 0;

        this._spawnIndex = 0;
        this._active = [];
        this._stats = this._emptyStats();
        this._stats.total = this._notes.length;
        this._lastNoteTime = this._notes.length > 0 ? this._notes[this._notes.length - 1].time : 0;
        this._score = 0;
        this._combo = 0;
        this._state = 'ready';
    }

    /** 开始游玩（需在 AudioManager.startClock() 之后调用） */
    public start(): void {
        this._state = 'playing';
    }

    /** 重开：复用已装载的谱面 */
    public restart(): void {
        this._releaseAllActive();
        this._spawnIndex = 0;
        this._autoIndex = 0;
        this._stats = this._emptyStats();
        this._stats.total = this._notes.length;
        this._score = 0;
        this._combo = 0;
        this._state = 'ready';
    }

    /** 主循环：由 GameEntry.update 每帧驱动 */
    public update(_dt: number): void {
        if (this._state !== 'playing') {
            return;
        }

        const now = this._currentTimeMs();

        // 1) 到点生成（对象池取节点）
        if (now >= 0) {
            // 自动音符（半音伴奏）到点直接发声，不需要玩家按键
            while (
                this._autoIndex < this._autoNotes.length
                && now >= this._autoNotes[this._autoIndex].time
            ) {
                const autoNote = this._autoNotes[this._autoIndex++];
                this._callbacks.onAuto?.(this._noteMidi(autoNote));
            }

            while (this._spawnIndex < this._notes.length) {
                const data = this._notes[this._spawnIndex];
                if (data.time - now > this._spawnAheadMs) {
                    break;
                }
                this._spawn(data);
                this._spawnIndex++;
            }
        }

        // 2) 刷新位置 + 超窗判 MISS
        for (let i = this._active.length - 1; i >= 0; i--) {
            const item = this._active[i];
            const y = this._layout.judgeY + (item.data.time - now) * GameConfig.fallSpeed;
            item.view.node.setPosition(this._layout.laneX[item.data.lane], y, 0);

            if (now - item.data.time > GameConfig.windows.good) {
                this._active.splice(i, 1);
                // 漏接不能瞬间消失：播放下沉淡出，动画结束后再归还对象池
                const view = item.view;
                view.playMiss(() => this._pool.release(view));
                this._registerJudge({ grade: 'MISS', diffMs: 0, lane: item.data.lane });
            }
        }

        // 3) 全部音符处理完 + 缓冲时间后结算
        if (
            this._spawnIndex >= this._notes.length &&
            this._active.length === 0 &&
            now > this._lastNoteTime + GameConfig.endDelayMs
        ) {
            this._finish();
        }
    }

    /**
     * 轨道按下（多点触控时每个触点都会调用一次）
     */
    public pressLane(lane: number): void {
        if (this._state !== 'playing' || lane < 0 || lane >= GameConfig.laneCount) {
            return;
        }
        const now = this._currentTimeMs();
        if (now < 0) {
            return;
        }

        // 找同轨道内时间差最小的音符
        let targetIndex = -1;
        let bestAbs = Number.MAX_VALUE;
        for (let i = 0; i < this._active.length; i++) {
            const item = this._active[i];
            if (item.data.lane !== lane) {
                continue;
            }
            const abs = Math.abs(item.data.time - now);
            if (abs < bestAbs) {
                bestAbs = abs;
                targetIndex = i;
            }
        }

        // 窗口外视为空气打，不消耗音符
        if (targetIndex < 0 || bestAbs > GameConfig.windows.good) {
            return;
        }

        const item = this._active[targetIndex];
        this._active.splice(targetIndex, 1);

        const diffMs = now - item.data.time; // 正数=打晚，负数=打早
        const grade = this._gradeOf(Math.abs(diffMs));

        item.view.playHit(() => this._pool.release(item.view));
        this._callbacks.onHit?.(lane, this._noteMidi(item.data));
        this._registerJudge({ grade, diffMs, lane });
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    /** 唯一时间源：音频时钟 - 全局偏移 */
    private _currentTimeMs(): number {
        return this._audio.getAudioTimeMs() - GameConfig.globalOffsetMs;
    }

    private _gradeOf(absDiff: number): JudgeGrade {
        const w = GameConfig.windows;
        if (absDiff <= w.perfect) {
            return 'PERFECT';
        }
        if (absDiff <= w.great) {
            return 'GREAT';
        }
        return 'GOOD';
    }

    private _spawn(data: ChartNote): void {
        const view = this._pool.acquire(data.lane);
        // 同轨不同八度用颜色区分：高音更亮、低音更暗
        view.setPitch(
            data.midi !== undefined ? data.midi : GameConfig.laneBaseMidi[data.lane],
            GameConfig.laneBaseMidi[data.lane],
        );
        view.node.setPosition(this._layout.laneX[data.lane], this._layout.topY, 0);
        this._active.push({ data, view });
    }

    /** 音符实际发声音高：优先谱面 MIDI，缺省回退到轨道基础音高 */
    private _noteMidi(note: ChartNote): number {
        return note.midi !== undefined ? note.midi : GameConfig.laneBaseMidi[note.lane];
    }

    private _registerJudge(result: JudgeResult): void {
        const s = this._stats;
        s.totalJudged++;

        if (result.grade === 'MISS') {
            s.miss++;
            this._combo = 0;
        } else {
            if (result.grade === 'PERFECT') {
                s.perfect++;
            } else if (result.grade === 'GREAT') {
                s.great++;
            } else {
                s.good++;
            }
            this._combo++;
            if (this._combo > s.maxCombo) {
                s.maxCombo = this._combo;
            }
            const key = result.grade.toLowerCase() as 'perfect' | 'great' | 'good';
            this._score += GameConfig.score[key] + Math.min(this._combo, 100) * 2;
        }

        s.combo = this._combo;
        s.score = this._score;
        s.accuracy = this._calcAccuracy();

        this._callbacks.onJudge?.({ ...result }, { ...s });
    }

    private _calcAccuracy(): number {
        const s = this._stats;
        const judged = s.perfect + s.great + s.good + s.miss;
        if (judged === 0) {
            return 1;
        }
        const weighted = s.perfect * 1 + s.great * 0.65 + s.good * 0.3;
        return weighted / judged;
    }

    private _finish(): void {
        this._state = 'finished';
        this._callbacks.onFinish?.({ ...this._stats });
    }

    private _releaseAllActive(): void {
        for (const item of this._active) {
            this._pool.release(item.view);
        }
        this._active = [];
    }

    private _emptyStats(): GameStats {
        return {
            total: 0,
            totalJudged: 0,
            perfect: 0,
            great: 0,
            good: 0,
            miss: 0,
            combo: 0,
            maxCombo: 0,
            accuracy: 1,
            score: 0,
        };
    }
}
