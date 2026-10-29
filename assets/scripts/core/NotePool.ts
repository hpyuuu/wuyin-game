import { Color, Graphics, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { GameConfig } from './GameConfig';
import { LANE_COLORS, withAlpha } from '../ui/Theme';

/** 命中瞬间的高亮色（暖白） */
const COLOR_HIT = new Color(255, 252, 236, 255);

/**
 * NoteView —— 单个音符的表现层
 *
 * 一个音符节点只创建一次（Graphics 也只在创建时绘制一次），
 * 之后通过对象池反复复用，避免运行时频繁 new Node / addComponent。
 */
export class NoteView {
    public readonly node: Node;
    public readonly lane: number;

    private readonly _graphics: Graphics;
    private readonly _opacity: UIOpacity;
    /** 当前八度差：+1 高音 / 0 中音 / -1 低音 */
    private _octave = 0;
    private _paintColor = new Color();

    private constructor(lane: number, parent: Node) {
        this.lane = lane;
        this.node = new Node(`Note_${lane}`);
        this.node.layer = Layers.Enum.UI_2D;

        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(GameConfig.noteWidth, GameConfig.noteHeight);
        transform.setAnchorPoint(0.5, 0.5);

        this._opacity = this.node.addComponent(UIOpacity);
        this._graphics = this.node.addComponent(Graphics);
        this._paint(LANE_COLORS[lane % LANE_COLORS.length]);

        parent.addChild(this.node);
    }

    public static create(lane: number, parent: Node): NoteView {
        return new NoteView(lane, parent);
    }

    /**
     * 按音高设置外观：同一条轨道上，高音更亮并加强光晕，低音压暗，
     * 让玩家在音符下落时就能预判八度（按键仍然只按对应轨道）。
     */
    public setPitch(midi: number, base: number): void {
        const octave = Math.max(-2, Math.min(2, Math.round((midi - base) / 12)));
        if (octave === this._octave) {
            return;
        }
        this._octave = octave;
        this._paint(this._paintColor);
    }

    /**
     * 绘制音符：圆角胶囊 + 内部填充 + 粗描边光晕 + 亮边
     * 只使用一条路径，保证 Graphics 的 fill / stroke 不会互相污染。
     */
    private _paint(color: Color): void {
        this._paintColor = color;
        const g = this._graphics;
        const w = GameConfig.noteWidth;
        const h = GameConfig.noteHeight;
        const r = GameConfig.noteRadius;

        const isHit = color === COLOR_HIT;
        let fill = withAlpha(color, 135);
        let glow = withAlpha(color, 22);
        let glowWidth = 10;
        let edge = withAlpha(color, 235);

        if (!isHit && this._octave > 0) {
            // 高音：轨道色提亮 + 白色描边 + 更强光晕
            fill = new Color(
                Math.min(255, color.r + 45),
                Math.min(255, color.g + 45),
                Math.min(255, color.b + 45),
                165,
            );
            glow = withAlpha(color, 70);
            glowWidth = 16;
            edge = new Color(255, 255, 255, 255);
        } else if (!isHit && this._octave < 0) {
            // 低音：整体压暗
            fill = new Color(
                Math.round(color.r * 0.55),
                Math.round(color.g * 0.55),
                Math.round(color.b * 0.55),
                110,
            );
            glow = withAlpha(color, 8);
            edge = withAlpha(color, 160);
        }

        g.clear();
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fillColor = fill;
        g.fill();

        g.lineWidth = glowWidth;
        g.strokeColor = glow;
        g.stroke();

        g.lineWidth = 1.6;
        g.strokeColor = edge;
        g.stroke();
    }

    /** 从对象池取出时复位视觉状态 */
    public reset(): void {
        Tween.stopAllByTarget(this.node);
        Tween.stopAllByTarget(this._opacity);
        this.node.active = true;
        this.node.setScale(1, 1, 1);
        this._opacity.opacity = 255;
        // 上一轮命中时被改成了高亮色，取出前恢复轨道色与中音外观
        this._octave = 0;
        this._paint(LANE_COLORS[this.lane % LANE_COLORS.length]);
    }

    /** 命中表现：瞬间高亮（暖白 + 轻微放大），随后淡出消失 */
    public playHit(onDone: () => void): void {
        Tween.stopAllByTarget(this.node);
        Tween.stopAllByTarget(this._opacity);

        this._paint(COLOR_HIT);
        this.node.setScale(1.18, 1.18, 1);

        tween(this.node)
            .to(0.1, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'quadOut' })
            .start();

        tween(this._opacity)
            .delay(0.05)
            .to(0.15, { opacity: 0 }, { easing: 'quadOut' })
            .call(onDone)
            .start();
    }

    /** 漏接表现：下沉淡出 */
    public playMiss(onDone: () => void): void {
        Tween.stopAllByTarget(this.node);
        Tween.stopAllByTarget(this._opacity);

        tween(this._opacity)
            .to(0.28, { opacity: 0 })
            .start();
        tween(this.node)
            .by(0.28, { position: new Vec3(0, -36, 0) }, { easing: 'quadIn' })
            .call(onDone)
            .start();
    }

    /** 归还对象池：停止所有动画并隐藏 */
    public sleep(): void {
        Tween.stopAllByTarget(this.node);
        Tween.stopAllByTarget(this._opacity);
        this.node.active = false;
        this.node.setScale(1, 1, 1);
        this._opacity.opacity = 255;
    }
}

/**
 * NotePool —— 音符对象池
 *
 * 按轨道分池：同轨音符外观完全一致，取出即用，无需重绘。
 */
export class NotePool {
    private readonly _layer: Node;
    private readonly _free: NoteView[][] = [];

    constructor(layer: Node) {
        this._layer = layer;
        for (let i = 0; i < GameConfig.laneCount; i++) {
            this._free.push([]);
        }
    }

    public acquire(lane: number): NoteView {
        // 轨道号越界时归到 0，避免 this._free[lane] 为 undefined 时崩溃
        const safeLane = lane >= 0 && lane < this._free.length ? lane : 0;
        const pool = this._free[safeLane];
        let view = pool.pop();
        if (!view) {
            view = NoteView.create(safeLane, this._layer);
        }
        view.reset();
        return view;
    }

    public release(view: NoteView): void {
        if (!view) {
            return;
        }
        const pool = this._free[view.lane];
        if (!pool) {
            return;
        }
        // 同一节点重复归还会让对象池出现重复引用，后续可能被两个音符同时复用
        if (pool.indexOf(view) >= 0) {
            return;
        }
        view.sleep();
        pool.push(view);
    }
}
