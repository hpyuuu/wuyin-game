import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, FONT_SANS, FONT_SERIF, LANE_COLORS, LANE_NAMES, LANE_NUMBERS, spaced, withAlpha,
} from './Theme';

/**
 * PromoPage —— 宣传内容页
 *
 * 内容提炼自参考视频《五音》：
 *   1. 宫商角徵羽 = 简谱 1 2 3 5 6
 *   2. 三分损益：一根弦长 81，按 2/3 与 4/3 折算得 54 / 72 / 48 / 64
 *   3. 宫与徵弦长比 3 : 2，两次与三次振动重合，所以听着和谐
 *   4. 七声中的「变徵」「变宫」与相邻音只差半音，同响刺耳，故只留五声
 *   5. 吉他的第一个音阶、《友谊地久天长》都只用这几个音
 * 并落到本作的两种玩法上。
 */
export class PromoPage {
    public readonly root: Node;

    constructor(parent: Node, layout: LayoutInfo) {
        this.root = new Node('PromoPage');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);
        this.root.active = false;

        const width = layout.width;
        const height = layout.height;
        const top = height / 2 - Math.min(layout.topInset, 30);
        const left = -width / 2 + 54;

        // ---------- 标题 ----------
        this._label('五 音', 54, COLOR_TEXT, left, top - 92, 0, FONT_SERIF, true);
        this._label(spaced('PENTATONIC SCALE'), 10, withAlpha(COLOR_TEXT, 110), left, top - 140, 0, FONT_SANS);

        // ---------- 五音色块 ----------
        const blockY = top - 300;
        const blockW = 88;
        const blockH = 150;
        const gap = (width - 108 - blockW) / (LANE_NAMES.length - 1);
        for (let i = 0; i < LANE_NAMES.length; i++) {
            const x = left + blockW / 2 + i * gap;
            const node = new Node(`Tone_${i}`);
            node.layer = Layers.Enum.UI_2D;
            node.addComponent(UITransform);
            node.setPosition(x, blockY, 0);
            this.root.addChild(node);

            const g = node.addComponent(Graphics);
            g.roundRect(-blockW / 2, -blockH / 2, blockW, blockH, blockW / 2);
            g.fillColor = withAlpha(LANE_COLORS[i], 26);
            g.fill();
            g.lineWidth = 12;
            g.strokeColor = withAlpha(LANE_COLORS[i], 16);
            g.stroke();
            g.lineWidth = 1.6;
            g.strokeColor = withAlpha(LANE_COLORS[i], 200);
            g.stroke();

            this._label(LANE_NAMES[i], 26, LANE_COLORS[i], x, blockY - blockH / 2 - 34, 0.5, FONT_SERIF, true);
            this._label(LANE_NUMBERS[i], 13, withAlpha(LANE_COLORS[i], 140), x, blockY - blockH / 2 - 62, 0.5, FONT_SANS);
        }

        // ---------- 文案（取自参考视频《五音》） ----------
        // 每段 = 标题 + 正文（用 \n 手动换行）。段间距按屏幕高度自适应，
        // 保证较矮的设备上也不会压到底部的“轻触返回”。
        const blocks: Array<{ title: string; body: string }> = [
            {
                title: '一根弦，推出五个音',
                body: '取一根弦定作“宫”，弦长 81；\n'
                    + '依次乘 2/3、4/3，得徵 54、商 72、羽 48、角 64。',
            },
            {
                title: '3 : 2，和谐的由来',
                body: '宫与徵的弦长比正好是 3 : 2，\n'
                    + '每两次与三次振动重合一次，波形最规整。',
            },
            {
                title: '为什么只留下五个',
                body: '七声里还有“变徵”“变宫”，与相邻音只差半音，\n'
                    + '同时奏响便刺耳；取剩下的五个，任意组合都顺耳。',
            },
            {
                title: '它一直就在身边',
                body: '吉他手学的第一个音阶就是它；\n'
                    + '《友谊地久天长》只用到了其中两个音。',
            },
        ];

        const TITLE_H = 28;
        // 矮屏上收紧行距，避免最后一行压到底部提示
        const BODY_LINE = height < 1300 ? 22 : 24;
        const linesOf = (text: string): number => text.split('\n').length;

        let needed = 0;
        for (const b of blocks) {
            needed += TITLE_H + linesOf(b.body) * BODY_LINE;
        }
        // 分隔线 + 玩法段 + 底部呼吸空间
        needed += 40 + 106 + 60;

        const startY = top - 520;
        const bottomY = -height / 2 + 120;
        const blockGap = Math.max(14, Math.min(46, (startY - bottomY - needed) / blocks.length));

        let y = startY;
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            this._label(b.title, 17, COLOR_TEXT, left, y, 0, FONT_SERIF, true);
            y -= 34;
            this._label(b.body, 13, withAlpha(COLOR_TEXT, 150), left, y, 0, FONT_SERIF);
            y -= linesOf(b.body) * BODY_LINE + (i === blocks.length - 1 ? 0 : blockGap);
        }

        // ---------- 分隔线 ----------
        y -= 14;
        const line = new Node('Divider');
        line.layer = Layers.Enum.UI_2D;
        line.addComponent(UITransform);
        this.root.addChild(line);
        const dg = line.addComponent(Graphics);
        dg.lineWidth = 1;
        dg.strokeColor = withAlpha(COLOR_TEXT, 26);
        dg.moveTo(left, y);
        dg.lineTo(width / 2 - 54, y);
        dg.stroke();

        // ---------- 玩法 ----------
        y -= 44;
        this._label('在游戏里，听见这五个音', 17, COLOR_TEXT, left, y, 0, FONT_SERIF, true);
        y -= 40;
        this._label('节奏模式', 15, withAlpha(LANE_COLORS[0], 230), left, y, 0, FONT_SERIF);
        this._label('五条轨道下落击打，判定线前见分晓', 13, withAlpha(COLOR_TEXT, 130), left + 78, y - 1, 0, FONT_SERIF);
        y -= 36;
        this._label('自由弹奏', 15, withAlpha(LANE_COLORS[3], 230), left, y, 0, FONT_SERIF);
        this._label('五根琴弦随手拨动，怎么组合都好听', 13, withAlpha(COLOR_TEXT, 130), left + 78, y - 1, 0, FONT_SERIF);

        // ---------- 底部 ----------
        this._label('三 分 损 益  ·  一 弦 五 音', 14, withAlpha(COLOR_TEXT, 90), 0, -height / 2 + 96, 0.5, FONT_SERIF);
        this._label('轻 触 返 回', 12, withAlpha(COLOR_TEXT, 55), 0, -height / 2 + 62, 0.5, FONT_SANS);
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

    private _label(
        text: string,
        fontSize: number,
        color: Color,
        x: number,
        y: number,
        anchorX: number,
        fontFamily: string,
        bold = false,
    ): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(anchorX, 0.5);
        node.setPosition(x, y, 0);
        this.root.addChild(node);

        const label = node.addComponent(Label);
        label.string = text;
        label.useSystemFont = true;
        label.fontFamily = fontFamily;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.7);
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
