import { AudioClip, resources } from 'cc';
import { GameConfig } from './GameConfig';

type WebAudio = any;

/** 五轨音高：五声音阶 宫 商 角 徵 羽（C D E G A） */
const LANE_TONES = [261.63, 293.66, 329.63, 392.0, 440.0];
/** 时钟启动时预留的调度余量（秒），保证 BGM 与时间原点严格对齐 */
const SCHEDULE_LEAD_SEC = 0.12;

/**
 * AudioManager —— 独立音频管理类
 *
 * 设计要点：
 *   1. 微信小游戏下使用 wx.createWebAudioContext() 创建 WebAudio 上下文；
 *      浏览器预览时自动回退到标准 AudioContext，方便桌面调试。
 *   2. 打击音不依赖任何外部素材：用代码合成 AudioBuffer，
 *      播放时创建 AudioBufferSourceNode 实例，并在 onended 中 disconnect 释放资源。
 *   3. BGM 采用「短 MP3 + AudioBuffer 循环」的流式方案：
 *      把 8~20 秒的免费素材预加载 → decodeAudioData → 循环播放，
 *      既有 BGM 又不需要长音频文件，适合小游戏体积限制。
 *   4. 整个游戏唯一的时间源是 getAudioTimeMs()（基于音频上下文时钟），
 *      不使用 Date.now() / performance.now()，避免系统时间抖动影响判定。
 */
export class AudioManager {
    private static _inst: AudioManager | null = null;

    public static get instance(): AudioManager {
        if (!AudioManager._inst) {
            AudioManager._inst = new AudioManager();
        }
        return AudioManager._inst;
    }

    private _ctx: WebAudio | null = null;
    private _master: WebAudio | null = null;
    private _bgmGain: WebAudio | null = null;
    private _pluckBuffers: WebAudio[] = [];
    private _bgmBuffer: WebAudio | null = null;
    private _bgmSource: WebAudio | null = null;
    private _keepAliveSource: WebAudio | null = null;
    private _keepAliveGain: WebAudio | null = null;
    private _clockOrigin = 0;
    private _running = false;
    private _ready = false;
    private _bgmLoaded = false;
    /** 八音盒 / 古筝风格的自定义周期波（懒创建，全局复用） */
    private _bellWave: WebAudio | null = null;

    // 钢琴采样（优先于合成音）
    private _toneBuffers: WebAudio[] = [];
    private _toneIndex: number[] = [];
    private _toneRate: number[] = [];
    private _useSamples = false;
    private _initPromise: Promise<void> | null = null;

    /** 音频上下文是否已经可用 */
    public get available(): boolean {
        return this._ready;
    }

    /** BGM 是否加载成功（没有 BGM 时游戏依然可以玩） */
    public get bgmReady(): boolean {
        return this._bgmLoaded;
    }

    /**
     * 初始化音频上下文（必须由用户触摸事件触发，微信才允许出声）。
     * 重复调用只会执行一次。
     */
    public init(): Promise<void> {
        if (!this._initPromise) {
            this._initPromise = this._doInit().catch((e) => {
                // 失败结果不能缓存：否则一次初始化失败会让整个进程内再也无法启动音频
                this._initPromise = null;
                this._ready = false;
                throw e;
            });
        }
        return this._initPromise;
    }

    private async _doInit(): Promise<void> {
        const ctx = this._createContext();
        if (!ctx) {
            throw new Error('当前环境不支持 WebAudio，无法启动音频时钟');
        }
        this._ctx = ctx;

        if (typeof ctx.resume === 'function') {
            try {
                await ctx.resume();
            } catch (e) {
                // 部分环境 resume 返回非 Promise，忽略即可
            }
        }

        const master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        this._master = master;

        // 1) 程序化合成五轨拨弦音（等价于"预加载"）
        this._buildPluckSounds();
        // 合成音就绪即可发声：BGM / 钢琴采样还在异步加载时也能立刻听到打击音，
        // 避免进入自由弹奏后前几百毫秒"点了没声音"。
        this._ready = true;
        // 2) 预加载并解码 BGM（可选）
        await this._loadBgm();
        // 3) 预加载五音钢琴采样（失败自动回退合成音）
        await this._loadToneSamples();
    }

    /** 微信小游戏优先用 wx.createWebAudioContext()，其它平台回退标准实现 */
    private _createContext(): WebAudio | null {
        const g: any = globalThis as any;
        if (g.wx && typeof g.wx.createWebAudioContext === 'function') {
            return g.wx.createWebAudioContext();
        }
        const Ctor = g.AudioContext || g.webkitAudioContext;
        return Ctor ? new Ctor() : null;
    }

