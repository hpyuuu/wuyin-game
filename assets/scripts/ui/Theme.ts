import { Color } from 'cc';

/**
 * Theme —— 视觉基调（参考视频：近黑底 + 细网格 + 五种发光色 + 衬线中文）
 */

/** 深色背景 */
export const COLOR_BG = new Color(5, 6, 8, 255);
/** 网格线 */
export const COLOR_GRID = new Color(255, 255, 255, 9);
/** 主文字（暖白） */
export const COLOR_TEXT = new Color(236, 230, 218, 255);
/** 次级文字 */
export const COLOR_TEXT_DIM = new Color(236, 230, 218, 110);
/** 判定线（暖金） */
export const COLOR_JUDGE = new Color(214, 178, 104, 255);

/**
 * 五条轨道的颜色，取自参考视频的「宫 / 商 / 角 / 徵 / 羽」
 * 金 → 土黄 → 橙红 → 青 → 蓝紫
 */
export const LANE_COLORS: Color[] = [
    new Color(228, 182, 90, 255),   // 宫 · 金
    new Color(198, 176, 120, 255),  // 商 · 土黄
    new Color(210, 106, 62, 255),   // 角 · 橙红
    new Color(52, 148, 160, 255),   // 徵 · 青
    new Color(116, 126, 226, 255),  // 羽 · 蓝紫
];

/** 五音名称（从左到右） */
export const LANE_NAMES: string[] = ['宫', '商', '角', '徵', '羽'];

/** 五音对应的简谱数字 */
export const LANE_NUMBERS: string[] = ['1', '2', '3', '5', '6'];

/** 判定等级颜色 */
export const GRADE_COLORS: Record<string, Color> = {
    PERFECT: new Color(236, 198, 120, 255),
    GREAT: new Color(96, 196, 204, 255),
    GOOD: new Color(198, 148, 92, 255),
    MISS: new Color(140, 140, 145, 255),
};

export const FONT_SERIF = 'serif';
export const FONT_SANS = 'sans-serif';

/** 便捷构造带透明度颜色 */
export function rgba(r: number, g: number, b: number, a: number): Color {
    return new Color(r, g, b, a);
}

/** 复制颜色并替换 alpha */
export function withAlpha(color: Color, alpha: number): Color {
    return new Color(color.r, color.g, color.b, alpha);
}

/** 生成"字距感"的英文小标题：NOTES -> N O T E S */
export function spaced(text: string): string {
    return text.split('').join(' ');
}
