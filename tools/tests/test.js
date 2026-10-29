/**
 * 五音 · 五轨 —— 核心逻辑回归测试
 * 通过 mock 的 cc 引擎直接运行项目源码编译产物。
 */
const assert = require('assert');

// ---------- 最小 storage 替身 ----------
const store = Object.create(null);
global.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
};
function resetStorage() {
    for (const k of Object.keys(store)) { delete store[k]; }
}

// 让编译产物里的 require('cc') 指向本目录的 mock，避免依赖 node_modules
const Module = require('module');
const path = require('path');
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === 'cc') {
        return path.join(__dirname, 'mock-cc', 'index.js');
    }
    return _origResolve.call(this, request, ...rest);
};

const cc = require('cc');
const { Node, Size, Vec2 } = cc;

const ChartStore = require('./dist/core/ChartStore');
const { GameMain } = require('./dist/core/GameMain');
const { NotePool, NoteView } = require('./dist/core/NotePool');
const { GameConfig } = require('./dist/core/GameConfig');
const { ChartEditor } = require('./dist/ui/ChartEditor');
const { ChartSelect } = require('./dist/ui/ChartSelect');
const { FreePlay } = require('./dist/ui/FreePlay');
const { HUD } = require('./dist/ui/HUD');
const { computeLayout } = require('./dist/ui/SceneBuilder');
const { PromoPage } = require('./dist/ui/PromoPage');

// ---------- 极简测试框架 ----------
let passed = 0;
const failures = [];
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  PASS  ' + name);
    } catch (e) {
        failures.push({ name, message: e && e.message });
        console.log('  FAIL  ' + name + '\n        ' + (e && e.message));
    }
}
function section(title) {
    console.log('\n[' + title + ']');
}

// ---------- 公共工具 ----------
const layout = {
    width: 720,
    height: 1280,
    laneWidth: GameConfig.laneWidth,
    laneLeft: -244,
    laneRight: 244,
    laneX: [-196, -98, 0, 98, 196],
    judgeY: -390,
    topY: 470,
    topInset: 0,
};

function makeClock(t) {
    return {
        t,
        getAudioTimeMs() { return this.t; },
    };
}

function makeGame(notes, t) {
    const clock = makeClock(t);
    const layer = new Node('NoteLayer');
    const pool = new NotePool(layer);
    let finishStats = null;
    const game = new GameMain(clock, pool, {
        onFinish: (s) => { finishStats = s; },
    });
    game.setLayout(layout);
    game.load({ name: 't', bpm: 120, offset: 0, notes });
    game.start();
    return {
        game,
        pool,
        clock,
        setTime(v) { clock.t = v; },
        get finishStats() { return finishStats; },
    };
}

function chartOf(times, lane = 0) {
    return times.map((time) => ({ time, lane, type: 'Tap' }));
}

// ======================================================================
section('一、谱面解析与存储（ChartStore）');
// ======================================================================

test('normalizeChart 过滤非法 lane / 非数字 time / 非 Tap', () => {
    const raw = {
        name: '边界',
        bpm: 0,
        offset: 'abc',
        notes: [
            { time: 100, lane: 0, type: 'Tap' },
            { time: 200, lane: -1, type: 'Tap' },
            { time: 300, lane: 5, type: 'Tap' },
            { time: 'x', lane: 1, type: 'Tap' },
            { time: 400, lane: 2, type: 'Hold' },
            null,
            { time: 500, lane: 4.9, type: 'Tap' },
        ],
    };
    const c = ChartStore.normalizeChart(raw);
    assert.strictEqual(c.notes.length, 2, '应只保留 2 个合法音符');
    assert.deepStrictEqual(c.notes.map((n) => n.lane), [0, 4]);
    assert.strictEqual(c.bpm, 120, '非法 bpm 应回落 120');
    assert.strictEqual(c.offset, 0, '非法 offset 应回落 0');
});

