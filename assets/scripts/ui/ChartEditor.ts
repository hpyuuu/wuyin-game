import {
    Color, Graphics, Label, Layers, Node, UITransform,
} from 'cc';
import { ChartData, ChartDifficulty, ChartNote } from '../core/ChartTypes';
import { GameConfig } from '../core/GameConfig';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, COLOR_TEXT_DIM, FONT_SANS, FONT_SERIF, LANE_COLORS, withAlpha,
} from './Theme';

/** 编辑器画布：128 行 × 5 轨，每行 = 半拍 */
const ROWS = 128;
const LANES = 5;
const ROW_H = 46;
const COL_W = 96;
const GRID_TOP = 352;
const GRID_BOTTOM = -290;
const GRID_W = LANES * COL_W;
const VISIBLE_ROWS = Math.floor((GRID_TOP - GRID_BOTTOM) / ROW_H);
const MAX_SCROLL = ROWS - VISIBLE_ROWS;

const BPM_OPTIONS = [90, 120, 150];
const DIFF_OPTIONS: ChartDifficulty[] = ['EASY', 'NORMAL', 'HARD'];

/**
 * 隐藏时把整页移到屏幕外而不是切 active：
 * 微信真机上 Label 在 active 反复切换后会丢失字形缓存，整页文字变空白。
 */
const EDITOR_HIDDEN_Y = -20000;

/** 点击结果，交由 GameEntry 分发 */
export type EditorHit =
    | { type: 'save' }
    | { type: 'play' }
    | { type: 'bpm'; value: number }
    | { type: 'difficulty'; value: ChartDifficulty }
    | { type: 'grid' };

/**
 * ChartEditor —— 可视化琴谱编辑器
 *
 * 操作：
 *   点击网格格子 = 添加 / 删除音符
 *   上下拖动     = 滚动时间轴
 *   顶部按钮     = 切换 BPM（90/120/150）与难度
 *   底部按钮     = 保存 / 试听
 *
 * 渲染分层（避免 Graphics 路径互相污染）：
 *   背景层 / 网格线层 / 5 个轨道音符层，各自 clear + 重绘。
 */
export class ChartEditor {
    private readonly _root: Node;
    private readonly _btnRoot: Node;

    private readonly _bgGfx: Graphics;
    private readonly _lineGfx: Graphics;
    private readonly _laneGfx: Graphics[] = [];
    private readonly _countLabel: Label;
    private readonly _nameLabel: Label;

    private _cells: boolean[][] = [];
    /** 当前编辑的玩家谱 id（空字符串 = 新建） */
    private _id = '';
    private _name = '新 谱';
    private _bpm = 120;
    private _difficulty: ChartDifficulty = 'NORMAL';
    private _scrollRow = 0;
    /** 顶部 / 底部按钮节点（用于统一按压反馈） */
    private readonly _buttonNodes = new Map<string, Node>();

    /** 拖动状态：位移小于阈值视为点击 */
    private _dragging = false;
    private _dragStartY = 0;
    private _dragStartScroll = 0;

    constructor(parent: Node, layout: LayoutInfo) {

        this._root = new Node('ChartEditor');
        this._root.layer = Layers.Enum.UI_2D;
        this._root.addComponent(UITransform).setContentSize(layout.width, layout.height);
        parent.addChild(this._root);

        // ---- 背景层 ----
        const bgNode = new Node('GridBg');
        bgNode.layer = Layers.Enum.UI_2D;
        bgNode.addComponent(UITransform);
        this._root.addChild(bgNode);
        this._bgGfx = bgNode.addComponent(Graphics);

        // ---- 网格线层 ----
        const lineNode = new Node('GridLines');
        lineNode.layer = Layers.Enum.UI_2D;
        lineNode.addComponent(UITransform);
        this._root.addChild(lineNode);
        this._lineGfx = lineNode.addComponent(Graphics);

        // ---- 5 个轨道音符层 ----
        for (let lane = 0; lane < LANES; lane++) {
            const node = new Node(`Lane_${lane}`);
            node.layer = Layers.Enum.UI_2D;
            node.addComponent(UITransform);
            this._root.addChild(node);
            this._laneGfx.push(node.addComponent(Graphics));
        }

        // ---- 顶部文本 ----
        this._nameLabel = this._makeLabel('', 18, COLOR_TEXT, 0, 500, 0.5, FONT_SERIF, true);
        this._countLabel = this._makeLabel('', 13, COLOR_TEXT_DIM, 0, -430, 0.5, FONT_SANS);

        const btnRoot = new Node('Buttons');
        btnRoot.layer = Layers.Enum.UI_2D;
        btnRoot.addComponent(UITransform).setContentSize(layout.width, layout.height);
        this._root.addChild(btnRoot);
        this._btnRoot = btnRoot;

        this._root.setPosition(0, EDITOR_HIDDEN_Y, 0);
    }

