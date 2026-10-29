// 极简 cc 引擎替身，仅覆盖被测模块实际用到的 API
class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) {
        this.r = r; this.g = g; this.b = b; this.a = a;
    }
}

class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}

class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vec3(this.x, this.y, this.z); }
}

class Gfx {
    constructor() {
        this.fillColor = new Color();
        this.strokeColor = new Color();
        this.lineWidth = 1;
        this.calls = 0;
    }
    clear() { this.calls++; }
    roundRect() { }
    rect() { }
    circle() { }
    ellipse() { }
    moveTo() { }
    lineTo() { }
    stroke() { }
    fill() { }
}

class Transform {
    constructor() {
        this.width = 100;
        this.height = 100;
        this.anchorX = 0.5;
        this.anchorY = 0.5;
    }
    setContentSize(w, h) { this.width = w; this.height = h; }
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
    hitTest() { return false; }
    convertToNodeSpaceAR(v) { return v; }
}

class Opacity {
    constructor() { this.opacity = 255; }
}

class Node {
    constructor(name = '') {
        this.name = name;
        this.layer = 0;
        this.active = true;
        this.children = [];
        this.parent = null;
        this.components = [];
        this.position = new Vec3();
        this._scale = new Vec3(1, 1, 1);
    }
    get activeInHierarchy() {
        let n = this;
        while (n) {
            if (!n.active) return false;
            n = n.parent;
        }
        return true;
    }
    addChild(child) {
        child.parent = this;
        this.children.push(child);
    }
    addComponent(Ctor) {
        const c = new Ctor();
        if (!c.node) c.node = this;
        this.components.push(c);
        return c;
    }
    getComponent(Ctor) {
        return this.components.find((c) => c instanceof Ctor) || null;
    }
    setPosition(x, y, z = 0) {
        if (typeof x === 'object') {
            this.position = new Vec3(x.x, x.y, x.z || 0);
        } else {
            this.position = new Vec3(x, y, z);
        }
    }
    setScale(x, y, z = 1) { this._scale = new Vec3(x, y, z); }
    setRotationFromEuler() { }
    get isValid() { return true; }
    get scale() { return this._scale; }
    destroyAllChildren() {
        this.children.forEach((c) => { c.parent = null; });
        this.children = [];
    }
}

// tween 替身：链式调用，start 时按顺序同步执行 call 回调
class TweenChain {
    constructor() { this.calls = []; }
    to() { return this; }
    by() { return this; }
    delay() { return this; }
    call(fn) { this.calls.push(fn); return this; }
    union() { return this; }
    repeatForever() { return this; }
    start() { this.calls.forEach((fn) => fn()); return this; }
    stop() { }
}

const Tween = {
    stopAllByTarget() { },
};

function tween() {
    return new TweenChain();
}

const Layers = { Enum: { UI_2D: 1 << 25 } };

class UITransform extends Transform { }
class UIOpacity extends Opacity { }
class Graphics extends Gfx { }
class Label {
    constructor() {
        this.string = '';
        this.color = new Color();
        this.fontSize = 14;
        this.lineHeight = 18;
        this.node = null;
        this.cacheMode = 0;
        this.overflow = 0;
        this.horizontalAlign = 1;
        this.verticalAlign = 1;
        this.isBold = false;
        this.useSystemFont = true;
        this.fontFamily = '';
    }
    static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
    static VerticalAlign = { TOP: 0, CENTER: 1, BOTTOM: 2 };
    static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
    static CacheMode = { NONE: 0, BITMAP: 1, CHAR: 2 };
}

class Sprite {
    constructor() {
        this.spriteFrame = null;
        this.type = 0;
        this.sizeMode = 0;
        this.color = new Color();
    }
    static Type = { SIMPLE: 0, SLICED: 1, TILED: 2, FILLED: 3 };
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
}

class Texture2D {
    constructor() {
        this.image = null;
        this.width = 0;
        this.height = 0;
    }
    setFilters() { }
    static Filter = { LINEAR: 0, NEAREST: 1 };
    static PixelFormat = { RGBA8888: 35 };
}

class ImageAsset {
    constructor(info) { Object.assign(this, info); }
}

class SpriteFrame {
    constructor() {
        this.texture = null;
        this.packable = true;
    }
}

class Size {
    constructor(w = 0, h = 0) { this.width = w; this.height = h; }
}

class AudioClip { }
class JsonAsset {
    constructor(json = null) { this.json = json; }
}

const loadedResources = new Map();

const resources = {
    load(path, type, cb) {
        const hit = loadedResources.get(path);
        if (hit === undefined) {
            cb(new Error('not found: ' + path), null);
            return;
        }
        cb(null, hit);
    },
};

const view = {
    getVisibleSize() { return new Size(720, 1280); },
};

const game = { frameRate: 60 };
const input = { on() { }, off() { } };
const Input = { EventType: {} };
const KeyCode = {};

class EventTouch {
    getLocation() { return new Vec2(0, 0); }
    getUILocation() { return new Vec2(0, 0); }
    getID() { return 0; }
}

module.exports = {
    Color, Vec2, Vec3, Node, Layers, UITransform, UIOpacity, Graphics, Label, EventTouch,
    Sprite, Texture2D, ImageAsset, SpriteFrame, Size, AudioClip, JsonAsset,
    resources, view, game, input, Input, KeyCode, Tween, tween,
    __setResource(path, value) { loadedResources.set(path, value); },
    __clearResources() { loadedResources.clear(); },
};