test('normalizeChart 按时间升序排序', () => {
    const c = ChartStore.normalizeChart({
        notes: [
            { time: 900, lane: 0, type: 'Tap' },
            { time: 100, lane: 1, type: 'Tap' },
            { time: 500, lane: 2, type: 'Tap' },
        ],
    });
    assert.deepStrictEqual(c.notes.map((n) => n.time), [100, 500, 900]);
});

test('parseChartText 解析简谱文本', () => {
    const c = ChartStore.parseChartText('12345|1-2-3\n5 4 3 2 1', '简谱', 120, 'NORMAL');
    assert.ok(c, '应解析成功');
    assert.strictEqual(c.notes.length, 13);
    assert.strictEqual(c.notes[0].time, GameConfig.leadInMs);
    assert.strictEqual(c.notes[1].lane, 1);
    assert.strictEqual(c.notes[5].time, GameConfig.leadInMs + 5 * 250);
});

test('parseChartText 拒绝空文本 / 无有效音符', () => {
    assert.strictEqual(ChartStore.parseChartText('   ', 'x', 120, 'EASY'), null);
    assert.strictEqual(ChartStore.parseChartText('---\n|||', 'x', 120, 'EASY'), null);
    assert.strictEqual(ChartStore.parseChartText('{bad json', 'x', 120, 'EASY'), null);
});

test('parseChartText 导入 JSON 时保留谱面自身 bpm', () => {
    const raw = JSON.stringify({ name: '导入', bpm: 150, offset: 20, notes: chartOf([2000]) });
    const c = ChartStore.parseChartText(raw, '别名', 90, 'HARD');
    assert.ok(c);
    assert.strictEqual(c.bpm, 150);
    assert.strictEqual(c.notes[0].time, 2000);
    assert.strictEqual(c.meta.difficulty, 'HARD');
});

test('loadChart 资源缺失时回退内置谱面', () => {
    cc.__clearResources();
    const c = ChartStore.loadChart('charts/not-exist');
    assert.ok(c && typeof c.then === 'function');
    return c.then((chart) => {
        assert.ok(chart.notes.length > 0, '兜底谱面应有音符');
        assert.strictEqual(chart.bpm, 120);
    });
});

test('saveCustomChart 覆盖已有玩家谱时保持同一 id', () => {
    resetStorage();
    const first = ChartStore.saveCustomChart({
        name: 'A', bpm: 120, offset: 0, notes: chartOf([2000]),
        meta: { id: '', name: 'A', bpm: 120, difficulty: 'EASY', builtin: false, noteCount: 1 },
    });
    const second = ChartStore.saveCustomChart({
        name: 'A2', bpm: 130, offset: 0, notes: chartOf([2000, 2500]),
        meta: { id: first.id, name: 'A', bpm: 120, difficulty: 'EASY', builtin: false, noteCount: 1 },
    });
    assert.strictEqual(second.id, first.id, '覆盖保存不应生成新 id');
    assert.strictEqual(ChartStore.listCustomMetas().length, 1);
});

test('同一毫秒连续新建两份谱面不会互相覆盖', () => {
    resetStorage();
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
        const a = ChartStore.saveCustomChart({ name: 'A', bpm: 120, offset: 0, notes: chartOf([2000]), meta: { id: '', name: 'A', bpm: 120, difficulty: 'NORMAL', builtin: false, noteCount: 1 } });
        const b = ChartStore.saveCustomChart({ name: 'B', bpm: 120, offset: 0, notes: chartOf([2000]), meta: { id: '', name: 'B', bpm: 120, difficulty: 'NORMAL', builtin: false, noteCount: 1 } });
        assert.notStrictEqual(a.id, b.id, '同毫秒新建应生成不同 id');
        assert.strictEqual(ChartStore.listCustomMetas().length, 2);
    } finally {
        Date.now = realNow;
    }
});

