import {
    Graphics, ImageAsset, Layers, Node, Size, Sprite, SpriteFrame, Texture2D,
    Tween, tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { GameConfig } from '../core/GameConfig';
import { LaneLayout } from '../core/GameMain';
import { COLOR_JUDGE, LANE_COLORS, withAlpha } from './Theme';

export interface LayoutInfo extends LaneLayout {
    width: number;
    height: number;
    laneWidth: number;
    laneLeft: number;
    laneRight: number;
    /** 顶部安全区高度（微信胶囊按钮占用，设计像素） */
    topInset: number;
}

/**
 * 计算竖屏布局：
 *   四条轨道水平居中，判定线固定在屏幕底部上方，
 *   轨道顶部让出 HUD 与微信胶囊按钮的空间。
 */
export function computeLayout(size: Size, topInset = 0): LayoutInfo {
    const width = size.width;
    const height = size.height;

    const laneWidth = GameConfig.laneWidth;
    const totalWidth = GameConfig.laneCount * laneWidth + (GameConfig.laneCount - 1) * GameConfig.laneGap;
    const laneLeft = -totalWidth / 2;
    const laneX: number[] = [];
    for (let i = 0; i < GameConfig.laneCount; i++) {
        laneX.push(laneLeft + laneWidth / 2 + i * (laneWidth + GameConfig.laneGap));
    }

    const judgeY = -height / 2 + GameConfig.judgeLineFromBottom;
    // 极端矮屏 / 超大安全区时，公式算出的顶部可能低于判定线（下落距离为负），
    // 这里保证轨道至少留出一段可视下落区，避免音符生成逻辑异常。
    const rawTopY = height / 2 - 170 - topInset;
    const topY = Math.max(rawTopY, judgeY + 240);

    return {
        width,
        height,
        laneWidth,
        laneLeft,
        laneRight: laneLeft + totalWidth,
        judgeY,
        topY,
        topInset,
        laneX,
    };
}

/**
 * 读取微信右上角胶囊按钮（"..." 菜单）的底部位置，换算成设计像素。
 * 小游戏里胶囊会盖住右上角 UI，必须把 HUD 往下让开。
 * 浏览器预览等非微信环境返回 0。
 */
export function getSafeTopInset(designWidth: number): number {
    const g: any = globalThis as any;
    try {
        if (g.wx && typeof g.wx.getMenuButtonBoundingClientRect === 'function') {
            const rect = g.wx.getMenuButtonBoundingClientRect();
            const info = typeof g.wx.getWindowInfo === 'function'
                ? g.wx.getWindowInfo()
                : g.wx.getSystemInfoSync();
            if (rect && info && info.windowWidth > 0) {
                const scale = designWidth / info.windowWidth;
                return Math.max(0, rect.bottom * scale + 12);
            }
        }
    } catch (e) {
        // 非微信环境，忽略
    }
    return 0;
}

/** 创建 UI 节点（统一设置 UI_2D 层与 UITransform） */
function makeNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    parent.addChild(node);
    return node;
}

/**
 * SceneBuilder —— 场景视觉搭建
 *
 * 说明：Cocos 的 Graphics 每次 fill / stroke 都会作用于当前全部路径，
 * 因此「一个 Graphics 只画同一种颜色的一组形状」，
 * 不同透明度的发光层用独立节点承载。
 */
export class SceneBuilder {
    public readonly root: Node;
    public readonly noteLayer: Node;
    public readonly layout: LayoutInfo;

    private readonly _keyOpacity: UIOpacity[] = [];
    private readonly _beams: Node[] = [];
    private readonly _beamOpacity: UIOpacity[] = [];
    private readonly _ripples: Node[] = [];
    private readonly _rippleOpacity: UIOpacity[] = [];

    constructor(parent: Node, size: Size, topInset = 0) {
        this.layout = computeLayout(size, topInset);
        this.root = makeNode('Stage', parent);

        this._buildLanes();
        this._buildBeams();

        this.noteLayer = makeNode('NoteLayer', this.root);

        this._buildJudgeLine();
        this._buildKeys();
        this._buildRipples();
    }