    // ------------------------------------------------------------------
    // 对外接口
    // ------------------------------------------------------------------

    /** 进入编辑（从选谱页新建或修改已有谱） */
    public open(chart: ChartData): void {
        this._name = chart.name || '新 谱';
        // 导入的 JSON 谱可能把 bpm 写成字符串，统一转成数字再参与计算
        const bpm = Number(chart.bpm);
        this._bpm = isFinite(bpm) && bpm > 0 ? bpm : 120;
        const diff = chart.meta && chart.meta.difficulty;
        this._difficulty = diff === 'EASY' || diff === 'NORMAL' || diff === 'HARD' ? diff : 'NORMAL';
        // 记住原有 id：保存时沿用，避免每次保存都新建一份副本
        this._id = chart.meta && typeof chart.meta.id === 'string' ? chart.meta.id : '';

        // 行 → 半拍
        this._cells = [];
        for (let row = 0; row < ROWS; row++) {
            const line: boolean[] = [];
            for (let lane = 0; lane < LANES; lane++) {
                line.push(false);
            }
            this._cells.push(line);
        }

        const stepMs = (60000 / this._bpm) * 0.5;
        const sourceNotes = Array.isArray(chart.notes) ? chart.notes : [];
        for (const note of sourceNotes) {
            if (!note) {
                continue;
            }
            const row = Math.round((note.time - GameConfig.leadInMs) / stepMs);
            if (row >= 0 && row < ROWS && note.lane >= 0 && note.lane < LANES) {
                this._cells[row][note.lane] = true;
            }
        }

        this._scrollRow = 0;
        this._root.setPosition(0, 0, 0);
        this._redrawButtons();
        this._redrawAll();
    }

    public hide(): void {
        this._root.setPosition(0, EDITOR_HIDDEN_Y, 0);
    }

    public setBpm(bpm: number): void {
        this._bpm = bpm;
        this._redrawButtons();
    }

    public setDifficulty(diff: ChartDifficulty): void {
        this._difficulty = diff;
        this._redrawButtons();
    }

    /** 判断点击落在哪个控件上（非网格返回具体动作，网格返回 grid） */
    public hitTest(x: number, y: number): EditorHit | null {
        if (this._inside(x, y, -100, -356, 150, 58)) {
            return { type: 'save' };
        }
        if (this._inside(x, y, 100, -356, 150, 58)) {
            return { type: 'play' };
        }
        for (let i = 0; i < BPM_OPTIONS.length; i++) {
            if (this._inside(x, y, -120 + i * 120, 444, 96, 42)) {
                return { type: 'bpm', value: BPM_OPTIONS[i] };
            }
        }
        for (let i = 0; i < DIFF_OPTIONS.length; i++) {
            if (this._inside(x, y, -150 + i * 150, 392, 110, 42)) {
                return { type: 'difficulty', value: DIFF_OPTIONS[i] };
            }
        }
        if (y <= GRID_TOP && y >= GRID_BOTTOM && Math.abs(x) <= GRID_W / 2) {
            return { type: 'grid' };
        }
        return null;
    }

    /** 网格按下：记录起点，抬起时判断是点击还是拖动 */
    public onTouchStart(x: number, y: number): void {
        this._dragging = false;
        this._dragStartY = y;
        this._dragStartScroll = this._scrollRow;
    }

    public onTouchMove(x: number, y: number): void {
        const dy = y - this._dragStartY;
        if (Math.abs(dy) > 10) {
            this._dragging = true;
        }
        if (!this._dragging) {
            return;
        }
        const next = this._dragStartScroll - Math.round(dy / ROW_H);
        const clamped = Math.max(0, Math.min(MAX_SCROLL, next));
        if (clamped !== this._scrollRow) {
            this._scrollRow = clamped;
            this._redrawGrid();
        }
    }