test('deleteCustomChart 不删除内置谱', () => {
    resetStorage();
    ChartStore.deleteCustomChart('builtin-easy');
    assert.strictEqual(ChartStore.listCustomMetas().length, 0);
    assert.ok(ChartStore.listAllMetas().some((m) => m.id === 'builtin-easy'));
});

test('listAllMetas 对残缺元信息补齐默认字段', () => {
    resetStorage();
    localStorage.setItem('wuyin.chart.index', JSON.stringify([{ id: 'user-bad', name: '残缺' }]));
    localStorage.setItem('wuyin.chart.data.user-bad', JSON.stringify({
        name: '残缺', bpm: 110, offset: 0, notes: chartOf([2000, 2250]),
    }));
    const metas = ChartStore.listAllMetas();
    const bad = metas.find((m) => m.id === 'user-bad');
    assert.ok(bad, '残缺谱应仍可列出');
    assert.strictEqual(bad.difficulty, 'NORMAL');
    assert.strictEqual(bad.bpm, 110);
    assert.strictEqual(bad.noteCount, 2);
    assert.strictEqual(bad.builtin, false);
});

test('内置旋律谱已收录且数据量合理', () => {
    const expect = {
        'builtin-zizhudiao': { min: 24, diff: 'EASY', bpm: 90 },
        'builtin-molihua': { min: 20, diff: 'EASY', bpm: 90 },
        'builtin-dongfanghong': { min: 20, diff: 'EASY', bpm: 90 },
        'builtin-jinshekuangwu': { min: 100, diff: 'HARD', bpm: 150 },
        'builtin-liuyanghe': { min: 20, diff: 'EASY', bpm: 90 },
        'builtin-caiyunzuiyue': { min: 40, diff: 'NORMAL', bpm: 120 },
        'builtin-cuihuchunxiao': { min: 50, diff: 'NORMAL', bpm: 120 },
        'builtin-yuzhouchangwan': { min: 50, diff: 'NORMAL', bpm: 120 },
        'builtin-saima': { min: 100, diff: 'HARD', bpm: 150 },
    };
    const metas = ChartStore.listAllMetas();
    assert.strictEqual(metas.filter((m) => m.builtin).length, 12, '内置谱应为 12 首');
    for (const id of Object.keys(expect)) {
        const meta = metas.find((m) => m.id === id);
        assert.ok(meta, '缺少内置谱 ' + id);
        assert.strictEqual(meta.difficulty, expect[id].diff);
        assert.strictEqual(meta.bpm, expect[id].bpm);
        assert.ok(meta.noteCount >= expect[id].min, id + ' 音符过少: ' + meta.noteCount);
    }
});

// ======================================================================
section('二、判定与计分（GameMain）');
// ======================================================================

test('判定窗口边界：±40 / ±80 / ±120', () => {
    const cases = [
        [0, 'PERFECT'], [40, 'PERFECT'], [-40, 'PERFECT'],
        [41, 'GREAT'], [-41, 'GREAT'], [80, 'GREAT'], [-80, 'GREAT'],
        [81, 'GOOD'], [-81, 'GOOD'], [120, 'GOOD'], [-120, 'GOOD'],
    ];
    for (const [delta, expect] of cases) {
        const h = makeGame(chartOf([1000]), 0);
        h.game.update(0.016);            // 生成音符
        h.setTime(1000 + delta);
        const before = h.game.stats.perfect + h.game.stats.great + h.game.stats.good;
        h.game.pressLane(0);
        const s = h.game.stats;
        const after = s.perfect + s.great + s.good;
        assert.strictEqual(after - before, 1, '偏差 ' + delta + 'ms 应被判定');
        const grade = s.perfect > 0 ? 'PERFECT' : (s.great > 0 ? 'GREAT' : 'GOOD');
        assert.strictEqual(grade, expect, '偏差 ' + delta + 'ms 判定等级不匹配');
    }
});

