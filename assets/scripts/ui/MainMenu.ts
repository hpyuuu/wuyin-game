import { Color, EventTouch, Graphics, Label, Layers, Node, UITransform } from 'cc';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, FONT_SANS, FONT_SERIF, LANE_COLORS, LANE_NAMES, spaced, withAlpha,
} from './Theme';

export type MenuAction = 'rhythm' | 'free' | 'promo';

interface CardSpec {
    action: MenuAction;
    x: number;
    y: number;
    w: number;
    h: number;
    angle: number;
    accent: Color;
    index: string;
    title: string;
    subtitle: string;
    desc: string;
}

/**
 * MainMenu —— 主界面（参考草图布局）
 *
 *   ┌──────────────────────┐
 *   │      节奏模式（大）    │
 *   ├──────────┬───────────┤
 *   │ 自由弹奏  │  宣传内容  │
 *   └──────────┴───────────┘
 *
 * 卡片带轻微倾斜，文字反向旋转保持水平，点击时做缩放反馈。
 */
export class MainMenu {
    public readonly root: Node;

    private readonly _cards: CardSpec[] = [];
    private readonly _cardNodes: Node[] = [];

    constructor(parent: Node, layout: LayoutInfo) {
        this.root = new Node('MainMenu');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);

        const width = layout.width;
        const height = layout.height;
        const top = height / 2 - Math.min(layout.topInset, 30);

        // 垂直节奏：标题 10% / 大卡片 32% / 小卡片 60%（整体重心偏上）
        this._label('五 音', 76, COLOR_TEXT, 0, top - height * 0.08, 0.5, FONT_SERIF, true);
        this._label(spaced('PENTATONIC'), 11, withAlpha(COLOR_TEXT, 110), 0, top - height * 0.135, 0.5, FONT_SANS);

        const divider = new Node('Divider');
        divider.layer = Layers.Enum.UI_2D;
        divider.addComponent(UITransform);
        this.root.addChild(divider);
        const dg = divider.addComponent(Graphics);
        dg.lineWidth = 1;
        dg.strokeColor = withAlpha(COLOR_TEXT, 34);
        dg.moveTo(-70, top - height * 0.165);
        dg.lineTo(70, top - height * 0.165);
        dg.stroke();

        // ---------- 卡片 ----------
        const bigW = Math.min(width - 80, 620);
        const bigH = 300;
        const smallW = (width - 80 - 22) / 2;
        const smallH = 200;
        const bigY = top - height * 0.32;
        const smallY = top - height * 0.60;

        this._buildCard({
            action: 'rhythm',
            x: 0, y: bigY, w: bigW, h: bigH,
            angle: -1.2,
            accent: LANE_COLORS[0],
            index: '01',
            title: '节奏模式',
            subtitle: spaced('FALLING NOTES'),
            desc: '五轨下落 · 判定线击打',
        });
        this._buildCard({
            action: 'free',
            x: -smallW / 2 - 11, y: smallY, w: smallW, h: smallH,
            angle: 1.5,
            accent: LANE_COLORS[3],
            index: '02',
            title: '自由弹奏',
            subtitle: spaced('FREE PLAY'),
            desc: '',
        });
        this._buildCard({
            action: 'promo',
            x: smallW / 2 + 11, y: smallY, w: smallW, h: smallH,
            angle: -1.0,
            accent: LANE_COLORS[4],
            index: '03',
            title: '宣传内容',
            subtitle: spaced('ABOUT'),
            desc: '',
        });