    public onTouchEnd(x: number, y: number): void {
        if (this._dragging) {
            this._dragging = false;
            return;
        }
        const row = this._rowAt(y);
        const lane = this._laneAt(x);
        if (row < 0 || row >= ROWS || lane < 0 || lane >= LANES) {
            return;
        }
        // 只允许操作当前可见的行：网格底部半行不可见，误点会改到看不见的格子
        if (row < this._scrollRow || row >= this._scrollRow + VISIBLE_ROWS) {
            return;
        }
        if (!this._cells[row]) {
            return;
        }
        this._cells[row][lane] = !this._cells[row][lane];
        this._redrawGrid();
        this._updateCount();
    }

    /** 生成谱面数据（保存 / 试听共用） */
    public buildChart(): ChartData {
        const stepMs = (60000 / this._bpm) * 0.5;
        const notes: ChartNote[] = [];

        for (let row = 0; row < ROWS; row++) {
            for (let lane = 0; lane < LANES; lane++) {
                if (this._cells[row][lane]) {
                    notes.push({
                        time: Math.round(GameConfig.leadInMs + row * stepMs),
                        lane,
                        type: 'Tap',
                    });
                }
            }
        }

        return {
            name: this._name,
            bpm: this._bpm,
            offset: 0,
            notes,
            meta: {
                id: this._id,
                name: this._name,
                bpm: this._bpm,
                difficulty: this._difficulty,
                builtin: false,
                noteCount: notes.length,
            },
        };
    }

    public get noteCount(): number {
        let total = 0;
        for (let row = 0; row < ROWS; row++) {
            for (let lane = 0; lane < LANES; lane++) {
                if (this._cells[row][lane]) {
                    total++;
                }
            }
        }
        return total;
    }

    // ------------------------------------------------------------------
    // 绘制
    // ------------------------------------------------------------------

    private _redrawAll(): void {
        this._nameLabel.string = this._name;
        this._redrawGrid();
        this._updateCount();
    }

    private _updateCount(): void {
        this._countLabel.string = `音符 ${this.noteCount}  ·  点击格子增删  ·  上下拖动滚动`;
    }

    private _redrawGrid(): void {
        const left = -GRID_W / 2;
        const right = GRID_W / 2;

        // 背景
        this._bgGfx.clear();
        this._bgGfx.roundRect(left - 8, GRID_BOTTOM - 8, GRID_W + 16, GRID_TOP - GRID_BOTTOM + 16, 12);
        this._bgGfx.fillColor = new Color(255, 255, 255, 9);
        this._bgGfx.fill();
        this._bgGfx.lineWidth = 1;
        this._bgGfx.strokeColor = withAlpha(COLOR_TEXT, 34);
        this._bgGfx.stroke();

        // 网格线（所有线一次描边）
        const lines = this._lineGfx;
        lines.clear();
        lines.lineWidth = 1;
        lines.strokeColor = new Color(58, 64, 74, 255);

        for (let i = 0; i <= VISIBLE_ROWS; i++) {
            const y = GRID_TOP - i * ROW_H;
            if (y < GRID_BOTTOM) {
                break;
            }
            lines.moveTo(left, y);
            lines.lineTo(right, y);
        }
        for (let col = 0; col <= LANES; col++) {
            const x = left + col * COL_W;
            lines.moveTo(x, GRID_TOP);
            lines.lineTo(x, GRID_BOTTOM);
        }
        lines.stroke();

        // 音符（每轨一个 Graphics，同色一次填充）
        const noteW = COL_W - 22;
        const noteH = ROW_H - 14;

        for (let lane = 0; lane < LANES; lane++) {
            const g = this._laneGfx[lane];
            g.clear();
            g.fillColor = withAlpha(LANE_COLORS[lane], 215);

            const cx = left + COL_W * (lane + 0.5);
            for (let row = this._scrollRow; row < this._scrollRow + VISIBLE_ROWS + 1 && row < ROWS; row++) {
                if (!this._cells[row][lane]) {
                    continue;
                }
                const y = this._rowCenterY(row);
                if (y > GRID_TOP || y < GRID_BOTTOM) {
                    continue;
                }
                g.roundRect(cx - noteW / 2, y - noteH / 2, noteW, noteH, 7);
            }
            g.fill();
        }
    }

