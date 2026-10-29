import { Node, Tween, tween, Vec3 } from 'cc';

/**
 * 按压反馈统一参数
 *
 * 所有界面的可交互元素共用同一套数值，保证手感一致：
 *   按下 -> 80ms 缩到 96%
 *   松手 -> 140ms 弹回 100%
 *   手指移动超过 14 像素视为拖动，取消本次点击
 */
export const PRESS_FEEDBACK = {
    /** 按下时相对原始缩放的比例 */
    scale: 0.96,
    /** 按下动画时长（毫秒） */
    downMs: 80,
    /** 回弹动画时长（毫秒） */
    upMs: 140,
    /** 手指移动超过该距离（设计像素）即取消点击 */
    cancelDistance: 14,
};

/**
 * 统一的按压反馈。
 *
 * 反馈直接作用在"命中的那个元素节点"上，因此视觉位置与手指落点天然对齐；
 * 同一时刻最多只有一个元素处于按下态，松手 / 取消 / 切页时自动复位，
 * 不会残留缩放，也不会出现"反馈画在 A、热区在 B"的错位。
 */
export class PressFeedback {
    private _node: Node | null = null;
    private _baseScale = new Vec3(1, 1, 1);

    /** 当前是否有元素处于按下态 */
    public get active(): boolean {
        return !!this._node;
    }

    public press(node: Node | null): void {
        if (!node || !node.isValid) {
            return;
        }
        if (this._node === node) {
            return;
        }
        this.release();
        this._node = node;
        this._baseScale = node.scale.clone();
        this._animate(node, PRESS_FEEDBACK.downMs, PRESS_FEEDBACK.scale);
    }

    public release(): void {
        const node = this._node;
        this._node = null;
        if (!node || !node.isValid) {
            return;
        }
        this._animate(node, PRESS_FEEDBACK.upMs, 1);
    }

    private _animate(node: Node, ms: number, factor: number): void {
        Tween.stopAllByTarget(node);
        const target = new Vec3(
            this._baseScale.x * factor,
            this._baseScale.y * factor,
            this._baseScale.z,
        );
        tween(node)
            .to(ms / 1000, { scale: target }, { easing: 'quadOut' })
            .start();
    }
}