    /** 命中时的轨道反馈：光柱 + 波纹 + 键位闪烁 */
    public flashLane(lane: number): void {
        if (lane < 0 || lane >= GameConfig.laneCount) {
            return;
        }

        // 光柱
        const beam = this._beams[lane];
        const beamOpacity = this._beamOpacity[lane];
        Tween.stopAllByTarget(beam);
        Tween.stopAllByTarget(beamOpacity);
        beam.active = true;
        beam.setScale(1, 0.15, 1);
        beamOpacity.opacity = 200;
        tween(beam)
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .delay(0.06)
            .call(() => { beam.active = false; })
            .start();
        tween(beamOpacity).to(0.28, { opacity: 0 }).start();

        // 波纹
        const ripple = this._ripples[lane];
        const rippleOpacity = this._rippleOpacity[lane];
        Tween.stopAllByTarget(ripple);
        Tween.stopAllByTarget(rippleOpacity);
        ripple.active = true;
        ripple.setScale(0.45, 0.45, 1);
        rippleOpacity.opacity = 235;
        tween(ripple)
            .to(0.34, { scale: new Vec3(1.75, 1.75, 1) }, { easing: 'quadOut' })
            .call(() => { ripple.active = false; })
            .start();
        tween(rippleOpacity).to(0.34, { opacity: 0 }).start();

        // 键位闪亮
        const keyOpacity = this._keyOpacity[lane];
        Tween.stopAllByTarget(keyOpacity);
        keyOpacity.opacity = 255;
        tween(keyOpacity).delay(0.06).to(0.26, { opacity: 150 }).start();
    }

    /** 重开时清掉所有残留光效 */
    public resetEffects(): void {
        for (let i = 0; i < GameConfig.laneCount; i++) {
            this._beams[i].active = false;
            this._ripples[i].active = false;
            this._keyOpacity[i].opacity = 150;
        }
    }

    // ------------------------------------------------------------------
    // 轨道
    // ------------------------------------------------------------------

    private _buildLanes(): void {
        const { judgeY, topY, height } = this.layout;
        const top = Math.max(topY + 60, height / 2);
        const bodyWidth = GameConfig.laneWidth - 22;
        const bodyHeight = top - judgeY + 30;
        const centerY = judgeY - 30 + bodyHeight / 2;
        const frame = this._createLaneGradient();

        // 每条轨道一根竖向渐变彩色柱体（顶淡底浓），柱间留缝自然分隔
        for (let i = 0; i < GameConfig.laneCount; i++) {
            const node = makeNode(`LaneBody_${i}`, this.root);
            node.setPosition(this.layout.laneX[i], centerY, 0);

            const sprite = node.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.color = withAlpha(LANE_COLORS[i], 55);

            // 必须在设置 spriteFrame 之后再次指定尺寸，否则会被纹理的 1x64 覆盖
            const transform = node.getComponent(UITransform)!;
            transform.setContentSize(bodyWidth, bodyHeight);
        }
    }

    /**
     * 生成一张 1x64 的白色竖向渐变纹理（顶部透明 → 底部不透明），
     * 五条轨道共用，颜色由 Sprite.color 决定。
     */
    private _createLaneGradient(): SpriteFrame {
        const height = 64;
        const data = new Uint8Array(height * 4);
        for (let y = 0; y < height; y++) {
            const t = y / (height - 1);
            const alpha = Math.round(255 * t);
            const offset = y * 4;
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
            data[offset + 3] = alpha;
        }

        const image = new ImageAsset({
            _data: data,
            width: 1,
            height,
            format: Texture2D.PixelFormat.RGBA8888,
            _compressed: false,
        } as any);
        const texture = new Texture2D();
        texture.image = image;
        texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);