    private _redrawButtons(): void {
        this._btnRoot.destroyAllChildren();
        this._buttonNodes.clear();

        this._makeLabel('BPM', 12, withAlpha(COLOR_TEXT, 130), -286, 444, 0.5, FONT_SANS, false, this._btnRoot);
        for (let i = 0; i < BPM_OPTIONS.length; i++) {
            const active = BPM_OPTIONS[i] === this._bpm;
            const node = this._makeButton(
                String(BPM_OPTIONS[i]), -120 + i * 120, 444, 96, 42, active, this._btnRoot,
            );
            this._buttonNodes.set('bpm-' + i, node);
        }

        this._makeLabel('难度', 12, withAlpha(COLOR_TEXT, 130), -286, 392, 0.5, FONT_SANS, false, this._btnRoot);
        for (let i = 0; i < DIFF_OPTIONS.length; i++) {
            const active = DIFF_OPTIONS[i] === this._difficulty;
            const node = this._makeButton(
                DIFF_OPTIONS[i], -150 + i * 150, 392, 110, 42, active, this._btnRoot,
            );
            this._buttonNodes.set('diff-' + i, node);
        }

        this._buttonNodes.set('save', this._makeButton('保 存', -100, -356, 150, 58, false, this._btnRoot));
        this._buttonNodes.set('play', this._makeButton('试 听', 100, -356, 150, 58, true, this._btnRoot));
    }

    /** 命中结果 -> 实际节点（供统一按压反馈使用） */
    public nodeOf(hit: EditorHit): Node | null {
        if (hit.type === 'save') {
            return this._buttonNodes.get('save') || null;
        }
        if (hit.type === 'play') {
            return this._buttonNodes.get('play') || null;
        }
        if (hit.type === 'bpm') {
            const index = BPM_OPTIONS.indexOf(hit.value);
            return index >= 0 ? this._buttonNodes.get('bpm-' + index) || null : null;
        }
        if (hit.type === 'difficulty') {
            const index = DIFF_OPTIONS.indexOf(hit.value);
            return index >= 0 ? this._buttonNodes.get('diff-' + index) || null : null;
        }
        return null;
    }

    /** 触摸被系统取消：清掉拖动状态，避免下次点击被当成拖动 */
    public cancelTouch(): void {
        this._dragging = false;
    }

    private _makeButton(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        active: boolean,
        parent: Node,
    ): Node {
        const node = new Node('Btn');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(w, h);
        node.setPosition(x, y, 0);
        parent.addChild(node);

        const g = node.addComponent(Graphics);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fillColor = active ? new Color(255, 255, 255, 30) : new Color(255, 255, 255, 8);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, active ? 150 : 50);
        g.stroke();

        // 文字挂在按钮节点下，缩放反馈时文字与胶囊一起变化
        this._makeLabel(
            text, 15, withAlpha(COLOR_TEXT, active ? 245 : 165),
            0, 0, 0.5, FONT_SANS, active, node, w - 16,
        );
        return node;
    }

    // ------------------------------------------------------------------
    // 坐标换算
    // ------------------------------------------------------------------

    private _rowCenterY(row: number): number {
        return GRID_TOP - (row - this._scrollRow) * ROW_H - ROW_H / 2;
    }

    private _rowAt(y: number): number {
        return this._scrollRow + Math.floor((GRID_TOP - y) / ROW_H);
    }

    private _laneAt(x: number): number {
        return Math.floor((x + GRID_W / 2) / COL_W);
    }

    private _inside(x: number, y: number, cx: number, cy: number, w: number, h: number): boolean {
        return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
    }

    private _makeLabel(
        text: string,
        fontSize: number,
        color: Color,
        x: number,
        y: number,
        anchorX: number,
        fontFamily: string,
        bold = false,
        parent?: Node,
        width = 420,
    ): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(anchorX, 0.5);
        const lineHeight = Math.round(fontSize * 1.5);
        // 显式尺寸 + CLAMP：contentSize 为 0 时部分机型不绘制文字
        transform.setContentSize(width, lineHeight);
        node.setPosition(x, y, 0);
        (parent || this._root).addChild(node);

        const label = node.addComponent(Label);
        label.useSystemFont = true;
        label.fontFamily = fontFamily;
        label.fontSize = fontSize;
        label.lineHeight = lineHeight;
        label.color = color;
        label.isBold = bold;
        label.overflow = Label.Overflow.CLAMP;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        if (anchorX < 0.5) {
            label.horizontalAlign = Label.HorizontalAlign.LEFT;
        } else if (anchorX > 0.5) {
            label.horizontalAlign = Label.HorizontalAlign.RIGHT;
        } else {
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
        }
        label.string = text;
        return label;
    }
}