    // ------------------------------------------------------------------
    // 拨弦音：程序化合成
    // ------------------------------------------------------------------

    private _buildPluckSounds(): void {
        for (let lane = 0; lane < GameConfig.laneCount; lane++) {
            const freq = LANE_TONES[lane % LANE_TONES.length];
            this._pluckBuffers[lane] = this._synthPluck(freq);
        }
    }

    /**
     * 合成拨弦音：基频 + 四个泛音，泛音衰减更快，整体约 1.2 秒余音。
     * 比打击音柔和，专门给自由弹奏用。
     */
    private _synthPluck(freq: number): WebAudio {
        const ctx = this._ctx!;
        const sampleRate = ctx.sampleRate || 44100;
        const duration = 1.2;
        const length = Math.max(1, Math.floor(sampleRate * duration));
        const buffer = ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const body = Math.exp(-t * 3.6);
            const tone =
                Math.sin(2 * Math.PI * freq * t) * 0.62 +
                Math.sin(2 * Math.PI * freq * 2 * t) * 0.26 * Math.exp(-t * 4.2) +
                Math.sin(2 * Math.PI * freq * 3 * t) * 0.12 * Math.exp(-t * 6.5) +
                Math.sin(2 * Math.PI * freq * 4.01 * t) * 0.05 * Math.exp(-t * 9);

            let attack = 0;
            const atk = 0.006;
            if (t < atk) {
                attack = (Math.random() * 2 - 1) * 0.12 * (t / atk);
            }

            const v = (tone * body + attack) * 0.55;
            data[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
        }
        return buffer;
    }

    /**
     * 按 MIDI 音高实时合成发声（按下轨道 = 演奏该音符原本的音高）
     *
     * 音色：自定义周期波（基频 + 逐次衰减的泛音）模拟八音盒/古筝的清脆拨弦，
     * 包络为 4ms 快速起音 → 140ms 中速衰减 → 1.1s 尾音。
     */
    public playNote(midi: number, velocity = 1): void {
        const ctx = this._ctx;
        if (!ctx || !this._ready) {
            return;
        }
        const m = Math.max(24, Math.min(96, Math.round(midi)));
        const freq = 440 * Math.pow(2, (m - 69) / 12);
        const t0 = ctx.currentTime;
        const peak = Math.max(0.0001, GameConfig.hitVolume * Math.max(0, Math.min(1, velocity)));

        try {
            const osc = ctx.createOscillator();
            const wave = this._getBellWave();
            if (wave) {
                osc.setPeriodicWave(wave);
            } else {
                osc.type = 'triangle';
            }
            osc.frequency.value = freq;

            const env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t0);
            env.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
            env.gain.exponentialRampToValueAtTime(peak * 0.32, t0 + 0.14);
            env.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);

            osc.connect(env);
            env.connect(this._master);
            osc.start(t0);
            osc.stop(t0 + 1.15);