test('超出 ±120ms 的点击不消耗音符', () => {
    const h = makeGame(chartOf([1000]), 0);
    h.game.update(0.016);
    h.setTime(1121);
    h.game.pressLane(0);
    assert.strictEqual(h.game.stats.totalJudged, 0, '空气打不应产生判定');
    assert.strictEqual(h.game.stats.miss, 0);
});

test('超窗未击打自动判 MISS 并计入统计', () => {
    const h = makeGame(chartOf([1000]), 0);
    h.game.update(0.016);
    h.setTime(1121);
    h.game.update(0.016);
    const s = h.game.stats;
    assert.strictEqual(s.miss, 1);
    assert.strictEqual(s.combo, 0);
    assert.strictEqual(s.totalJudged, 1);
});

test('MISS 的音符应播放下沉淡出动画后再回收', () => {
    let missCalls = 0;
    const original = NoteView.prototype.playMiss;
    NoteView.prototype.playMiss = function (done) {
        missCalls++;
        // 模拟动画进行中：暂不回收
    };
    try {
        const h = makeGame(chartOf([1000]), 0);
        h.game.update(0.016);
        h.setTime(1121);
        h.game.update(0.016);
        assert.strictEqual(missCalls, 1, 'MISS 时应播放播放器动画，而不是瞬间消失');
    } finally {
        NoteView.prototype.playMiss = original;
    }
});

test('非法 lane 的音符在装载时被过滤，不会击穿对象池', () => {
    const h = makeGame([{ time: 1000, lane: 9, type: 'Tap' }], 0);
    h.game.update(0.016);
    assert.strictEqual(h.game.stats.total, 0, '非法轨道音符应被丢弃');
    assert.doesNotThrow(() => h.game.pressLane(9));
});

test('非法/负数时间的音符不会污染结算', () => {
    const h = makeGame([
        { time: -5000, lane: 0, type: 'Tap' },
        { time: NaN, lane: 1, type: 'Tap' },
        { time: 1000, lane: 2, type: 'Tap' },
    ], 0);
    assert.strictEqual(h.game.stats.total, 1);
});

test('所有音符结束后延迟结算', () => {
    const h = makeGame(chartOf([1000]), 0);
    h.game.update(0.016);
    h.setTime(1000);
    h.game.pressLane(0);
    h.setTime(1000 + GameConfig.endDelayMs - 10);
    h.game.update(0.016);
    assert.strictEqual(h.finishStats, null, '延迟未到不应结算');
    h.setTime(1000 + GameConfig.endDelayMs + 10);
    h.game.update(0.016);
    assert.ok(h.finishStats, '延迟结束后应结算');
    assert.strictEqual(h.finishStats.total, 1);
});

test('连击与准确率计算', () => {
    const notes = chartOf([1000, 2000, 3000]);
    const h = makeGame(notes, 0);
    h.game.update(0.016);
    h.setTime(1000); h.game.update(0.016); h.game.pressLane(0);
    h.setTime(2000); h.game.update(0.016); h.game.pressLane(0);
    h.setTime(3100); h.game.update(0.016); h.game.pressLane(0);   // GOOD
    const s = h.game.stats;
    assert.strictEqual(s.combo, 3);
    assert.strictEqual(s.maxCombo, 3);
    assert.ok(Math.abs(s.accuracy - (1 + 1 + 0.3) / 3) < 1e-9, '准确率应为加权均值');
});

test('restart 清空统计与活动音符', () => {
    const h = makeGame(chartOf([1000, 2000]), 0);
    h.game.update(0.016);
    h.setTime(1000); h.game.pressLane(0);
    h.game.restart();
    const s = h.game.stats;
    assert.strictEqual(s.totalJudged, 0);
    assert.strictEqual(s.score, 0);
    assert.strictEqual(s.maxCombo, 0);
    assert.strictEqual(s.total, 2);
});

// ======================================================================
section('三、谱面编辑器（ChartEditor）');
// ======================================================================

