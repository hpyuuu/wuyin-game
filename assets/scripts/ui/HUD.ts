import {
    Color, Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { GameStats } from '../core/GameMain';
import { JudgeResult } from '../core/ChartTypes';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, COLOR_TEXT_DIM, FONT_SANS, FONT_SERIF, GRADE_COLORS, LANE_COLORS,
    LANE_NAMES, LANE_NUMBERS, spaced, withAlpha,
} from './Theme';

const OVERLAY_BG = new Color(4, 5, 7, 232);
/** 隐藏时把整页移出可视区（不切换 active，规避微信 Label 字形缓存丢失） */
const HUD_HIDDEN_Y = -20000;

function pad(num: number, len: number): string {
    let s = String(Math.floor(num));
    while (s.length < len) {
        s = '0' + s;
    }
    return s;
}

/**
 * HUD —— 顶部数据、判定反馈、开始/结算遮罩
 *
 * 视觉参考视频：英文小字 + 衬线大数字 + 大量留白。
 */
export class HUD {
    private readonly _layout: LayoutInfo;
    private readonly _root: Node;

    private readonly _scoreLabel: Label;
    private readonly _comboLabel: Label;
    private readonly _accLabel: Label;
    private readonly _offsetStatLabel: Label;
    private readonly _judgeNode: Node;
    private readonly _judgeLabel: Label;
    private readonly _judgeOpacity: UIOpacity;
    private readonly _offsetLabel: Label;
    /** 顶部曲名，随当前谱面切换 */
    private readonly _titleLabel: Label;

    private readonly _overlay: Node;
    private readonly _readyGroup: Node;
    private readonly _resultGroup: Node;
    private _resultScore: Label = null!;
    private _resultDetail: Label = null!;

    /** 最近的击打偏差（毫秒），用于真机手感校准 */
    private readonly _offsetHistory: number[] = [];

    constructor(parent: Node, layout: LayoutInfo) {
        this._layout = layout;

        this._root = new Node('Hud');
        this._root.layer = Layers.Enum.UI_2D;
        this._root.addComponent(UITransform);
        parent.addChild(this._root);

        const halfW = layout.width / 2;
        // 让开微信胶囊按钮占用的顶部空间
        const topY = layout.height / 2 - layout.topInset;

        // ---------- 左上：分数 ----------
        this._makeLabel(spaced('SCORE'), 14, COLOR_TEXT_DIM, -halfW + 42, topY - 82, 0, FONT_SANS);
        this._scoreLabel = this._makeLabel('00000', 46, COLOR_TEXT, -halfW + 42, topY - 124, 0, FONT_SERIF, true);

        // ---------- 右上：连击 / 准确率 ----------
        this._makeLabel(spaced('COMBO'), 14, COLOR_TEXT_DIM, halfW - 42, topY - 82, 1, FONT_SANS);
        this._comboLabel = this._makeLabel('0', 46, COLOR_TEXT, halfW - 42, topY - 124, 1, FONT_SERIF, true);
        this._accLabel = this._makeLabel('ACC 100.0%', 14, COLOR_TEXT_DIM, halfW - 42, topY - 172, 1, FONT_SANS);
        // 常驻偏差面板：LAST=最近一次，AVG=最近 20 次均值（校准 globalOffsetMs 用）
        this._offsetStatLabel = this._makeLabel('', 12, withAlpha(COLOR_TEXT, 120), halfW - 42, topY - 196, 1, FONT_SANS);

        // ---------- 顶部中间：曲名 ----------
        this._titleLabel = this._makeLabel('五 音 · 五 轨', 18, COLOR_TEXT_DIM, 0, topY - 86, 0.5, FONT_SERIF);
        this._makeLabel(spaced('FALLING'), 10, withAlpha(COLOR_TEXT_DIM, 70), 0, topY - 112, 0.5, FONT_SANS);

        // ---------- 轨道编号（宫商角徵羽 + 简谱） ----------
        for (let i = 0; i < layout.laneX.length; i++) {
            this._makeLabel(
                LANE_NAMES[i], 14, withAlpha(LANE_COLORS[i], 200),
                layout.laneX[i], layout.judgeY - 62, 0.5, FONT_SERIF,
            );
            this._makeLabel(
                LANE_NUMBERS[i], 11, withAlpha(LANE_COLORS[i], 110),
                layout.laneX[i], layout.judgeY - 82, 0.5, FONT_SANS,
            );
        }

        // ---------- 判定文字 ----------
        this._judgeNode = new Node('JudgeText');
        this._judgeNode.layer = Layers.Enum.UI_2D;
        this._judgeNode.addComponent(UITransform);
        this._judgeNode.setPosition(0, layout.judgeY + 140, 0);
        this._root.addChild(this._judgeNode);

        this._judgeOpacity = this._judgeNode.addComponent(UIOpacity);
        this._judgeOpacity.opacity = 0;

        this._judgeLabel = this._makeLabel('', 46, GRADE_COLORS.PERFECT, 0, 0, 0.5, FONT_SERIF, true, this._judgeNode);
        this._offsetLabel = this._makeLabel('', 15, COLOR_TEXT_DIM, 0, -34, 0.5, FONT_SANS, false, this._judgeNode);

        // ---------- 遮罩层 ----------
        this._overlay = new Node('Overlay');
        this._overlay.layer = Layers.Enum.UI_2D;
        this._overlay.addComponent(UITransform);
        this._root.addChild(this._overlay);

        const mask = this._overlay.addComponent(Graphics);
        mask.fillColor = OVERLAY_BG;
        mask.rect(-halfW, -layout.height / 2, layout.width, layout.height);
        mask.fill();

        this._readyGroup = this._buildReadyGroup();
        this._resultGroup = this._buildResultGroup();

        // 初始状态：展示开始界面
        this.showReady();
    }

