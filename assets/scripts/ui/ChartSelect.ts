import { Color, EventTouch, Graphics, Label, Layers, Node, UITransform } from 'cc';
import { ChartDifficulty, ChartMeta } from '../core/ChartTypes';
import { listAllMetas } from '../core/ChartStore';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, FONT_SANS, FONT_SERIF, withAlpha,
} from './Theme';

/** 难度筛选值：ALL 表示不筛选 */
export type DifficultyFilter = 'ALL' | ChartDifficulty;

/** 选谱页的点击结果 */
export type SelectAction =
    | { type: 'start'; meta: ChartMeta }
    | { type: 'delete'; meta: ChartMeta }
    | { type: 'create' }
    | { type: 'import' }
    | { type: 'page'; page: number }
    | { type: 'filter'; value: DifficultyFilter };

/** 点击结果 + 命中的节点：节点用于统一的按压反馈 */
export interface SelectHit {
    action: SelectAction;
    node: Node;
}

const DIFF_COLORS: Record<string, Color> = {
    EASY: new Color(122, 216, 196, 255),
    NORMAL: new Color(226, 190, 128, 255),
    HARD: new Color(224, 110, 92, 255),
};

const ROW_W = 600;
const ROW_H = 92;
const ROW_GAP = 12;
const FIRST_Y = 250;
const MAX_ROWS = 6;

/** 底部按钮的纵向位置 */
const CREATE_Y = -430;
const IMPORT_Y = -512;
/** 分页按钮的纵向位置（夹在列表与底部按钮之间） */
const PAGER_Y = -352;

/** 难度筛选栏 */
const FILTER_Y = 330;
const FILTER_W = 110;
const FILTER_H = 40;
const FILTER_GAP = 8;
const FILTER_OPTIONS: Array<{ value: DifficultyFilter; text: string }> = [
    { value: 'ALL', text: '全部' },
    { value: 'EASY', text: 'EASY' },
    { value: 'NORMAL', text: 'NORMAL' },
    { value: 'HARD', text: 'HARD' },
];

/**
 * 隐藏时把整页移到屏幕外，而不是切 active。
 * 微信真机上 Label 在 active 切换后会丢失字形缓存导致整页文字空白，
 * 保持节点树始终激活、只移动位置可以避开这个问题。
 */
const HIDDEN_Y = -20000;

/**
 * ChartSelect —— 琴谱选择页
 *
 * 列表内容：3 套内置谱 + 玩家自制谱（最多显示 6 条）。
 * 点击行 = 开始游戏；点击行尾「删」= 删除玩家谱；底部可新建 / 从剪贴板导入。
 */
export class ChartSelect {
    private readonly _root: Node;
    private readonly _listRoot: Node;
    private _rows: Array<{ meta: ChartMeta; node: Node; del: Node | null }> = [];
    private _btnNodes: Array<{ node: Node; action: 'create' | 'import' }> = [];
    /** 分页：node 的 page 字段是相对页码（-1 / +1） */
    private _pagerNodes: Array<{ node: Node; page: number }> = [];
    private _page = 0;
    private _pageCount = 1;
    /** 当前难度筛选（ALL 表示不过滤） */
    private _filter: DifficultyFilter = 'ALL';
    private readonly _filterNodes: Array<{ node: Node; value: DifficultyFilter; g: Graphics; label: Label }> = [];
    private _emptyLabel: Label = null!;

    constructor(parent: Node, layout: LayoutInfo) {

        this._root = new Node('ChartSelect');
        this._root.layer = Layers.Enum.UI_2D;
        this._root.addComponent(UITransform).setContentSize(layout.width, layout.height);
        parent.addChild(this._root);

        this._makeLabel('琴 谱', 54, COLOR_TEXT, 0, 448, 0.5, FONT_SERIF, true, undefined, 420);
        this._makeLabel('S E L E C T   C H A R T', 11, withAlpha(COLOR_TEXT, 110), 0, 398, 0.5, FONT_SANS, false, undefined, 420);

        const divider = new Node('Divider');
        divider.layer = Layers.Enum.UI_2D;
        divider.addComponent(UITransform);
        this._root.addChild(divider);
        const g = divider.addComponent(Graphics);
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, 36);
        g.moveTo(-110, 372);
        g.lineTo(110, 372);
        g.stroke();

        this._listRoot = new Node('List');
        this._listRoot.layer = Layers.Enum.UI_2D;
        this._listRoot.addComponent(UITransform).setContentSize(layout.width, layout.height);
        this._root.addChild(this._listRoot);

        this._buildFilter();
        this._emptyLabel = this._makeLabel(
            '该难度暂无琴谱', 16, withAlpha(COLOR_TEXT, 120), 0, 60, 0.5, FONT_SERIF,
        );
        this._emptyLabel.node.active = false;

        this._makeButton('新建琴谱', CREATE_Y, 280, 64, 'create');
        this._makeButton('从剪贴板导入', IMPORT_Y, 280, 54, 'import');
        this._buildPager();