function makeEditor() {
    const parent = new Node('Root');
    return new ChartEditor(parent, layout);
}

test('编辑已有谱面后保存应沿用原 id', () => {
    const editor = makeEditor();
    editor.open({
        name: '我 的 谱', bpm: 120, offset: 0, notes: chartOf([2000, 2500]),
        meta: { id: 'user-abc', name: '我 的 谱', bpm: 120, difficulty: 'HARD', builtin: false, noteCount: 2 },
    });
    const built = editor.buildChart();
    assert.strictEqual(built.meta.id, 'user-abc', '保存应覆盖原谱而非新建副本');
    assert.strictEqual(built.meta.difficulty, 'HARD');
    assert.strictEqual(built.notes.length, 2);
});

test('open 遇到非法 notes 字段不应崩溃', () => {
    const editor = makeEditor();
    assert.doesNotThrow(() => editor.open({ name: 'x', bpm: 120, offset: 0, notes: null }));
    assert.strictEqual(editor.noteCount, 0);
});

test('点击网格最底部的不可见行不应写入音符', () => {
    const editor = makeEditor();
    editor.open({ name: 'x', bpm: 120, offset: 0, notes: [] });
    editor.onTouchStart(0, -289);
    editor.onTouchEnd(0, -289);
    assert.strictEqual(editor.noteCount, 0, '不可见行不应被误写');
});

test('可见行点击可以正常增删音符', () => {
    const editor = makeEditor();
    editor.open({ name: 'x', bpm: 120, offset: 0, notes: [] });
    editor.onTouchStart(0, 300);   // 第 1 行附近
    editor.onTouchEnd(0, 300);
    assert.strictEqual(editor.noteCount, 1);
    editor.onTouchStart(0, 300);
    editor.onTouchEnd(0, 300);
    assert.strictEqual(editor.noteCount, 0, '再次点击应删除');
});

test('open → buildChart 的时间轴往返一致', () => {
    const editor = makeEditor();
    const notes = [
        { time: 2000, lane: 0, type: 'Tap' },
        { time: 2250, lane: 2, type: 'Tap' },
        { time: 3000, lane: 4, type: 'Tap' },
    ];
    editor.open({ name: 'x', bpm: 120, offset: 0, notes });
    const built = editor.buildChart();
    assert.deepStrictEqual(
        built.notes.map((n) => [n.time, n.lane]),
        [[2000, 0], [2250, 2], [3000, 4]],
    );
});

// ======================================================================
section('四、自由弹奏（FreePlay）');
// ======================================================================

test('重新进入自由弹奏后首击必须发声（触点状态不残留）', () => {
    const parent = new Node('Root');
    const free = new FreePlay(parent, layout);
    free.show();
    free.pluckAt(0, 0, 0);
    const idx = 2;
    assert.ok(free._states[idx].amplitude > 0, '首次拨弦应产生振幅');

    // 模拟振幅自然衰减归零后退出再进入
    free._states[idx].amplitude = 0;
    free.hide();
    free.show();
    free.pluckAt(0, 0, 0);
    assert.ok(free._states[idx].amplitude > 0, '再次进入后同一触点应能重新发声');
});

test('releaseTouch 清除该触点记录', () => {
    const parent = new Node('Root');
    const free = new FreePlay(parent, layout);
    free.show();
    free.pluckAt(0, 0, 7);
    free.releaseTouch(7);
    free._states[2].amplitude = 0;
    free.pluckAt(0, 0, 7);
    assert.ok(free._states[2].amplitude > 0);
});

// ======================================================================
section('五、选谱列表（ChartSelect）');
// ======================================================================

function seedCustomCharts(n) {
    resetStorage();
    const index = [];
    for (let i = 0; i < n; i++) {
        const id = 'user-' + i;
        index.push({ id, name: '谱' + i, bpm: 120, difficulty: 'NORMAL', builtin: false, noteCount: 1 });
        localStorage.setItem('wuyin.chart.data.' + id, JSON.stringify({
            name: '谱' + i, bpm: 120, offset: 0, notes: chartOf([2000]),
            meta: index[index.length - 1],
        }));
    }
    localStorage.setItem('wuyin.chart.index', JSON.stringify(index));
}

