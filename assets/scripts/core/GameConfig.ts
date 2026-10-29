/**
 * GameConfig —— 全局玩法参数（手感调试的唯一入口）
 *
 * 时间单位约定：
 *   - 谱面时间 time        : 毫秒（相对 BGM 第 0 帧）
 *   - 音频时钟 getAudioTimeMs(): 毫秒
 *   - fallSpeed            : 像素 / 毫秒
 */
export const GameConfig = {
    // ---------- 分辨率 ----------
    designWidth: 720,
    designHeight: 1280,

    // ---------- 轨道布局 ----------
    laneCount: 5,
    laneWidth: 96,
    laneGap: 10,

    // ---------- 音符外观（参考视频的方形圆角块） ----------
    noteWidth: 58,
    noteHeight: 58,
    noteRadius: 16,

    // ---------- 下落与判定 ----------
    /** 判定线距离屏幕底部的像素 */
    judgeLineFromBottom: 250,
    /** 下落速度：像素 / 毫秒（0.62 ≈ 620 px/s，音符约 2 秒从顶部落到判定线） */
    fallSpeed: 0.62,
    /** 判定区间（毫秒） */
    windows: {
        perfect: 40,
        great: 80,
        good: 120,
    },
    /** 最后一个音符结束后，延迟多久结算 */
    endDelayMs: 1400,

    // ---------- 分数 ----------
    score: {
        perfect: 100,
        great: 65,
        good: 30,
        miss: 0,
    },

    // ---------- 谱面 ----------
    /** 首音符前的空拍时间，同时作为"准备"时间 */
    leadInMs: 2000,
    chartPath: 'charts/demo',
    /** BGM 资源路径（相对 assets/resources，不带扩展名） */
    bgmPath: 'audio/bgm',

    // ---------- 手感校准（硬编码占位，后续真机调试直接改这里） ----------
    /**
     * 全局偏移校准（毫秒）
     *
     * 语义：实际用于判定的时间 = getAudioTimeMs() - globalOffsetMs
     *   - 玩家反馈"总是打早"（音符还没到线就判定成功） -> 调大该值（如 +30）
     *   - 玩家反馈"总是打晚"（音符过线了才判定成功）     -> 调小该值（如 -30）
     *
     * 微信小游戏 Android 真机常见蓝牙/有线耳机输出延迟 40~180ms，
     * 建议先用耳机在真机上跑 3 局，观察 HUD 的 OFFSET 均值再回填。
     */
    globalOffsetMs: 0,

    /** 命中音效音量（0~1） */
    hitVolume: 0.55,
    /** BGM 音量（0~1） */
    bgmVolume: 0.65,

    /** 五轨基础 MIDI：宫 C4 / 商 D4 / 角 E4 / 徵 G4 / 羽 A4 */
    laneBaseMidi: [60, 62, 64, 67, 69],
};
