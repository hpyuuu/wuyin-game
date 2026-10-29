import {
    Color, Graphics, Label, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { AudioManager } from '../core/AudioManager';
import { GameConfig } from '../core/GameConfig';
import { LayoutInfo } from './SceneBuilder';
import {
    COLOR_TEXT, FONT_SANS, FONT_SERIF, LANE_COLORS, LANE_NAMES, LANE_NUMBERS, spaced, withAlpha,
} from './Theme';

interface StringState {
    /** 当前振幅（像素） */
    amplitude: number;
    /** 振动相位 */
    phase: number;
    /** 拨弦位置（本地 y） */
    pluckY: number;
}

/**
 * FreePlay —— 自由弹奏模式
 *
 * 五根竖直琴弦（宫商角徵羽），点击 / 滑过即可拨弦：
 *   - 弦按正弦波弯曲并指数衰减
 *   - 拨弦点出现光点与椭圆波纹
 *   - 每根弦触发对应音高（复用 AudioManager 的程序化合成音）
 */
export class FreePlay {
    public readonly root: Node;

    private readonly _xs: number[] = [];
    private readonly _gfx: Graphics[] = [];
    private readonly _glowNodes: Node[] = [];
    private readonly _glowOpacity: UIOpacity[] = [];
    private readonly _rippleNodes: Node[] = [];
    private readonly _rippleOpacity: UIOpacity[] = [];
    private readonly _states: StringState[] = [];
    private readonly _topY: number;
    private readonly _bottomY: number;
    /** 每个触点上一次拨动的弦，用于滑动连奏 */
    private readonly _lastLane = new Map<number, number>();

    constructor(parent: Node, layout: LayoutInfo) {
        this.root = new Node('FreePlay');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);
        this.root.active = false;

        const width = layout.width;
        const height = layout.height;
        const top = height / 2 - Math.min(layout.topInset, 30);

        this._topY = layout.topY - 40;
        this._bottomY = -height / 2 + 210;

        // ---------- 标题 ----------
        this._label('自 由 弹 奏', 30, COLOR_TEXT, 0, top - 70, 0.5, FONT_SERIF, true);
        this._label(spaced('FREE PLAY'), 10, withAlpha(COLOR_TEXT, 100), 0, top - 106, 0.5, FONT_SANS);

        // ---------- 琴弦 ----------
        const gap = width * 0.155;
        for (let i = 0; i < GameConfig.laneCount; i++) {
            const x = (i - (GameConfig.laneCount - 1) / 2) * gap;
            this._xs.push(x);
            this._states.push({ amplitude: 0, phase: 0, pluckY: 0 });

            const stringNode = new Node(`String_${i}`);
            stringNode.layer = Layers.Enum.UI_2D;
            stringNode.addComponent(UITransform);
            stringNode.setPosition(x, 0, 0);
            this.root.addChild(stringNode);
            const g = stringNode.addComponent(Graphics);
            this._gfx.push(g);
            this._drawString(i);

            // 光点
            const glow = new Node(`Glow_${i}`);
            glow.layer = Layers.Enum.UI_2D;
            glow.addComponent(UITransform);
            glow.active = false;
            this.root.addChild(glow);
            const gg = glow.addComponent(Graphics);
            gg.fillColor = withAlpha(LANE_COLORS[i], 235);
            gg.circle(0, 0, 5);
            gg.fill();
            gg.lineWidth = 14;
            gg.strokeColor = withAlpha(LANE_COLORS[i], 40);
            gg.circle(0, 0, 5);
            gg.stroke();
            const glo = glow.addComponent(UIOpacity);
            glo.opacity = 0;
            this._glowNodes.push(glow);
            this._glowOpacity.push(glo);

            // 波纹（横向椭圆）
            const ripple = new Node(`Ripple_${i}`);
            ripple.layer = Layers.Enum.UI_2D;
            ripple.addComponent(UITransform);
            ripple.active = false;
            this.root.addChild(ripple);
            const rg = ripple.addComponent(Graphics);
            rg.lineWidth = 1.6;
            rg.strokeColor = withAlpha(LANE_COLORS[i], 220);
            rg.ellipse(0, 0, gap * 0.52, 13);
            rg.stroke();
            const ro = ripple.addComponent(UIOpacity);
            ro.opacity = 0;
            this._rippleNodes.push(ripple);
            this._rippleOpacity.push(ro);

            // 底部标注
            this._label(LANE_NAMES[i], 20, withAlpha(LANE_COLORS[i], 225), x, this._bottomY - 52, 0.5, FONT_SERIF);
            this._label(LANE_NUMBERS[i], 12, withAlpha(LANE_COLORS[i], 120), x, this._bottomY - 78, 0.5, FONT_SANS);
        }

        this._label('点 击 或 滑 过 琴 弦', 13, withAlpha(COLOR_TEXT, 80), 0, -height / 2 + 92, 0.5, FONT_SANS);
    }

    public show(): void {
        this.root.active = true;
        // 触摸 id 会被系统复用，上次退出时未清空会让同一根弦的首次拨动弹不出声
        this._lastLane.clear();
    }

    public hide(): void {
        this.root.active = false;
        this._lastLane.clear();
    }

    public get visible(): boolean {
        return this.root.active;
    }

    /**
     * 拨弦：按 x 找最近的弦
     * @param touchId 触点 id，用于滑动时只在换弦时重新触发
     */
    public pluckAt(localX: number, localY: number, touchId = 0): void {
        let index = 0;
        let best = Number.MAX_VALUE;
        for (let i = 0; i < this._xs.length; i++) {
            const d = Math.abs(localX - this._xs[i]);
            if (d < best) {
                best = d;
                index = i;
            }
        }

        // 滑动连奏：同一触点在同一根弦上不重复触发
        if (this._lastLane.get(touchId) === index) {
            return;
        }
        this._lastLane.set(touchId, index);

        const y = Math.max(this._bottomY, Math.min(this._topY, localY));
        const state = this._states[index];
        // 轻拨：幅度收小，靠光点与波纹承担反馈
        state.amplitude = 14;
        state.phase = 0;
        state.pluckY = y;

        AudioManager.instance.playPluck(index);
        this._drawString(index);
        this._playGlow(index, y);
        this._playRipple(index, y);
    }

    /** 抬起手指时清除该触点的连奏记录 */
    public releaseTouch(touchId: number): void {
        this._lastLane.delete(touchId);
    }

    /** 每帧衰减弦振动 */
    public update(dt: number): void {
        if (!this.root.active) {
            return;
        }
        for (let i = 0; i < this._states.length; i++) {
            const state = this._states[i];
            if (state.amplitude <= 0.3) {
                if (state.amplitude > 0) {
                    state.amplitude = 0;
                    this._drawString(i);
                }
                continue;
            }
            // 快速收敛（约 0.5 秒），避免余振拖沓
            state.amplitude *= Math.exp(-dt * 5.2);
            state.phase += dt * 24;
            this._drawString(i);
        }
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private _drawString(index: number): void {
        const g = this._gfx[index];
        const state = this._states[index];
        const x = 0;
        const top = this._topY;
        const bottom = this._bottomY;
        const color = LANE_COLORS[index];

        g.clear();
        g.lineWidth = 1.3;
        g.strokeColor = withAlpha(color, 225);

        if (state.amplitude <= 0) {
            g.moveTo(x, bottom);
            g.lineTo(x, top);
            g.stroke();
            // 弦的光晕：同路径粗描边
            g.lineWidth = 8;
            g.strokeColor = withAlpha(color, 20);
            g.stroke();
            return;
        }

        const segs = 20;
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const y = bottom + (top - bottom) * t;
            // 两端固定，中间振幅最大；相位沿弦传播
            const envelope = Math.sin(Math.PI * t);
            const offset = state.amplitude * envelope * Math.sin(state.phase - t * 5.4);
            if (i === 0) {
                g.moveTo(x + offset, y);
            } else {
                g.lineTo(x + offset, y);
            }
        }
        g.stroke();
        g.lineWidth = 8;
        g.strokeColor = withAlpha(color, 24);
        g.stroke();
    }

    private _playGlow(index: number, y: number): void {
        const node = this._glowNodes[index];
        const opacity = this._glowOpacity[index];
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(opacity);
        node.active = true;
        node.setPosition(this._xs[index], y, 0);
        node.setScale(0.7, 0.7, 1);
        opacity.opacity = 255;
        tween(node)
            .to(0.6, { scale: new Vec3(1.3, 1.3, 1) }, { easing: 'quadOut' })
            .call(() => { node.active = false; })
            .start();
        tween(node)
            .by(0.6, { position: new Vec3(0, 34, 0) }, { easing: 'quadOut' })
            .start();
        tween(opacity).to(0.6, { opacity: 0 }).start();
    }

    private _playRipple(index: number, y: number): void {
        const node = this._rippleNodes[index];
        const opacity = this._rippleOpacity[index];
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(opacity);
        node.active = true;
        node.setPosition(this._xs[index], y, 0);
        node.setScale(0.35, 0.35, 1);
        opacity.opacity = 230;
        tween(node)
            .to(0.62, { scale: new Vec3(1.55, 1.55, 1) }, { easing: 'quadOut' })
            .call(() => { node.active = false; })
            .start();
        tween(opacity).to(0.62, { opacity: 0 }).start();
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
