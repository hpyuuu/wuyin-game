import { Color, Graphics, Layers, Node, Size, tween, UIOpacity, UITransform } from 'cc';
import { COLOR_BG, COLOR_GRID } from './Theme';

/**
 * Backdrop —— 全局背景层（所有页面共用）
 *
 * 近黑底 + 72px 细网格 + 底部深色渐隐，
 * 保证主菜单、节奏模式、自由弹奏、宣传页的视觉基调一致。
 */
export class Backdrop {
    public readonly root: Node;

    constructor(parent: Node, size: Size) {
        this.root = new Node('Backdrop');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        parent.addChild(this.root);

        const w = size.width;
        const h = size.height;

        // 底色
        const base = new Node('BgBase');
        base.layer = Layers.Enum.UI_2D;
        base.addComponent(UITransform);
        this.root.addChild(base);
        const baseGfx = base.addComponent(Graphics);
        baseGfx.fillColor = COLOR_BG;
        baseGfx.rect(-w / 2, -h / 2, w, h);
        baseGfx.fill();

        // 细网格
        const grid = new Node('BgGrid');
        grid.layer = Layers.Enum.UI_2D;
        grid.addComponent(UITransform);
        this.root.addChild(grid);
        const gridGfx = grid.addComponent(Graphics);
        const step = 72;
        gridGfx.lineWidth = 1;
        gridGfx.strokeColor = COLOR_GRID;
        for (let x = -w / 2; x <= w / 2; x += step) {
            gridGfx.moveTo(x, -h / 2);
            gridGfx.lineTo(x, h / 2);
        }
        for (let y = -h / 2; y <= h / 2; y += step) {
            gridGfx.moveTo(-w / 2, y);
            gridGfx.lineTo(w / 2, y);
        }
        gridGfx.stroke();

        // 底部渐隐（用几条同色矩形叠出层次）
        const fade = new Node('BgFade');
        fade.layer = Layers.Enum.UI_2D;
        fade.addComponent(UITransform);
        this.root.addChild(fade);
        const fadeGfx = fade.addComponent(Graphics);
        fadeGfx.fillColor = COLOR_BG;
        for (let i = 0; i < 6; i++) {
            const barH = (h * 0.18) / 6;
            const y = -h / 2 + i * barH;
            fadeGfx.rect(-w / 2, y, w, barH + 1);
        }
        fadeGfx.fill();

        // 顶部渐隐：让轨道 / 琴弦的顶端淡入黑色（参考视频）
        const fadeTop = new Node('BgFadeTop');
        fadeTop.layer = Layers.Enum.UI_2D;
        fadeTop.addComponent(UITransform);
        this.root.addChild(fadeTop);
        const ft = fadeTop.addComponent(Graphics);
        ft.fillColor = new Color(5, 6, 8, 200);
        ft.rect(-w / 2, h / 2 - h * 0.2, w, h * 0.2);
        ft.fill();

        const fadeTop2 = new Node('BgFadeTop2');
        fadeTop2.layer = Layers.Enum.UI_2D;
        fadeTop2.addComponent(UITransform);
        this.root.addChild(fadeTop2);
        const ft2 = fadeTop2.addComponent(Graphics);
        ft2.fillColor = new Color(5, 6, 8, 130);
        ft2.rect(-w / 2, h / 2 - h * 0.085, w, h * 0.085);
        ft2.fill();

        // 漂浮星点
        const stars = new Node('Stars');
        stars.layer = Layers.Enum.UI_2D;
        stars.addComponent(UITransform);
        this.root.addChild(stars);
        const sg = stars.addComponent(Graphics);
        sg.fillColor = new Color(236, 230, 218, 95);
        for (let i = 0; i < 26; i++) {
            const sx = (Math.random() - 0.5) * w * 0.92;
            const sy = (Math.random() - 0.5) * h * 0.84;
            sg.circle(sx, sy, 0.6 + Math.random() * 1.0);
        }
        sg.fill();

        const so = stars.addComponent(UIOpacity);
        so.opacity = 190;
        tween(so)
            .to(1.8, { opacity: 80 })
            .to(1.8, { opacity: 200 })
            .union()
            .repeatForever()
            .start();
    }
}