        const frame = new SpriteFrame();
        frame.texture = texture;
        // 运行时生成的纹理不能进动态合图（texSubImage2D 不认这种数据）
        frame.packable = false;
        return frame;
    }

    private _buildBeams(): void {
        for (let i = 0; i < GameConfig.laneCount; i++) {
            const color = LANE_COLORS[i];
            const node = makeNode(`Beam_${i}`, this.root);
            node.setPosition(this.layout.laneX[i], this.layout.judgeY, 0);
            node.active = false;
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;

            const g = node.addComponent(Graphics);
            const w = GameConfig.laneWidth - 34;
            g.rect(-w / 2, 0, w, 300);
            g.fillColor = withAlpha(color, 30);
            g.fill();
            g.lineWidth = 1;
            g.strokeColor = withAlpha(color, 70);
            g.stroke();

            this._beams.push(node);
            this._beamOpacity.push(opacity);
        }
    }

    private _buildJudgeLine(): void {
        const { laneLeft, laneRight, judgeY } = this.layout;
        const left = laneLeft - 18;
        const right = laneRight + 18;

        // 宽光晕
        const glow = makeNode('JudgeGlow', this.root).addComponent(Graphics);
        glow.lineWidth = 18;
        glow.strokeColor = withAlpha(COLOR_JUDGE, 14);
        glow.moveTo(left, judgeY);
        glow.lineTo(right, judgeY);
        glow.stroke();

        // 中间层
        const mid = makeNode('JudgeGlowMid', this.root).addComponent(Graphics);
        mid.lineWidth = 4;
        mid.strokeColor = withAlpha(COLOR_JUDGE, 70);
        mid.moveTo(left, judgeY);
        mid.lineTo(right, judgeY);
        mid.stroke();

        // 亮线
        const core = makeNode('JudgeCore', this.root).addComponent(Graphics);
        core.lineWidth = 1.4;
        core.strokeColor = COLOR_JUDGE;
        core.moveTo(left, judgeY);
        core.lineTo(right, judgeY);
        core.stroke();

        // 两端端点
        const caps = makeNode('JudgeCaps', this.root).addComponent(Graphics);
        caps.lineWidth = 2;
        caps.strokeColor = withAlpha(COLOR_JUDGE, 220);
        caps.moveTo(left, judgeY - 7);
        caps.lineTo(left, judgeY + 7);
        caps.moveTo(right, judgeY - 7);
        caps.lineTo(right, judgeY + 7);
        caps.stroke();
    }

    private _buildKeys(): void {
        for (let i = 0; i < GameConfig.laneCount; i++) {
            const color = LANE_COLORS[i];
            const node = makeNode(`Key_${i}`, this.root);
            node.setPosition(this.layout.laneX[i], this.layout.judgeY - 34, 0);

            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 150;

            const g = node.addComponent(Graphics);
            const w = GameConfig.laneWidth - 26;
            const h = 10;
            g.roundRect(-w / 2, -h / 2, w, h, h / 2);
            g.fillColor = withAlpha(color, 120);
            g.fill();
            g.lineWidth = 6;
            g.strokeColor = withAlpha(color, 20);
            g.stroke();
            g.lineWidth = 1.2;
            g.strokeColor = withAlpha(color, 210);
            g.stroke();

            this._keyOpacity.push(opacity);
        }
    }

    private _buildRipples(): void {
        for (let i = 0; i < GameConfig.laneCount; i++) {
            const color = LANE_COLORS[i];
            const node = makeNode(`Ripple_${i}`, this.root);
            node.setPosition(this.layout.laneX[i], this.layout.judgeY, 0);
            node.active = false;

            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;

            const g = node.addComponent(Graphics);
            g.lineWidth = 2;
            g.strokeColor = withAlpha(color, 230);
            // 扁椭圆波纹（参考视频水波）
            g.ellipse(0, 0, GameConfig.laneWidth * 0.52, 16);
            g.stroke();

            this._ripples.push(node);
            this._rippleOpacity.push(opacity);
        }
    }
}
