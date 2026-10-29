import {
    _decorator, Camera, Canvas, Component, EventKeyboard, EventTouch, game, Graphics, input, Input,
    KeyCode, Label, Layers, Node, Size, UITransform, Vec3, view, Widget,
} from 'cc';
import { AudioManager } from './core/AudioManager';
import { ChartData } from './core/ChartTypes';
import {
    createEmptyChart, deleteCustomChart, importFromClipboard, loadChart, loadChartById, saveCustomChart,
} from './core/ChartStore';
import { GameConfig } from './core/GameConfig';
import { GameMain, GameStats } from './core/GameMain';
import { NotePool } from './core/NotePool';
import { saveBest } from './core/ScoreStore';
import { Backdrop } from './ui/Backdrop';
import { ChartEditor, EditorHit } from './ui/ChartEditor';
import { ChartSelect, SelectAction } from './ui/ChartSelect';
import { FreePlay } from './ui/FreePlay';
import { HUD } from './ui/HUD';
import { MainMenu, MenuAction } from './ui/MainMenu';
import { PressFeedback, PRESS_FEEDBACK } from './ui/PressFeedback';
import { PromoPage } from './ui/PromoPage';
import { getSafeTopInset, SceneBuilder } from './ui/SceneBuilder';
import { COLOR_TEXT, FONT_SERIF, withAlpha } from './ui/Theme';

const { ccclass } = _decorator;

type EntryMode = 'ready' | 'loading' | 'playing' | 'finished';
type Screen = 'menu' | 'select' | 'editor' | 'rhythm' | 'free' | 'promo';

/**
 * GameEntry —— 场景入口 + 页面路由
 *
 * 页面：
 *   menu   主界面（节奏模式 / 自由弹奏 / 宣传内容）
 *   rhythm 五轨节奏模式（原有玩法）
 *   free   自由弹奏（五根琴弦）
 *   promo  宣传内容
 */
@ccclass('GameEntry')
export class GameEntry extends Component {
    private _stage: SceneBuilder = null!;
    private _hud: HUD = null!;
    private _game: GameMain = null!;
    private _menu: MainMenu = null!;
    private _freePlay: FreePlay = null!;
    private _promo: PromoPage = null!;
    private _select: ChartSelect = null!;
    private _editor: ChartEditor = null!;

    private _backNode: Node = null!;
    private _backCx = 0;
    private _backCy = 0;
    private _topInset = 0;
    /** 上次布局时使用的节点尺寸，用于检测屏幕尺寸变化后重新定位返回键 */
    private _layoutW = 0;
    private _layoutH = 0;

    private _chartReady: Promise<void> | null = null;
    /** 每次开局自增，用于丢弃"加载期间已切屏/重进"的过期流程 */
    private _loadToken = 0;
    /** 当前谱面 id：最高分按谱面分别记录 */
    private _chartKey = 'default';
    private _mode: EntryMode = 'ready';
    private _screen: Screen = 'menu';
    private _acceptRestart = false;
    private _acceptPromoBack = false;

    /** 统一按压反馈（所有页面共用同一套参数） */
    private readonly _press = new PressFeedback();
    /** UI 相机：把屏幕坐标反投影到世界，保证输入与渲染同源 */
    private _uiCamera: Camera | null = null;
    /** 按下时记录的动作，松手才执行（拖动超过阈值会取消） */
    private _pendingTap: (() => void) | null = null;
    private _tapStartX = 0;
    private _tapStartY = 0;