        this._root.setPosition(0, HIDDEN_Y, 0);
    }

    public show(): void {
        this._root.setPosition(0, 0, 0);
        this.refresh();
    }

    public hide(): void {
        this._root.setPosition(0, HIDDEN_Y, 0);
    }

    /** 谱面增删后重建列表 */
    public refresh(): void {
        this._listRoot.destroyAllChildren();
        this._rows = [];

        const all = listAllMetas();
        const metas = this._filter === 'ALL'
            ? all
            : all.filter((m) => m.difficulty === this._filter);
        this._pageCount = Math.max(1, Math.ceil(metas.length / MAX_ROWS));
        if (this._page < 0) {
            this._page = 0;
        }
        if (this._page > this._pageCount - 1) {
            this._page = this._pageCount - 1;
        }

        const start = this._page * MAX_ROWS;
        const pageMetas = metas.slice(start, start + MAX_ROWS);
        for (let i = 0; i < pageMetas.length; i++) {
            const y = FIRST_Y - i * (ROW_H + ROW_GAP);
            const built = this._buildRow(pageMetas[i], y);
            this._rows.push({ meta: pageMetas[i], node: built.node, del: built.del });
        }
        this._emptyLabel.node.active = pageMetas.length === 0;
        this._updatePager();
    }

    /** 当前难度筛选值 */
    public get filter(): DifficultyFilter {
        return this._filter;
    }

    /** 切换难度筛选：重置到第一页后重建列表 */
    public setFilter(value: DifficultyFilter): void {
        if (this._filter === value) {
            return;
        }
        this._filter = value;
        this._page = 0;
        this._redrawFilter();
        this.refresh();
    }

    /** 当前筛选结果条数（供测试与调试） */
    public get filteredCount(): number {
        const all = listAllMetas();
        return this._filter === 'ALL'
            ? all.length
            : all.filter((m) => m.difficulty === this._filter).length;
    }

    /** 总页数（不足一页时为 1） */
    public get pageCount(): number {
        return this._pageCount;
    }

    /** 当前页码（从 0 开始） */
    public get pageIndex(): number {
        return this._page;
    }

    /** 翻页：越界自动钳制，走 refresh 重建当前页 */
    public setPage(page: number): void {
        const next = Math.max(0, Math.min(this._pageCount - 1, Math.floor(page)));
        if (next === this._page) {
            return;
        }
        this._page = next;
        this.refresh();
    }

    /**
     * 命中测试：全部走 UITransform.hitTest（屏幕坐标反查），
     * 与渲染共用同一套变换，避免真机上热区整体偏移。
     */
    public hitTest(event: EventTouch): SelectHit | null {
        // 难度筛选栏（位于列表上方，不与行重叠）
        for (const item of this._filterNodes) {
            const transform = item.node.getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return { action: { type: 'filter', value: item.value }, node: item.node };
            }
        }
        // 分页按钮优先（位于列表下方，不与行重叠）
        for (const pager of this._pagerNodes) {
            if (!pager.node.active) {
                continue;
            }
            const transform = pager.node.getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return { action: { type: 'page', page: this._page + pager.page }, node: pager.node };
            }
        }
        // 行尾「删」优先，避免被整行热区吞掉
        for (const row of this._rows) {
            if (!row.del) {
                continue;
            }
            const transform = row.del.getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return { action: { type: 'delete', meta: row.meta }, node: row.del };
            }
        }
        for (const row of this._rows) {
            const transform = row.node.getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return { action: { type: 'start', meta: row.meta }, node: row.node };
            }
        }
        for (const btn of this._btnNodes) {
            const transform = btn.node.getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return { action: { type: btn.action }, node: btn.node };
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 构建
    // ------------------------------------------------------------------

    private _buildRow(meta: ChartMeta, y: number): { node: Node; del: Node | null } {
        const node = new Node(`Row_${meta.id}`);
        node.layer = Layers.Enum.UI_2D;
        // 热区尺寸 = 绘制尺寸
        node.addComponent(UITransform).setContentSize(ROW_W, ROW_H);
        node.setPosition(0, y, 0);
        this._listRoot.addChild(node);

        const g = node.addComponent(Graphics);
        g.roundRect(-ROW_W / 2, -ROW_H / 2, ROW_W, ROW_H, 14);
        g.fillColor = new Color(255, 255, 255, 9);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, 32);
        g.stroke();

        // 左侧难度色条
        const dc = DIFF_COLORS[meta.difficulty] || COLOR_TEXT;
        g.roundRect(-ROW_W / 2 + 14, -ROW_H / 2 + 18, 4, ROW_H - 36, 2);
        g.fillColor = dc;
        g.fill();

        // 文字挂在行节点下：行被按下缩放时，背景与文字作为一个整体一起动
        this._makeLabel(meta.name, 22, COLOR_TEXT, -ROW_W / 2 + 34, 14, 0, FONT_SERIF, true, node, 380);
        const tag = meta.builtin ? '内置' : '自制';
        this._makeLabel(
            `${meta.difficulty}  ·  ${meta.bpm} BPM  ·  ${meta.noteCount} 音  ·  ${tag}`,
            12,
            withAlpha(dc, 210),
            -ROW_W / 2 + 34,
            -18,
            0,
            FONT_SANS,
            false,
            node,
            460,
        );

        let del: Node | null = null;
        if (!meta.builtin) {
            const delLabel = this._makeLabel(
                '删', 16, withAlpha(new Color(224, 110, 92, 255), 235),
                ROW_W / 2 - 36, 0, 0.5, FONT_SERIF, false, node, 40,
            );
            del = delLabel.node;
            // 删除按钮单独成热区，略放宽到整行高度
            const delTransform = del.getComponent(UITransform);
            if (delTransform) {
                delTransform.setContentSize(76, ROW_H);
            }
        }

        return { node, del };
    }

    private _makeButton(text: string, y: number, w: number, h: number, action: 'create' | 'import'): void {
        const node = new Node('Btn');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(w, h);
        node.setPosition(0, y, 0);
        this._root.addChild(node);
        this._btnNodes.push({ node, action });

        const g = node.addComponent(Graphics);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fillColor = new Color(255, 255, 255, 12);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, 70);
        g.stroke();

        // 文字挂在按钮节点下，缩放反馈时文字与胶囊一起变化
        this._makeLabel(text, 19, withAlpha(COLOR_TEXT, 225), 0, 0, 0.5, FONT_SERIF, false, node, w - 24);
    }

    /** 分页按钮：仅在总页数大于 1 时显示 */
    private _buildPager(): void {
        const specs = [
            { text: '‹  上页', x: -160, page: -1 },
            { text: '下页  ›', x: 160, page: 1 },
        ];
        for (const spec of specs) {
            const node = new Node('Pager');
            node.layer = Layers.Enum.UI_2D;
            node.addComponent(UITransform).setContentSize(150, 48);
            node.setPosition(spec.x, PAGER_Y, 0);
            node.active = false;
            this._root.addChild(node);

            const g = node.addComponent(Graphics);
            g.roundRect(-75, -24, 150, 48, 24);
            g.fillColor = new Color(255, 255, 255, 8);
            g.fill();
            g.lineWidth = 1;
            g.strokeColor = withAlpha(COLOR_TEXT, 46);
            g.stroke();

            // 文字必须挂在按钮节点下：否则隐藏按钮时背景消失、文字仍留在屏幕上
            this._makeLabel(spec.text, 14, withAlpha(COLOR_TEXT, 190), 0, 0, 0.5, FONT_SANS, false, node, 140);
            this._pagerNodes.push({ node, page: spec.page });
        }
    }

    /** 难度筛选栏：全部 / EASY / NORMAL / HARD，样式与分页按钮一致 */
    private _buildFilter(): void {
        const total = FILTER_OPTIONS.length * FILTER_W + (FILTER_OPTIONS.length - 1) * FILTER_GAP;
        let x = -total / 2 + FILTER_W / 2;
        for (const option of FILTER_OPTIONS) {
            const node = new Node('Filter');
            node.layer = Layers.Enum.UI_2D;
            node.addComponent(UITransform).setContentSize(FILTER_W, FILTER_H);
            node.setPosition(x, FILTER_Y, 0);
            this._root.addChild(node);

            const g = node.addComponent(Graphics);
            const label = this._makeLabel(
                option.text, 14, COLOR_TEXT, 0, 0, 0.5, FONT_SANS, false, node, FILTER_W - 12,
            );
            this._filterNodes.push({ node, value: option.value, g, label });
            x += FILTER_W + FILTER_GAP;
        }
        this._redrawFilter();
    }

    /** 重绘筛选按钮的选中态（只换颜色，不重建节点） */
    private _redrawFilter(): void {
        for (const item of this._filterNodes) {
            const active = item.value === this._filter;
            const g = item.g;
            g.clear();
            g.roundRect(-FILTER_W / 2, -FILTER_H / 2, FILTER_W, FILTER_H, FILTER_H / 2);
            g.fillColor = active ? new Color(255, 255, 255, 26) : new Color(255, 255, 255, 6);
            g.fill();
            g.lineWidth = 1;
            g.strokeColor = withAlpha(COLOR_TEXT, active ? 140 : 42);
            g.stroke();
            item.label.color = withAlpha(COLOR_TEXT, active ? 240 : 150);
        }
    }

    private _updatePager(): void {
        const multi = this._pageCount > 1;
        for (const pager of this._pagerNodes) {
            pager.node.active = multi;
        }
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
        // 显式给 Label 一个尺寸，配合 CLAMP 排版；contentSize 为 0 时部分机型不绘制文字
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
        // string 放在最后设置，确保排版参数已生效
        label.string = text;
        return label;
    }
}