test('超出单页容量的自制谱可以通过分页访问', () => {
    seedCustomCharts(8);   // 12 内置 + 8 自制 = 20 条
    const select = new ChartSelect(new Node('Root'), layout);
    select.show();
    assert.strictEqual(select.pageCount, 4, '20 条应分为 4 页');
    assert.strictEqual(select['_rows'].length, 6, '首页显示 6 条');
    select.setPage(3);
    assert.strictEqual(select['_rows'].length, 2, '末页显示剩余 2 条');
    const ids = select['_rows'].map((r) => r.meta.id);
    assert.ok(ids.includes('user-7'), '最后一页应能看到最后一个自制谱');
});

test('仅内置谱时按 6 条一页分页', () => {
    resetStorage();
    const select = new ChartSelect(new Node('Root'), layout);
    select.show();
    assert.strictEqual(select.pageCount, 2, '12 首内置谱应分为 2 页');
    assert.strictEqual(select['_rows'].length, 6);
    select.setPage(1);
    assert.strictEqual(select['_rows'].length, 6);
});

test('setPage 会对越界页码做钳制', () => {
    seedCustomCharts(8);   // 20 条 -> 4 页
    const select = new ChartSelect(new Node('Root'), layout);
    select.show();
    select.setPage(99);
    assert.strictEqual(select.pageIndex, 3);
    select.setPage(-5);
    assert.strictEqual(select.pageIndex, 0);
});

test('难度筛选按等级过滤并重置分页', () => {
    resetStorage();
    const select = new ChartSelect(new Node('Root'), layout);
    select.show();
    assert.strictEqual(select.filter, 'ALL');
    assert.strictEqual(select.filteredCount, 12);
    assert.strictEqual(select.pageCount, 2);

    select.setFilter('EASY');
    assert.strictEqual(select.filter, 'EASY');
    assert.strictEqual(select.filteredCount, 5);
    assert.strictEqual(select.pageCount, 1);
    assert.ok(select['_rows'].every((r) => r.meta.difficulty === 'EASY'));

    select.setFilter('NORMAL');
    assert.strictEqual(select.filteredCount, 4);
    assert.ok(select['_rows'].every((r) => r.meta.difficulty === 'NORMAL'));

    select.setFilter('HARD');
    assert.strictEqual(select.filteredCount, 3);
    assert.ok(select['_rows'].every((r) => r.meta.difficulty === 'HARD'));

    select.setFilter('ALL');
    assert.strictEqual(select.filteredCount, 12);
    assert.strictEqual(select.pageIndex, 0);
});

test('筛选后翻页越界会被钳制回第一页', () => {
    seedCustomCharts(8);   // 20 条 -> 4 页
    const select = new ChartSelect(new Node('Root'), layout);
    select.show();
    select.setPage(3);
    assert.strictEqual(select.pageIndex, 3);
    select.setFilter('HARD');   // 3 条 -> 1 页
    assert.strictEqual(select.pageIndex, 0);
    assert.strictEqual(select.pageCount, 1);
});

// ======================================================================
section('六、HUD 与布局（HUD / SceneBuilder）');
// ======================================================================

test('HUD 隐藏时移出屏幕而不是切换 active（规避微信字形缓存丢失）', () => {
    const hud = new HUD(new Node('Root'), layout);
    hud.setVisible(false);
    assert.ok(hud['_root'].position.y <= -10000, '隐藏时应移出可视区');
    assert.strictEqual(hud['_root'].active, true, '不应切换 active');
    hud.setVisible(true);
    assert.strictEqual(hud['_root'].position.y, 0);
});