    protected start(): void {
        game.frameRate = 60;

        // 先让 Canvas 与真实可见区域完全重合。
        // 这一步是点击精度的前提：Canvas 若停在设计分辨率 720×1280 的中心，
        // 而相机 / 输入换算按屏幕实际可见高度（如 720×1558）进行，
        // 两套基准会相差 (1558-1280)/2 ≈ 139 设计像素，
        // 表现就是「反馈画在手指上方，要往下点才生效」。
        const visible = view.getVisibleSize();
        this._syncCanvasSize(visible);
        this._uiCamera = this.node.scene ? this.node.scene.getComponentInChildren(Camera) : null;

        // 统一尺寸基准：优先用节点自身 UITransform（Widget 对齐后的真实 UI 尺寸），
        // 这样「布局坐标」和「触摸坐标」来自同一个坐标系，点击位置不会漂移。
        // 关键：start() 时 Widget 可能还没对齐，必须先强制对齐一次，
        // 否则读到的是编辑器里的 720×1280，所有以顶部为基准的元素都会整体下沉。
        const rootWidget = this.node.getComponent(Widget);
        if (rootWidget) {
            rootWidget.updateAlignment();
        }
        const rootTransform = this.node.getComponent(UITransform);
        // 取较大值：Widget 未生效时 visibleSize 才是真实可见区域
        const width = Math.max(rootTransform ? rootTransform.width : 0, visible.width);
        const height = Math.max(rootTransform ? rootTransform.height : 0, visible.height);
        const size = new Size(width, height);

        // 让节点矩形与布局基准一致（Widget 在部分机型上只对齐到设计分辨率高度），
        // 保证后续任何依赖节点尺寸的逻辑（含 hitTest）读到的都是真实可见区域。
        if (rootTransform) {
            rootTransform.setContentSize(width, height);
        }

        // 微信小游戏右上角有胶囊按钮，HUD 需要往下让开
        const topInset = getSafeTopInset(size.width);

        // 1) 全局背景（所有页面共用）
        new Backdrop(this.node, size);

        // 2) 节奏模式场景与 HUD（默认隐藏，从主菜单进入）
        this._stage = new SceneBuilder(this.node, size, topInset);
        this._hud = new HUD(this.node, this._stage.layout);
        this._stage.root.active = false;
        this._hud.setVisible(false);

        // 3) 三个页面
        this._menu = new MainMenu(this.node, this._stage.layout);
        this._freePlay = new FreePlay(this.node, this._stage.layout);
        this._promo = new PromoPage(this.node, this._stage.layout);
        this._select = new ChartSelect(this.node, this._stage.layout);
        this._editor = new ChartEditor(this.node, this._stage.layout);

        // 4) 通用返回按钮（非主界面显示，固定在左上角，避开底部手势区）
        this._buildBackButton(size, topInset);

        // 5) 玩法
        const pool = new NotePool(this._stage.noteLayer);
        this._game = new GameMain(AudioManager.instance, pool, {
            onJudge: (result, stats) => {
                this._hud.showJudge(result);
                this._hud.updateStats(stats);
            },
            onHit: (lane, midi) => {
                // 按下轨道 = 演奏该音符原本的音高
                AudioManager.instance.playNote(midi);
                this._stage.flashLane(lane);
            },
            onAuto: (midi) => {
                // 半音伴奏自动发声，音量略低，避免盖过玩家打出的音
                AudioManager.instance.playNote(midi, 0.7);
            },
            onFinish: (stats: GameStats) => this._handleFinish(stats),
        });
        this._game.setLayout(this._stage.layout);

        // 6) 谱面（异步加载，失败自动用内置兜底）
        this._chartReady = loadChart().then((chart) => {
            this._game.load(chart);
            this._hud.setTitle(chart.name);
            this._chartKey = (chart.meta && chart.meta.id) || 'default';
        });

        // 7) 输入
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);

