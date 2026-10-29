export declare class Color { r: number; g: number; b: number; a: number; constructor(r?: number, g?: number, b?: number, a?: number); }
export declare class Vec2 { x: number; y: number; constructor(x?: number, y?: number); }
export declare class Vec3 { x: number; y: number; z: number; constructor(x?: number, y?: number, z?: number); clone(): Vec3; }
export declare class Node {
    name: string; layer: number; active: boolean; activeInHierarchy: boolean; children: Node[];
    constructor(name?: string);
    addChild(child: Node): void;
    addComponent<T>(Ctor: new () => T): T;
    getComponent<T>(Ctor: new () => T): T | null;
    setPosition(x: number | Vec3, y?: number, z?: number): void;
    setScale(x: number, y: number, z?: number): void;
    setRotationFromEuler(x: number, y: number, z: number): void;
    readonly isValid: boolean;
    readonly scale: Vec3;
    destroyAllChildren(): void;
}
export declare class Layers { static Enum: { UI_2D: number }; }
export declare class UITransform { width: number; height: number; setContentSize(w: number, h: number): void; setAnchorPoint(x: number, y: number): void; hitTest(p: any, id?: number): boolean; convertToNodeSpaceAR(v: Vec3): Vec3; }
export declare class UIOpacity { opacity: number; }
export declare class Graphics { fillColor: Color; strokeColor: Color; lineWidth: number; clear(): void; roundRect(x: number, y: number, w: number, h: number, r: number): void; rect(x: number, y: number, w: number, h: number): void; circle(x: number, y: number, r: number): void; ellipse(x: number, y: number, rx: number, ry: number): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void; fill(): void; }
export declare class Label { string: string; color: Color; fontSize: number; lineHeight: number; isBold: boolean; useSystemFont: boolean; fontFamily: string; overflow: number; cacheMode: number; horizontalAlign: number; verticalAlign: number; node: Node; static HorizontalAlign: any; static VerticalAlign: any; static Overflow: any; static CacheMode: any; }
export declare class EventTouch { getLocation(): Vec2; getUILocation(): Vec2; getID(): number; windowId: number; }
export declare class Sprite { spriteFrame: any; type: number; sizeMode: number; color: Color; static Type: any; static SizeMode: any; }
export declare class Texture2D { image: any; static Filter: any; static PixelFormat: any; setFilters(a: number, b: number): void; }
export declare class ImageAsset { constructor(info: any); }
export declare class SpriteFrame { texture: any; packable: boolean; }
export declare class Size { width: number; height: number; constructor(w?: number, h?: number); }
export declare class AudioClip { }
export declare class JsonAsset { json: any; constructor(json?: any); }
export declare const resources: { load(path: string, type: any, cb: (err: any, asset: any) => void): void; };
export declare const view: { getVisibleSize(): Size; };
export declare const game: { frameRate: number };
export declare const input: { on(...a: any[]): void; off(...a: any[]): void; };
export declare const Input: { EventType: any };
export declare const KeyCode: any;
export declare class Tween { static stopAllByTarget(t: any): void; }
export declare function tween(target?: any): any;
export declare function __setResource(path: string, value: any): void;
export declare function __clearResources(): void;