test('极端矮屏下判定线与轨道顶部不会交叉', () => {
    const l = computeLayout(new Size(720, 420), 120);
    assert.ok(l.topY > l.judgeY, '轨道顶部必须高于判定线');
});

// ======================================================================
section('七、宣传页（PromoPage）');
// ======================================================================

test('宣传页收录视频知识点，且左侧文案纵向不重叠', () => {
    const page = new PromoPage(new Node('Root'), layout);
    const items = [];
    for (const child of page.root.children) {
        const label = child.getComponent(cc.Label);
        if (!label) {
            continue;
        }
        items.push({ text: label.string, x: child.position.x, y: child.position.y });
    }

    const all = items.map((i) => i.text).join('\n');
    const keywords = [
        '一根弦，推出五个音', '3 : 2', '变徵', '变宫',
        '吉他', '友谊地久天长', '节奏模式', '自由弹奏',
    ];
    for (const key of keywords) {
        assert.ok(all.indexOf(key) >= 0, '宣传页缺少内容：' + key);
    }
    assert.ok(items.length >= 14, '宣传页条目过少: ' + items.length);

    const left = -layout.width / 2 + 54;
    const column = items
        .filter((i) => Math.abs(i.x - left) < 1)
        .sort((a, b) => b.y - a.y);
    assert.ok(column.length >= 10, '左侧文案行数异常: ' + column.length);

    for (let i = 1; i < column.length; i++) {
        const dy = column[i - 1].y - column[i].y;
        assert.ok(dy >= 18, '文案行距过小可能重叠: ' + column[i - 1].text.slice(0, 8)
            + ' -> ' + column[i].text.slice(0, 8) + ' = ' + dy);
    }
    for (const it of column) {
        assert.ok(it.y > -layout.height / 2 && it.y < layout.height / 2, '文案越界: ' + it.text.slice(0, 8));
    }
});

async function testAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log('  PASS  ' + name);
    } catch (e) {
        failures.push({ name, message: e && e.message });
        console.log('  FAIL  ' + name + '\n        ' + (e && e.message));
    }
}

const MELODY_IDS = [
    'builtin-zizhudiao', 'builtin-molihua', 'builtin-dongfanghong',
    'builtin-jinshekuangwu', 'builtin-liuyanghe', 'builtin-caiyunzuiyue',
    'builtin-cuihuchunxiao', 'builtin-yuzhouchangwan', 'builtin-saima',
];