        // ---------- 底部五音 ----------
        const baseY = -height / 2 + 116;
        for (let i = 0; i < LANE_NAMES.length; i++) {
            const step = 62;
            const x = (i - (LANE_NAMES.length - 1) / 2) * step;
            this._label(LANE_NAMES[i], 15, withAlpha(LANE_COLORS[i], 190), x, baseY, 0.5, FONT_SERIF);
        }
        this._label('宫 商 角 徵 羽  ·  五声音阶', 11, withAlpha(COLOR_TEXT, 70), 0, baseY - 30, 0.5, FONT_SANS);
    }

    public show(): void {
        this.root.active = true;
    }

    public hide(): void {
        this.root.active = false;
    }

    public get visible(): boolean {
        return this.root.active;
    }

    /**
     * 命中测试。
     *
     * 用引擎的 UITransform.hitTest 按屏幕坐标反查，与渲染共用同一套相机与变换矩阵，
     * 避免自行换算全局坐标在真机上出现「热区整体下移」。
     */
    public hitTest(event: EventTouch): MenuAction | null {
        for (let i = 0; i < this._cardNodes.length; i++) {
            const transform = this._cardNodes[i].getComponent(UITransform);
            if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
                return this._cards[i].action;
            }
        }
        return null;
    }

    /** 按下反馈：返回命中的卡片节点，由 GameEntry 统一驱动缩放 */
    public nodeOf(action: MenuAction): Node | null {
        const index = this._cards.findIndex((c) => c.action === action);
        return index >= 0 ? this._cardNodes[index] : null;
    }

    // ------------------------------------------------------------------
    // 构建
    // ------------------------------------------------------------------

    private _buildCard(spec: CardSpec): void {
        const card = new Node(`Card_${spec.action}`);
        card.layer = Layers.Enum.UI_2D;
        // 尺寸必须与绘制区域一致，hitTest 直接以它为热区
        const cardTransform = card.addComponent(UITransform);
        cardTransform.setContentSize(spec.w, spec.h);
        card.setPosition(spec.x, spec.y, 0);
        card.setRotationFromEuler(0, 0, spec.angle);
        this.root.addChild(card);

        const g = card.addComponent(Graphics);
        const w = spec.w;
        const h = spec.h;
        g.roundRect(-w / 2, -h / 2, w, h, 16);
        g.fillColor = new Color(10, 12, 16, 232);
        g.fill();
        // 外发光 + 细边框
        g.lineWidth = 16;
        g.strokeColor = withAlpha(spec.accent, 10);
        g.stroke();
        g.lineWidth = 1.4;
        g.strokeColor = withAlpha(spec.accent, 110);
        g.stroke();

        // 文字需要反向旋转，抵消卡片倾斜
        const counter = -spec.angle;

        const indexLabel = this._label(spec.index, 12, withAlpha(spec.accent, 190), -w / 2 + 26, h / 2 - 36, 0, FONT_SANS, false, card);
        indexLabel.node.setRotationFromEuler(0, 0, counter);

        const titleSize = spec.action === 'rhythm' ? 36 : 26;
        const titleY = spec.action === 'rhythm' ? h / 2 - 120 : h / 2 - 96;
        const title = this._label(spec.title, titleSize, COLOR_TEXT, -w / 2 + 26, titleY, 0, FONT_SERIF, true, card);
        title.node.setRotationFromEuler(0, 0, counter);

        const sub = this._label(
            spec.subtitle, 10, withAlpha(spec.accent, 150),
            -w / 2 + 26, spec.action === 'rhythm' ? h / 2 - 158 : h / 2 - 130,
            0, FONT_SANS, false, card,
        );
        sub.node.setRotationFromEuler(0, 0, counter);

        if (spec.desc) {
            const desc = this._label(spec.desc, 14, withAlpha(COLOR_TEXT, 95), -w / 2 + 26, -h / 2 + 46, 0, FONT_SERIF, false, card);
            desc.node.setRotationFromEuler(0, 0, counter);
        }

        // 右下角箭头
        const arrow = this._label('→', 22, withAlpha(spec.accent, 200), w / 2 - 32, -h / 2 + 34, 0.5, FONT_SANS, false, card);
        arrow.node.setRotationFromEuler(0, 0, counter);

        this._cards.push(spec);
        this._cardNodes.push(card);
    }

    private _label(
        text: string,
        fontSize: number,
        color: Color,
        x: number,
        y: number,
        anchorX: number,
        fontFamily: string,
        bold = false,
        parent?: Node,
    ): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(anchorX, 0.5);
        node.setPosition(x, y, 0);
        (parent || this.root).addChild(node);

        const label = node.addComponent(Label);
        label.string = text;
        label.useSystemFont = true;
        label.fontFamily = fontFamily;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = color;
        label.isBold = bold;
        label.overflow = Label.Overflow.NONE;
        label.cacheMode = Label.CacheMode.CHAR;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        if (anchorX < 0.5) {
            label.horizontalAlign = Label.HorizontalAlign.LEFT;
        } else if (anchorX > 0.5) {
            label.horizontalAlign = Label.HorizontalAlign.RIGHT;
        } else {
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
        }
        return label;
    }
}