    // ------------------------------------------------------------------
    // 对外接口
    // ------------------------------------------------------------------

    public updateStats(stats: GameStats): void {
        this._scoreLabel.string = pad(stats.score, 5);
        this._accLabel.string = `ACC ${(stats.accuracy * 100).toFixed(1)}%`;

        const comboText = String(stats.combo);
        if (this._comboLabel.string !== comboText) {
            this._comboLabel.string = comboText;
            if (stats.combo > 0) {
                const node = this._comboLabel.node;
                Tween.stopAllByTarget(node);
                node.setScale(1.22, 1.22, 1);
                tween(node).to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
            }
        }
    }

    public showJudge(result: JudgeResult): void {
        const color = GRADE_COLORS[result.grade] || COLOR_TEXT;
        this._judgeLabel.string = result.grade;
        this._judgeLabel.color = color;

        if (result.grade === 'MISS') {
            this._offsetLabel.string = '';
        } else {
            const sign = result.diffMs >= 0 ? '+' : '';
            this._offsetLabel.string = `${sign}${result.diffMs.toFixed(0)} ms`;
            this._pushOffset(result.diffMs);
        }

        const node = this._judgeNode;
        Tween.stopAllByTarget(this._judgeOpacity);
        Tween.stopAllByTarget(node);

        this._judgeOpacity.opacity = 255;
        node.setScale(1.16, 1.16, 1);

        tween(node)
            .to(0.1, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .start();
        // 停留久一点，真机调试时方便读偏差
        tween(this._judgeOpacity)
            .delay(0.65)
            .to(0.3, { opacity: 0 })
            .start();
    }

    /** 清空偏差统计（重开一局时调用） */
    public resetOffsets(): void {
        this._offsetHistory.length = 0;
        this._offsetStatLabel.string = '';
    }

    /** 记录一次偏差并刷新右上角 LAST / AVG 面板 */
    private _pushOffset(diffMs: number): void {
        this._offsetHistory.push(diffMs);
        if (this._offsetHistory.length > 20) {
            this._offsetHistory.shift();
        }
        let sum = 0;
        for (const v of this._offsetHistory) {
            sum += v;
        }
        const avg = sum / this._offsetHistory.length;
        const s1 = diffMs >= 0 ? '+' : '';
        const s2 = avg >= 0 ? '+' : '';
        this._offsetStatLabel.string =
            `LAST ${s1}${diffMs.toFixed(0)}ms   AVG ${s2}${avg.toFixed(0)}ms`;
    }

    public showReady(): void {
        this._overlay.active = true;
        this._readyGroup.active = true;
        this._resultGroup.active = false;
    }

    public showPlaying(): void {
        this._overlay.active = false;
        // 新一局开始必须清掉上一局的判定文字，否则会残留在判定线上方
        this._resetJudge();
    }

    /** 页面路由用：整体显示 / 隐藏 HUD */
    public setVisible(visible: boolean): void {
        // 与选谱页 / 编辑器保持一致：用位移隐藏，避免微信真机上
        // 反复切换节点 active 导致 Label 字形缓存失效、整页文字变空白。
        this._root.active = true;
        this._root.setPosition(0, visible ? 0 : HUD_HIDDEN_Y, 0);
    }

    public showResult(stats: GameStats): void {
        this._overlay.active = true;
        this._readyGroup.active = false;
        this._resultGroup.active = true;
        this._resetJudge();

        this._resultScore.string = pad(stats.score, 5);
        this._resultDetail.string =
            `PERFECT ${stats.perfect}      GREAT ${stats.great}\n` +
            `GOOD ${stats.good}      MISS ${stats.miss}\n` +
            `MAX COMBO ${stats.maxCombo}      ACC ${(stats.accuracy * 100).toFixed(1)}%`;
    }

    /** 更新顶部曲名（切换谱面时调用） */
    public setTitle(name: string): void {
        this._titleLabel.string = name && name.length > 0 ? name : '五 音 · 五 轨';
    }

    /** 清空判定文字与缩放，避免跨局残留 */
    private _resetJudge(): void {
        Tween.stopAllByTarget(this._judgeOpacity);
        Tween.stopAllByTarget(this._judgeNode);
        this._judgeOpacity.opacity = 0;
        this._judgeLabel.string = '';
        this._offsetLabel.string = '';
        this._judgeNode.setScale(1, 1, 1);
    }

    // ------------------------------------------------------------------
    // 构建
    // ------------------------------------------------------------------

    private _buildReadyGroup(): Node {
        const group = new Node('ReadyGroup');
        group.layer = Layers.Enum.UI_2D;
        group.addComponent(UITransform);
        this._overlay.addChild(group);

        this._makeLabel('五 音', 88, COLOR_TEXT, 0, 150, 0.5, FONT_SERIF, true, group);
        this._makeLabel(spaced('FOUR LANES'), 12, withAlpha(COLOR_TEXT, 120), 0, 70, 0.5, FONT_SANS, false, group);

        const divider = new Node('Divider');
        divider.layer = Layers.Enum.UI_2D;
        divider.addComponent(UITransform);
        group.addChild(divider);
        const g = divider.addComponent(Graphics);
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, 40);
        g.moveTo(-90, 40);
        g.lineTo(90, 40);
        g.stroke();

        this._makeLabel('五条固定轨道 · 底部判定线', 17, COLOR_TEXT_DIM, 0, -10, 0.5, FONT_SERIF, false, group);
        this._makeLabel('点击轨道击打方块，越准分数越高', 15, withAlpha(COLOR_TEXT, 90), 0, -46, 0.5, FONT_SERIF, false, group);

        const hint = this._makeLabel('轻 触 任 意 处 开 始', 20, COLOR_TEXT, 0, -230, 0.5, FONT_SERIF, false, group);
        const hintOpacity = hint.node.addComponent(UIOpacity);
        tween(hintOpacity)
            .to(1.0, { opacity: 110 })
            .to(1.0, { opacity: 255 })
            .union()
            .repeatForever()
            .start();

        this._makeLabel('桌面调试：键盘 D  F  G  J  K', 13, withAlpha(COLOR_TEXT, 80), 0, -300, 0.5, FONT_SANS, false, group);

        this._makeLabel(
            'BGM 可选：Pixabay 免费短音频 → resources/audio',
            11,
            withAlpha(COLOR_TEXT, 55),
            0,
            -this._layout.height / 2 + 54,
            0.5,
            FONT_SANS,
            false,
            group,
        );

        return group;
    }

    private _buildResultGroup(): Node {
        const group = new Node('ResultGroup');
        group.layer = Layers.Enum.UI_2D;
        group.addComponent(UITransform);
        this._overlay.addChild(group);
        group.active = false;

        this._makeLabel('本 曲 终 了', 40, COLOR_TEXT, 0, 200, 0.5, FONT_SERIF, true, group);
        this._makeLabel(spaced('RESULT'), 11, withAlpha(COLOR_TEXT, 110), 0, 160, 0.5, FONT_SANS, false, group);

        this._resultScore = this._makeLabel('00000', 72, COLOR_TEXT, 0, 78, 0.5, FONT_SERIF, true, group);
        this._resultDetail = this._makeLabel('', 16, COLOR_TEXT_DIM, 0, -40, 0.5, FONT_SANS, false, group);

        this._makeLabel('轻 触 任 意 处 再 来 一 次', 18, COLOR_TEXT, 0, -200, 0.5, FONT_SERIF, false, group);

        return group;
    }

    /** 创建 Label 的小工具，anchorX: 0=左对齐, 1=右对齐, 0.5=居中 */
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
    ): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(anchorX, 0.5);
        node.setPosition(x, y, 0);
        (parent || this._root).addChild(node);

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