        // 8) 统一初始状态：确保除主菜单外的页面全部隐藏，
        //    否则自由弹奏的琴弦等元素会叠在主菜单上，看起来像「按钮偏移」
        this._showMenu();
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
    }

    protected update(dt: number): void {
        this._syncBackLayout();
        if (this._screen === 'rhythm' && this._game) {
            this._game.update(dt);
        }
        if (this._screen === 'free' && this._freePlay) {
            this._freePlay.update(dt);
        }
    }

    // ------------------------------------------------------------------
    // 页面切换
    // ------------------------------------------------------------------

    private _showMenu(): void {
        this._screen = 'menu';
        this._menu.show();
        this._freePlay.hide();
        this._promo.hide();
        this._select.hide();
        this._editor.hide();
        this._stage.root.active = false;
        this._hud.setVisible(false);
        this._backNode.active = false;

        AudioManager.instance.stopClock();
        this._mode = 'ready';
    }

    private _enterFree(): void {
        this._screen = 'free';
        this._menu.hide();
        this._freePlay.show();
        this._promo.hide();
        this._stage.root.active = false;
        this._hud.setVisible(false);
        this._backNode.active = true;

        // 自由弹奏只需要音效，不启动谱面时钟
        AudioManager.instance.stopClock();
        this._mode = 'ready';
        void AudioManager.instance.init().catch(() => { /* 无音频时静音，不影响拨弦视觉 */ });
    }

    private _enterPromo(): void {
        this._screen = 'promo';
        this._menu.hide();
        this._freePlay.hide();
        this._promo.show();
        this._stage.root.active = false;
        this._hud.setVisible(false);
        this._backNode.active = true;

        this._acceptPromoBack = false;
        this.scheduleOnce(() => {
            this._acceptPromoBack = true;
        }, 0.5);
    }

    private _enterRhythm(chart?: ChartData): void {
        this._screen = 'rhythm';
        this._menu.hide();
        this._freePlay.hide();
        this._promo.hide();
        this._select.hide();
        this._editor.hide();
        this._stage.root.active = true;
        this._hud.setVisible(true);
        this._backNode.active = true;

        if (chart) {
            this._game.load(chart);
            this._hud.setTitle(chart.name);
            this._chartKey = (chart.meta && chart.meta.id) || 'default';
            this._chartReady = Promise.resolve();
        }
        void this._startGame();
    }

    /** 选谱页：7 套内置谱（3 首节奏型 + 4 首民歌古曲）+ 玩家自制谱 */
    private _enterSelect(): void {
        this._screen = 'select';
        this._menu.hide();
        this._freePlay.hide();
        this._promo.hide();
        this._editor.hide();
        this._stage.root.active = false;
        this._hud.setVisible(false);
        this._backNode.active = true;
        this._select.show();

        AudioManager.instance.stopClock();
        this._mode = 'ready';
    }

    /** 琴谱编辑器 */
    private _enterEditor(chart: ChartData): void {
        this._screen = 'editor';
        this._menu.hide();
        this._freePlay.hide();
        this._promo.hide();
        this._select.hide();
        this._stage.root.active = false;
        this._hud.setVisible(false);
        this._backNode.active = true;
        this._editor.open(chart);

        AudioManager.instance.stopClock();
        this._mode = 'ready';
    }

    /** 选谱页点击分发 */
    private _onSelectAction(hit: SelectAction): void {
        if (hit.type === 'start') {
            void loadChartById(hit.meta.id).then((chart) => this._enterRhythm(chart));
            return;
        }
        if (hit.type === 'delete') {
            deleteCustomChart(hit.meta.id);
            this._select.refresh();
            return;
        }
        if (hit.type === 'page') {
            this._select.setPage(hit.page);
            return;
        }
        if (hit.type === 'filter') {
            this._select.setFilter(hit.value);
            return;
        }
        if (hit.type === 'create') {
            this._enterEditor(createEmptyChart('新 谱', 120, 'NORMAL'));
            return;
        }
        // 导入：读取剪贴板（JSON 谱面或简谱文本）→ 保存 → 刷新列表
        void importFromClipboard('导入琴谱', 120, 'NORMAL').then((chart) => {
            if (chart) {
                saveCustomChart(chart);
                this._select.refresh();
            }
        });
    }

    private _onMenuAction(action: MenuAction): void {
        if (action === 'rhythm') {
            this._enterSelect();
        } else if (action === 'free') {
            this._enterFree();
        } else {
            this._enterPromo();
        }
    }

    // ------------------------------------------------------------------
    // 输入
    // ------------------------------------------------------------------

    private _onTouchStart(event: EventTouch): void {
        const local = this._toLocal(event);
        this._tapStartX = local.x;
        this._tapStartY = local.y;
        this._clearPendingTap();

        // 返回按钮优先：编辑器返回到选谱页，其他返回主菜单
        if (this._screen !== 'menu' && this._hitBack(event)) {
            this._press.press(this._backNode);
            this._pendingTap = () => {
                if (this._screen === 'editor') {
                    this._enterSelect();
                } else {
                    this._showMenu();
                }
            };
            return;
        }

        switch (this._screen) {
            case 'menu': {
                const action = this._menu.hitTest(event);
                if (action) {
                    // 反馈直接作用在命中的卡片上，位置与手指落点一致
                    this._press.press(this._menu.nodeOf(action));
                    this._pendingTap = () => this._onMenuAction(action);
                }
                break;
            }
            case 'free':
                // 拨弦属于即时玩法，按下就发声
                this._freePlay.pluckAt(local.x, local.y, event.getID());
                break;
            case 'promo':
                if (this._acceptPromoBack) {
                    this._showMenu();
                }
                break;
            case 'select': {
                const hit = this._select.hitTest(event);
                if (hit) {
                    this._press.press(hit.node);
                    this._pendingTap = () => this._onSelectAction(hit.action);
                }
                break;
            }
            case 'editor': {
                // 先记录按下点：无论点在按钮、网格还是空白处，
                // 都从这里开始计算拖动距离，避免沿用它上次触摸的位置导致网格跳滚。
                this._editor.onTouchStart(local.x, local.y);
                const hit = this._editor.hitTest(local.x, local.y);
                if (!hit) {
                    break;
                }
                // 网格点击由格子高亮本身反馈，不做缩放
                if (hit.type !== 'grid') {
                    this._press.press(this._editor.nodeOf(hit));
                    this._pendingTap = () => this._onEditorAction(hit);
                }
                break;
            }
            case 'rhythm':
                // 击打判定必须在按下瞬间完成，否则会损失手感
                this._onRhythmTouch(event);
                break;
            default:
                break;
        }
    }

    private _onTouchMove(event: EventTouch): void {
        const local = this._toLocal(event);
        // 手指划出容差范围即视为拖动：取消本次点击并复位按压反馈
        if (this._pendingTap) {
            const moved = Math.abs(local.x - this._tapStartX) > PRESS_FEEDBACK.cancelDistance
                || Math.abs(local.y - this._tapStartY) > PRESS_FEEDBACK.cancelDistance;
            if (moved) {
                this._clearPendingTap();
                this._press.release();
            }
        }
        if (this._screen === 'editor') {
            this._editor.onTouchMove(local.x, local.y);
            return;
        }
        if (this._screen === 'free') {
            this._freePlay.pluckAt(local.x, local.y, event.getID());
        }
    }

    private _onTouchEnd(event: EventTouch): void {
        const tap = this._pendingTap;
        this._clearPendingTap();
        this._press.release();

        // 先执行待处理动作（可能切屏），再处理页面的触摸收尾
        if (tap) {
            tap();
            return;
        }

        if (this._screen === 'free') {
            this._freePlay.releaseTouch(event.getID());
            return;
        }
        if (this._screen === 'editor') {
            const local = this._toLocal(event);
            this._editor.onTouchEnd(local.x, local.y);
        }
    }

    /** 触摸被系统取消：只复位状态，不触发任何动作 */
    private _onTouchCancel(event: EventTouch): void {
        this._clearPendingTap();
        this._press.release();
        if (this._screen === 'editor') {
            this._editor.cancelTouch();
        } else if (this._screen === 'free') {
            this._freePlay.releaseTouch(event.getID());
        }
    }

    private _clearPendingTap(): void {
        this._pendingTap = null;
    }

    /** 编辑器按钮动作：保存 / 试听 / 切 BPM / 切难度 */
    private _onEditorAction(hit: EditorHit): void {
        if (hit.type === 'save') {
            saveCustomChart(this._editor.buildChart());
            this._enterSelect();
        } else if (hit.type === 'play') {
            const chart = this._editor.buildChart();
            saveCustomChart(chart);
            this._enterRhythm(chart);
        } else if (hit.type === 'bpm') {
            this._editor.setBpm(hit.value);
        } else if (hit.type === 'difficulty') {
            this._editor.setDifficulty(hit.value);
        }
    }

    /** 节奏模式内部：结算页点击重开 */
    private _onRhythmTouch(event: EventTouch): void {
        if (this._mode === 'finished') {
            if (this._acceptRestart) {
                this._restartGame();
            }
            return;
        }
        if (this._mode !== 'playing') {
            return;
        }
        const local = this._toLocal(event);
        const lane = this._laneOfLocal(local.x);
        if (lane >= 0) {
            this._game.pressLane(lane);
        }
    }

    private _onKeyDown(event: EventKeyboard): void {
        if (this._screen !== 'rhythm') {
            return;
        }
        if (this._mode === 'finished') {
            if (this._acceptRestart) {
                this._restartGame();
            }
            return;
        }
        if (this._mode !== 'playing') {
            return;
        }
        switch (event.keyCode) {
            case KeyCode.KEY_D:
                this._game.pressLane(0);
                break;
            case KeyCode.KEY_F:
                this._game.pressLane(1);
                break;
            case KeyCode.KEY_G:
                this._game.pressLane(2);
                break;
            case KeyCode.KEY_J:
                this._game.pressLane(3);
                break;
            case KeyCode.KEY_K:
                this._game.pressLane(4);
                break;
            default:
                break;
        }
    }

    /**
     * 触摸点 -> GameRoot 本地坐标。
     *
     * 走 UI 相机的 screenToWorld，与渲染共用同一套相机与视口。
     * 之前用 getUILocation + convertToNodeSpaceAR，在长屏机型上两者基准不同
     * （可见高度 vs 设计高度），会差出 (visibleHeight - designHeight)/2，
     * 表现就是「反馈画在手指上方、要往下点才生效」。
     */
    private _toLocal(event: EventTouch): Vec3 {
        const transform = this.node.getComponent(UITransform);
        const screen = event.getLocation();
        if (!transform) {
            return new Vec3(screen.x, screen.y, 0);
        }
        if (this._uiCamera) {
            const world = this._uiCamera.screenToWorld(new Vec3(screen.x, screen.y, 0), new Vec3());
            return transform.convertToNodeSpaceAR(world);
        }
        // 没有相机时退回 UI 坐标（老实现），保证不至于完全点不动
        const ui = event.getUILocation();
        return transform.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    /**
     * 让 Canvas 的尺寸、世界位置与相机视野三者完全一致。
     *
     * 长屏机型上 view.getVisibleSize() 会大于设计分辨率（如 720×1558），
     * 若 Canvas 仍停在设计分辨率中心（720×1280 的中心），
     * 相机 / 输入换算的基准就会与渲染基准错开约 139 设计像素。
     */
    private _syncCanvasSize(size: Size): void {
        const canvasNode = this.node.parent;
        if (!canvasNode) {
            return;
        }
        const transform = canvasNode.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(size.width, size.height);
        }
        canvasNode.setPosition(size.width / 2, size.height / 2, 0);

        const canvas = canvasNode.getComponent(Canvas);
        const camera = canvas && canvas.cameraComponent ? canvas.cameraComponent : null;
        if (camera) {
            camera.orthoHeight = size.height / 2;
        }
    }

    /** 本地 x -> 轨道号（落在轨道外侧时吸附到最近轨道） */
    private _laneOfLocal(x: number): number {
        const layout = this._stage.layout;
        const step = layout.laneWidth + GameConfig.laneGap;
        let lane = Math.round((x - layout.laneLeft - layout.laneWidth / 2) / step);
        if (lane < 0) {
            lane = 0;
        }
        if (lane >= GameConfig.laneCount) {
            lane = GameConfig.laneCount - 1;
        }
        return lane;
    }

    private _buildBackButton(size: { width: number; height: number }, topInset: number): void {
        // 直接用 start() 里已统一的尺寸，保证与页面布局同源
        const width = size.width;
        const height = size.height;

        // 左上角，位于微信胶囊下方、页面标题上方的空白区
        this._topInset = topInset;
        this._layoutW = width;
        this._layoutH = height;
        this._backCx = -width / 2 + 32;
        this._backCy = height / 2 - topInset - 50;

        const node = new Node('Back');
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0, 0.5);
        // 热区 = 可视胶囊尺寸，二者完全重合
        transform.setContentSize(148, 56);
        node.setPosition(this._backCx, this._backCy, 0);
        this.node.addChild(node);

        // 可见的胶囊背景，避免"看不见按钮"
        const g = node.addComponent(Graphics);
        g.roundRect(0, -28, 148, 56, 28);
        g.fillColor = withAlpha(COLOR_TEXT, 18);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = withAlpha(COLOR_TEXT, 70);
        g.stroke();

        // Label 必须挂在没有 Graphics 的子节点上（同一节点只能有一个渲染组件）
        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setAnchorPoint(0, 0.5);
        labelTransform.setContentSize(120, 34);
        labelNode.setPosition(26, 0, 0);
        node.addChild(labelNode);

        const label = labelNode.addComponent(Label);
        label.useSystemFont = true;
        label.fontFamily = FONT_SERIF;
        label.fontSize = 22;
        label.lineHeight = 30;
        label.color = withAlpha(COLOR_TEXT, 210);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        label.string = '‹  返回';

        this._backNode = node;
        this._backNode.active = false;
    }

    /**
     * 节点尺寸变化后重新定位返回键。
     *
     * start() 执行时 Widget 可能还没完成真机尺寸对齐（仍是编辑器里的 720×1280），
     * 之后父节点被拉伸到真实尺寸时，如果按钮位置不跟着更新就会「画面在下、判定在上」。
     * 每帧只做两次浮点比较，开销可忽略。
     */
    private _syncBackLayout(): void {
        const node = this._backNode;
        if (!node || !node.activeInHierarchy) {
            return;
        }
        const ui = this.node.getComponent(UITransform);
        const visible = view.getVisibleSize();
        // 与 start() 保持同一套取值规则：节点尺寸与可见尺寸取较大者
        const w = Math.max(ui ? ui.width : 0, visible.width);
        const h = Math.max(ui ? ui.height : 0, visible.height);
        if (w <= 0 || h <= 0) {
            return;
        }
        if (Math.abs(w - this._layoutW) < 0.5 && Math.abs(h - this._layoutH) < 0.5) {
            return;
        }
        this._layoutW = w;
        this._layoutH = h;
        this._backCx = -w / 2 + 32;
        this._backCy = h / 2 - this._topInset - 50;
        node.setPosition(this._backCx, this._backCy, 0);
    }

    /**
     * 返回键命中判断。
     *
     * 主判定走引擎的 UITransform.hitTest：它用相机把屏幕坐标转世界坐标再转节点本地，
     * 与渲染使用的是同一套变换，因此「画在哪」就「点在哪」。
     *
     * 兜底用同一个本地矩形（与 contentSize 148×56 完全一致），不放宽容错，
     * 这样即使某机型 hitTest 异常也不会误触到下方的琴弦/卡片。
     */
    private _hitBack(event: EventTouch): boolean {
        this._syncBackLayout();
        const node = this._backNode;
        if (!node || !node.activeInHierarchy) {
            return false;
        }
        const transform = node.getComponent(UITransform);
        if (transform && transform.hitTest(event.getLocation(), event.windowId)) {
            return true;
        }
        const local = this._toLocal(event);
        // 与可视化胶囊 148×56 完全一致，不外扩
        return local.x >= this._backCx
            && local.x <= this._backCx + 148
            && Math.abs(local.y - this._backCy) <= 28;
    }

    // ------------------------------------------------------------------
    // 节奏模式流程
    // ------------------------------------------------------------------

    private async _startGame(): Promise<void> {
        if (this._mode !== 'ready') {
            return;
        }
        this._mode = 'loading';
        const token = ++this._loadToken;

        // 音频上下文必须在用户手势的调用栈里同步创建
        const audioReady = AudioManager.instance.init();

        try {
            await this._chartReady;
            await audioReady;
        } catch (e) {
            console.error('[GameEntry] 启动失败', e);
            // 已有更新的开局流程时不要干扰它
            if (token !== this._loadToken) {
                return;
            }
            // 音频 / 谱面不可用时退回选谱页，避免停留在无法操作的准备页
            this._mode = 'ready';
            this._enterSelect();
            return;
        }

        // 加载期间玩家可能已经点了返回（或重新进入）：
        // 过期流程不能再启动时钟 / 开局，否则主菜单会残留 BGM、状态错乱。
        if (token !== this._loadToken) {
            return;
        }
        if (this._screen !== 'rhythm' || this._mode !== 'loading') {
            AudioManager.instance.stopClock();
            return;
        }

        AudioManager.instance.restartClock();
        this._game.restart();
        this._stage.resetEffects();
        this._hud.resetOffsets();
        // 先刷新一次统计数据：否则切曲 / 重进时左上角会残留上一局的分数与连击，
        // 直到第一次判定才被覆盖。
        this._hud.updateStats(this._game.stats);
        this._game.start();
        this._hud.showPlaying();
        this._mode = 'playing';
    }

    private _restartGame(): void {
        if (this._mode !== 'finished') {
            return;
        }
        this._mode = 'loading';
        this._acceptRestart = false;

        AudioManager.instance.restartClock();
        this._game.restart();
        this._stage.resetEffects();
        this._game.start();
        this._hud.resetOffsets();
        this._hud.updateStats(this._game.stats);
        this._hud.showPlaying();
        this._mode = 'playing';
    }

    private _handleFinish(stats: GameStats): void {
        this._mode = 'finished';
        // 结算即落盘：分数更高才覆盖，返回最终最佳成绩与是否刷新纪录
        const record = saveBest(this._chartKey, stats);
        this._hud.showResult(stats, record.best, record.isNew);

        // 防止最后一次击打直接触发重开
        this._acceptRestart = false;
        this.scheduleOnce(() => {
            this._acceptRestart = true;
        }, 0.8);
    }
}