            osc.onended = () => {
                try {
                    osc.disconnect();
                } catch (e) { /* 已断开 */ }
                try {
                    env.disconnect();
                } catch (e) { /* 已断开 */ }
            };
        } catch (e) {
            // 极端机型上节点创建失败，不影响判定
        }
    }

    /** 构造八音盒风格周期波：基频 + 7 个逐次衰减的泛音 */
    private _getBellWave(): WebAudio | null {
        const ctx = this._ctx;
        if (!ctx) {
            return null;
        }
        if (this._bellWave) {
            return this._bellWave;
        }
        try {
            const n = 8;
            const real = new Float32Array(n);
            const imag = new Float32Array(n);
            const amps = [0, 1, 0.42, 0.22, 0.12, 0.07, 0.04, 0.02];
            for (let i = 1; i < n; i++) {
                imag[i] = amps[i];
            }
            this._bellWave = ctx.createPeriodicWave(real, imag);
            return this._bellWave;
        } catch (e) {
            return null;
        }
    }

    /**
     * 播放拨弦音效（自由弹奏）：余音更长、更柔和。
     */
    public playPluck(lane: number): void {
        if (this._useSamples) {
            const index = this._toneIndex[lane];
            const sample = index === undefined ? null : this._toneBuffers[index];
            if (sample) {
                this._playBuffer(sample, 0.55, 0, this._toneRate[lane] || 1);
                return;
            }
        }
        this._playBuffer(this._pluckBuffers[lane] || this._pluckBuffers[0], 0.5);
    }

    /**
     * 通用播放：每次新建 AudioBufferSourceNode + GainNode，
     * onended 中必须 disconnect，否则节点会一直挂在音频图上造成内存泄漏。
     */
    private _playBuffer(buffer: WebAudio, volume: number, delaySec = 0, rate = 1): void {
        const ctx = this._ctx;
        if (!ctx || !this._ready || !buffer) {
            return;
        }

        try {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            if (rate !== 1 && source.playbackRate) {
                source.playbackRate.value = rate;
            }

            const gain = ctx.createGain();
            gain.gain.value = volume;

            source.connect(gain);
            gain.connect(this._master);

            source.onended = () => {
                try {
                    source.disconnect();
                } catch (e) { /* 已断开 */ }
                try {
                    gain.disconnect();
                } catch (e) { /* 已断开 */ }
                source.onended = null;
            };

            source.start(delaySec > 0 ? ctx.currentTime + delaySec : 0);
        } catch (e) {
            // 极端机型上 WebAudio 节点创建可能失败，不能让异常打断游戏流程
            console.warn('[AudioManager] 音效播放失败', e);
        }
    }

    // ------------------------------------------------------------------
    // BGM：短 MP3 预解码 + 循环播放
    // ------------------------------------------------------------------

    private _loadBgm(): Promise<void> {
        return new Promise<void>((resolve) => {
            resources.load(GameConfig.bgmPath, AudioClip, (err, clip) => {
                if (err || !clip) {
                    console.warn(
                        '[AudioManager] 未找到 BGM，已降级为静音时钟。\n' +
                        '如需 BGM，请把免费短音频放到 assets/resources/audio/bgm.mp3'
                    );
                    resolve();
                    return;
                }

                const raw: any = (clip as any)._nativeAsset;
                if (!raw) {
                    resolve();
                    return;
                }
                // Web 平台可能直接给出 AudioBuffer
                if (typeof raw.getChannelData === 'function') {
                    this._bgmBuffer = raw;
                    this._bgmLoaded = true;
                    resolve();
                    return;
                }
                if (!(raw instanceof ArrayBuffer)) {
                    resolve();
                    return;
                }

                // decodeAudioData 会接管（detach）原 buffer，这里先拷贝一份
                this._decodeAudio(raw.slice(0))
                    .then((buffer) => {
                        this._bgmBuffer = buffer;
                        this._bgmLoaded = true;
                        resolve();
                    })
                    .catch((e) => {
                        console.warn('[AudioManager] BGM 解码失败，已降级为静音时钟', e);
                        resolve();
                    });
            });
        });
    }

    /**
     * 预加载三个钢琴采样（C4 / F#4 / A4），用 playbackRate 变调覆盖五声音阶。
     * 采样来源：Salamander Grand Piano（CC-BY 3.0，Alexander Holm 录制）。
     */
    private async _loadToneSamples(): Promise<void> {
        const paths = ['audio/tones/c4', 'audio/tones/fs4', 'audio/tones/a4'];
        const baseFreqs = [261.63, 369.99, 440.0];

        const buffers: WebAudio[] = [];
        for (const path of paths) {
            const buffer = await this._loadClipBuffer(path);
            if (!buffer) {
                console.warn('[AudioManager] 五音采样加载失败，回退到合成音');
                return;
            }
            buffers.push(buffer);
        }

        // 每条轨道挑最近的采样，并算出变调比例（最多 2 个半音）
        const laneIndex: number[] = [];
        const laneRate: number[] = [];
        for (let lane = 0; lane < GameConfig.laneCount; lane++) {
            const target = LANE_TONES[lane % LANE_TONES.length];
            let best = 0;
            let bestDist = Number.MAX_VALUE;
            for (let i = 0; i < baseFreqs.length; i++) {
                const dist = Math.abs(Math.log(target / baseFreqs[i]));
                if (dist < bestDist) {
                    bestDist = dist;
                    best = i;
                }
            }
            laneIndex.push(best);
            laneRate.push(target / baseFreqs[best]);
        }

        this._toneBuffers = buffers;
        this._toneIndex = laneIndex;
        this._toneRate = laneRate;
        this._useSamples = true;
    }

    /** 加载单个音频资源并解码成 AudioBuffer；失败返回 null */
    private _loadClipBuffer(path: string): Promise<WebAudio | null> {
        return new Promise<WebAudio | null>((resolve) => {
            resources.load(path, AudioClip, (err, clip) => {
                if (err || !clip) {
                    resolve(null);
                    return;
                }
                const raw: any = (clip as any)._nativeAsset;
                if (!raw) {
                    resolve(null);
                    return;
                }
                if (typeof raw.getChannelData === 'function') {
                    resolve(raw);
                    return;
                }
                if (!(raw instanceof ArrayBuffer)) {
                    resolve(null);
                    return;
                }
                this._decodeAudio(raw.slice(0)).then(resolve).catch(() => resolve(null));
            });
        });
    }

    /** 兼容标准回调式与 Promise 式 decodeAudioData */
    private _decodeAudio(data: ArrayBuffer): Promise<WebAudio> {
        return new Promise<WebAudio>((resolve, reject) => {
            let settled = false;
            const ok = (buf: WebAudio) => {
                if (!settled) { settled = true; resolve(buf); }
            };
            const fail = (e: any) => {
                if (!settled) { settled = true; reject(e); }
            };
            try {
                const ret = this._ctx!.decodeAudioData(data, ok, fail);
                if (ret && typeof ret.then === 'function') {
                    ret.then(ok).catch(fail);
                }
            } catch (e) {
                fail(e);
            }
        });
    }

    // ------------------------------------------------------------------
    // 时钟
    // ------------------------------------------------------------------

    /**
     * 启动音频时钟（BGM 第 0 帧）。
     * 必须在 init() 完成后、且发生在用户手势回调链里调用。
     */
    public startClock(): void {
        if (!this._ctx || this._running) {
            return;
        }
        const ctx = this._ctx;
        this._running = true;
        this._clockOrigin = ctx.currentTime + SCHEDULE_LEAD_SEC;

        if (this._bgmBuffer) {
            try {
                const source = ctx.createBufferSource();
                source.buffer = this._bgmBuffer;
                source.loop = true;

                const gain = ctx.createGain();
                gain.gain.value = GameConfig.bgmVolume;
                source.connect(gain);
                gain.connect(this._master);
                source.start(this._clockOrigin);

                this._bgmSource = source;
                this._bgmGain = gain;
            } catch (e) {
                console.warn('[AudioManager] BGM 播放失败，改用保活时钟', e);
                this._startKeepAlive();
            }
        } else {
            this._startKeepAlive();
        }
    }

    /**
     * 用 0 振幅振荡器保活音频时钟。
     * 部分机型不支持 OscillatorNode 时静默跳过：音频上下文的 currentTime 本身仍会推进。
     */
    private _startKeepAlive(): void {
        const ctx = this._ctx;
        if (!ctx) {
            return;
        }
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.00001;
            osc.connect(gain);
            gain.connect(this._master);
            osc.start(this._clockOrigin);
            this._keepAliveSource = osc;
            this._keepAliveGain = gain;
        } catch (e) {
            console.warn('[AudioManager] 保活振荡器创建失败，仅依赖音频上下文时钟', e);
        }
    }

    /** 停止 BGM / 保活节点，并把时钟复位（用于重新开局） */
    public stopClock(): void {
        const stopSource = (node: WebAudio) => {
            if (!node) { return; }
            try { node.stop(); } catch (e) { /* 已经停止 */ }
            try { node.disconnect(); } catch (e) { /* 已经断开 */ }
        };
        const disconnectOnly = (node: WebAudio) => {
            if (!node) { return; }
            try { node.disconnect(); } catch (e) { /* 已经断开 */ }
        };
        stopSource(this._bgmSource);
        stopSource(this._keepAliveSource);
        disconnectOnly(this._bgmGain);
        disconnectOnly(this._keepAliveGain);
        this._bgmSource = null;
        this._keepAliveSource = null;
        this._bgmGain = null;
        this._keepAliveGain = null;
        this._running = false;
        this._clockOrigin = 0;
    }

    /** 重开一局：重置时钟原点，BGM 从头播放 */
    public restartClock(): void {
        this.stopClock();
        this.startClock();
    }

    /**
     * 全局唯一时间源：返回相对 BGM 第 0 帧的毫秒数。
     * 时钟启动前（或已停止）返回 0。
     */
    public getAudioTimeMs(): number {
        if (!this._ctx || !this._running) {
            return 0;
        }
        return (this._ctx.currentTime - this._clockOrigin) * 1000;
    }
}