(async () => {
    // ==================================================================
    section('八、音高与自动音符（MIDI / auto）');
    // ==================================================================

    await testAsync('所有旋律谱的音符都带合法 MIDI，半音只作为自动音符', async () => {
        const penta = new Set([0, 2, 4, 7, 9]);   // C D E G A
        const semi = new Set([5, 11]);            // F B
        let autoTotal = 0;
        for (const id of MELODY_IDS) {
            const chart = await ChartStore.loadChartById(id);
            assert.strictEqual(chart.meta.id, id, '谱面 id 不符: ' + id);
            assert.ok(chart.notes.length > 0, id + ' 没有音符');
            for (const n of chart.notes) {
                assert.ok(Number.isInteger(n.midi), id + ' 存在缺 MIDI 的音符: ' + JSON.stringify(n));
                const pc = n.midi % 12;
                if (n.auto === true) {
                    autoTotal++;
                    assert.ok(semi.has(pc), id + ' 自动音符应为半音 4/7，实际 MIDI ' + n.midi);
                } else {
                    assert.ok(penta.has(pc), id + ' 轨道音符出现非五声音级: MIDI ' + n.midi);
                }
            }
        }
        assert.ok(autoTotal > 0, '应至少存在一个自动音符');
    });

    await testAsync('紫竹调 / 茉莉花 / 东方红的音高细节与参考谱一致', async () => {
        const zzd = await ChartStore.loadChartById('builtin-zizhudiao');
        const zzdAuto = zzd.notes.filter((n) => n.auto).map((n) => n.midi);
        assert.strictEqual(zzdAuto.length, 3, '紫竹调应有 3 个半音（4/7/7）');
        assert.deepStrictEqual(zzdAuto.slice().sort((a, b) => a - b), [65, 71, 71]);

        const mlh = await ChartStore.loadChartById('builtin-molihua');
        assert.ok(mlh.notes.some((n) => n.midi === 72 && !n.auto), '茉莉花应含高八度宫 ^1（72）');
        assert.strictEqual(mlh.notes.filter((n) => n.auto).length, 0, '茉莉花为纯五声，不应有自动音符');

        const dfh = await ChartStore.loadChartById('builtin-dongfanghong');
        assert.ok(dfh.notes.some((n) => n.midi === 55 && !n.auto), '东方红应含低八度徵 _5（55）');
        assert.strictEqual(dfh.notes.filter((n) => n.auto).length, 2, '东方红应含 2 个半音 7');
    });

    await testAsync('normalizeChart 保留合法 MIDI，剔除非法音高', async () => {
        const c = ChartStore.normalizeChart({
            name: 'm', bpm: 120, notes: [
                { time: 100, lane: 0, type: 'Tap', midi: 72 },
                { time: 200, lane: 1, type: 'Tap', midi: 'x' },
                { time: 300, lane: 2, type: 'Tap', midi: 200 },
            ],
        });
        assert.strictEqual(c.notes.length, 3);
        assert.strictEqual(c.notes.find((n) => n.time === 100).midi, 72);
        assert.ok(!('midi' in c.notes.find((n) => n.time === 200)), '非法 MIDI 应被剔除');
        assert.ok(!('midi' in c.notes.find((n) => n.time === 300)), '越界 MIDI 应被剔除');
    });

    await testAsync('自动音符到点发声、不生成方块、不计入判定', async () => {
        const clock = makeClock(0);
        const pool = new NotePool(new Node('NoteLayer'));
        const autos = [];
        const hits = [];
        const game = new GameMain(clock, pool, {
            onAuto: (m) => autos.push(m),
            onHit: (l, m) => hits.push([l, m]),
        });
        game.setLayout(layout);
        game.load({
            name: 't', bpm: 120, offset: 0, notes: [
                { time: 1000, lane: 0, type: 'Tap', midi: 65, auto: true },
                { time: 1200, lane: 4, type: 'Tap', midi: 72 },
            ],
        });
        game.start();
        assert.strictEqual(game.stats.total, 1, '自动音符不应计入判定总数');

        clock.t = 1000;
        game.update(0.016);
        assert.deepStrictEqual(autos, [65], '自动音符应到点发声');

        clock.t = 1200;
        game.update(0.016);
        game.pressLane(4);
        assert.deepStrictEqual(hits, [[4, 72]], '命中应回传谱面 MIDI 而非轨道基础音高');

        game.restart();
        game.start();
        clock.t = 1000;
        game.update(0.016);
        assert.strictEqual(autos.length, 2, 'restart 后自动音符应重新调度');
    });

    await testAsync('同轨不同八度只改变外观，不改变轨道归属', async () => {
        const view = NoteView.create(0, new Node('NoteLayer'));
        view.setPitch(72, 60);
        assert.strictEqual(view['_octave'], 1, '高八度应标记 +1');
        view.setPitch(55, 67);
        assert.strictEqual(view['_octave'], -1, '低八度应标记 -1');
        view.setPitch(60, 60);
        assert.strictEqual(view['_octave'], 0, '同音应回到 0');
        assert.strictEqual(view.lane, 0, '视觉变化不得影响轨道号');
    });

    // ==================================================================
    // 汇总
    // ==================================================================
    console.log('\n========================================');
    console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
    if (failures.length > 0) {
        console.log('失败清单：');
        failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f.name + ' -> ' + f.message));
        process.exitCode = 1;
    }
})();
