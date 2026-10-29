# 五音 · 五轨

基于 **Cocos Creator 3.8 + TypeScript** 的微信小游戏「宫商角徵羽」：五轨下落音游 + 自由弹奏。

- 主界面三入口：**节奏模式** / **自由弹奏** / **宣传内容**
- 五条固定垂直轨道对应宫、商、角、徵、羽（简谱 1 2 3 5 6），底部判定线
- 内置 12 首琴谱：3 首程序谱 + 9 首五声民歌古曲，支持分页与难度筛选
- **按下轨道即演奏该音符原本的音高**：谱面带 MIDI，Web Audio 实时合成八音盒 / 古筝音色
- 五声轨道装不下的半音（4 / 7）以 auto 音符自动发声，不下落、不判定
- 同轨不同八度在方块亮度 / 描边上区分（高音提亮、低音压暗）
- 自由弹奏：五根可拨动的琴弦，弦会弯、会响、会有光点与波纹
- 唯一时间源：`wx.createWebAudioContext()` 的音频时钟
- 音符节点对象池复用，判定窗口 ±40 / ±80 / ±120 ms
- 全局偏移校准参数硬编码在 `GameConfig.globalOffsetMs`，方便真机调试手感

---

## 一、目录结构

```
new_think/                          ← 项目根目录（用 Cocos Dashboard 导入这一层）
├── assets/
│   ├── main.scene                  ← 唯一场景：Canvas + Camera + GameRoot(GameEntry)
│   ├── main.scene.meta
│   ├── scripts/
│   │   ├── GameEntry.ts            ← 入口：拼装模块、输入分发、开始/结算/重开流程
│   │   ├── core/
│   │   │   ├── GameConfig.ts       ← 所有可调参数（判定窗口、下落速度、全局偏移…）
│   │   │   ├── ChartTypes.ts       ← 谱面数据结构定义（time / lane / type）
│   │   │   ├── ChartStore.ts       ← 谱面 JSON 加载、校验、内置兜底谱面
│   │   │   ├── AudioManager.ts     ← 微信 WebAudio 封装：时钟 / 合成打击音 / BGM
│   │   │   ├── NotePool.ts         ← 音符视图 + 按轨道分组的对象池
│   │   │   └── GameMain.ts         ← 主循环：生成、位置、判定、计分、结算
│   │   └── ui/
│   │       ├── Theme.ts            ← 五色 / 字体 / 颜色工具
│   │       ├── Backdrop.ts         ← 全局深色网格背景（所有页面共用）
│   │       ├── MainMenu.ts         ← 主界面三卡片（节奏 / 自由弹奏 / 宣传）
│   │       ├── SceneBuilder.ts     ← 五轨、判定线、键位、打击光效
│   │       ├── FreePlay.ts         ← 自由弹奏：五根琴弦 + 拨弦振动
│   │       ├── PromoPage.ts        ← 宣传内容页（五声音阶科普）
│   │       └── HUD.ts              ← 分数 / 连击 / 判定文字 / 结算遮罩
│   └── resources/
│       ├── charts/
│       │   └── demo.json           ← 示例谱面（96 个 Tap，约 34 秒，五轨）
│       └── audio/
│           ├── bgm-readme.txt      ← BGM 放置说明（把 bgm.mp3 放这里，可选）
│           └── tones/              ← 五音钢琴采样（C4 / F#4 / A4，各 14KB）
├── settings/v2/packages/
│   └── project.json                ← 设计分辨率 720×1280，fitWidth
├── package.json                    ← Cocos 项目描述（Creator 3.8.6）
├── tsconfig.json
├── promo-material.html             ← 宣传物料（海报 + 文案，浏览器直接打开）
└── README.md
```

> `library/`、`temp/`、`build/` 等目录由 Cocos Creator 首次打开时自动生成，已被 `.gitignore` 忽略。

---

## 二、在编辑器里跑起来

1. 打开 **Cocos Dashboard → 项目 → 导入**，选择本目录（含 `package.json` 的那一层）。
2. 使用 **Cocos Creator 3.8.x**（项目标注 3.8.6，3.8 系列均可打开）打开项目。
3. 首次打开会导入资源并生成 `library/`、`temp/`，等待完成。
4. 双击 `assets/main.scene`，点击编辑器顶部的 **预览（Play）**。
5. 主界面有三个入口：
   - **节奏模式**：五轨下落玩法，桌面端键盘 `D F G J K` 对应宫商角徵羽
   - **自由弹奏**：点击或滑过五根琴弦，即刻发声
   - **宣传内容**：五声音阶科普页
6. 任意子页面左下角有「‹ 返回」，可回到主界面。

> 场景只挂了 `GameEntry` 一个脚本，所有节点（轨道、判定线、HUD）都在运行时用代码创建，因此不需要手工搭 UI。

---

## 三、构建发布为微信小游戏

1. 菜单 **项目 → 构建发布**。
2. 平台选择 **微信小游戏**。
3. 关键配置：
   - **AppID**：填自己的小游戏 AppID；没有就点「测试号」自动填入
   - **初始场景 / 启动场景**：`main`
   - **设备方向**：`portrait`（竖屏）
   - **渲染模式**：WebGL（默认）
   - **Debug**：**务必取消勾选**。debug 模式会输出未压缩引擎（本项目实测 8.34MB），
     超过微信小游戏主包 4MB 限制，预览会报 `source size exceed max limit 4MB`
   - **引擎原生代码(wasm/asmjs)分包**：**建议勾选**（本项目实测主包 3.72MB、总包 4.44MB）
4. 点击 **构建**，产物在 `build/wechatgame`。
   若该目录已存在，Cocos 会自动递增为 `wechatgame-001`、`wechatgame-002`…
   **导入时记得选最新生成的那个目录**。
5. 用 **微信开发者工具 →「小游戏」标签 → 导入项目**（不要选「小程序」），目录选构建产物。

> 微信小游戏的 `game.json`、分包、首屏加载等均由 Cocos 构建流程生成，无需手改。
> 构建产物里 `game.json` 会写入 `subpackages`（`__ccWasmAssetSubpkg__` / `__ccWasmChunkSubpkg__`），
> 主包因此能控制在 4MB 以内。
>
> 若仍超过 4MB，按顺序尝试：
> 1. **项目设置 → 功能裁剪**：关闭物理（physics-ammo）、Spine、粒子、地形、3D 动画等
>    （本项目只用到 UI、Graphics、Label、Audio）
> 2. 构建面板勾选 **启用微信引擎插件（分离引擎）**，把引擎放到微信引擎插件，主包只留业务代码
> 3. 开启 **md5Cache** 与资源压缩
>
> 顶部 UI 已自动读取微信胶囊按钮位置（`wx.getMenuButtonBoundingClientRect`）做了安全区适配，
> 换机型不会遮挡 COMBO / 偏差面板。

---

## 四、Android 真机预览与调试

1. 微信开发者工具打开 `build/wechatgame`，点击右上角 **预览**，用 Android 手机微信扫码。
   - 若需要看日志：使用 **真机调试**（不是「预览」），手机端会弹出调试面板。
2. 确认手机微信基础库 **≥ 2.19.0**（`wx.createWebAudioContext` 自 2.19.0 起提供）。
3. 真机检查清单：
   - 点击开始后是否立刻有打击音（说明用户手势内成功创建了 AudioContext）
   - 音符是否匀速下落、无跳帧
   - 连续快速点击四条轨道，判定文字与光效是否跟手
   - 切后台再回来，音符是否继续按音频时间下落（音频时钟暂停/恢复）
4. 若真机没有声音：检查手机是否静音、微信是否被系统限制媒体音量；iOS 还需注意静音键。

### 手感一致性 / 延迟稳定性验证方法

- 游戏内每次判定都会在判定线上方显示本次偏差，例如 `+18 ms`（打晚）/ `-23 ms`（打早）。
- 真机上连续打同一段 8 分音符 30 秒，观察偏差是否稳定在某个区间：
  - 偏差围绕 0 抖动 → 判定稳定，仅需微调全局偏移
  - 偏差整体偏正（总是 `+40 ms` 左右） → 输出延迟较大，按第六节调 `globalOffsetMs`
  - 偏差忽大忽小 → 优先怀疑蓝牙耳机或系统省电策略，换有线耳机复测

---

## 五、音频模块说明（AudioManager）

| 能力 | 实现 |
| --- | --- |
| 上下文 | 微信下 `wx.createWebAudioContext()`，浏览器预览自动回退 `AudioContext` |
| 击打音（节奏模式） | 按下轨道时读取谱面 `midi`，按 `freq = 440 × 2^((midi-69)/12)` 实时合成；自定义周期波（基频 + 递减泛音）+ 4ms 起音、1.1s 衰减，接近八音盒 / 古筝 |
| 拨弦音（自由弹奏） | 优先 Salamander Grand Piano 采样（C4 / F#4 / A4 变调，最多跨 3 个半音）；加载失败回退程序化拨弦缓冲 |
| 半音自动音 | 谱面标记 `auto` 的音符到点自动发声（音量系数 0.7），不生成方块、不参与判定 |
| 播放 | 每次 `createBufferSource()` → `connect` → `start(0)`，在 **`onended` 回调中 `disconnect()`** 释放 source 与 gain，避免音频图节点泄漏 |
| BGM | 短 MP3 预加载 → `decodeAudioData` → `AudioBufferSourceNode(loop=true)` 循环播放（"短音频流式"方案，规避长音频体积） |
| 无 BGM 降级 | 用一个 0 振幅振荡器保活音频时钟，游戏照常可玩 |
| 时间源 | `getAudioTimeMs()` 返回 `(ctx.currentTime - clockOrigin) * 1000`，全程不使用 `Date.now()` |

### BGM 素材从哪来

1. 打开 [Pixabay Music](https://pixabay.com/music/)（免费、可商用、无需署名）。
2. 搜索 `loop`、`calm`、`piano` 等关键词，挑一首 **8~20 秒**、可无缝循环的曲子。
3. 下载 mp3，重命名为 `bgm.mp3`，放到 `assets/resources/audio/bgm.mp3`。
4. 回编辑器等待导入，重新运行即可听到 BGM（代码路径：`GameConfig.bgmPath = 'audio/bgm'`）。

> 建议文件 < 300KB，控制小游戏主包体积。

---

## 六、手感校准（全局偏移）

参数位置：`assets/scripts/core/GameConfig.ts`

```ts
globalOffsetMs: 0,   // 硬编码占位，真机调试时直接改这个值
```

判定使用的实际时间是：

```
judgeTime = getAudioTimeMs() - globalOffsetMs
```

| 现象 | 调整 |
| --- | --- |
| 玩家总觉得「打早了」才判 PERFECT（音符还没到线就命中） | 调大（如 `+30`） |
| 玩家总觉得「打晚了」才判 PERFECT（音符已过线） | 调小（如 `-30`） |

**怎么读偏差**：每次命中时，判定文字正下方会显示本次偏差（`+18 ms` / `-23 ms`），
同时 HUD **右上角**常驻一行 `LAST +18ms   AVG +12ms`：

- `LAST`：最近一次的偏差
- `AVG`：最近 20 次命中的平均值（校准主要看这个）

**校准流程**：真机 + 实际使用的耳机 → 连打 3 局 → 读右上角 `AVG` 的稳定值
（例如 `+25ms`）→ 把 `globalOffsetMs` 设为该值 → 重新构建真机复测。

> 蓝牙耳机通常有 100ms 以上的额外延迟，这类延迟必须靠偏移补偿，不能靠判定窗口放宽。

---

## 七、谱面格式

`assets/resources/charts/demo.json`：

```json
{
  "name": "五音 · 五轨",
  "bpm": 120,
  "offset": 0,
  "notes": [
    { "time": 2000, "lane": 0, "type": "Tap" },
    { "time": 2250, "lane": 4, "type": "Tap" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `time` | 毫秒时间戳，相对 BGM 第 0 帧（不是系统时间） |
| `lane` | 轨道编号 0~4，从左到右对应宫商角徵羽 |
| `type` | 目前仅支持 `"Tap"`，其它类型会被过滤 |
| `offset` | 整谱偏移（毫秒），正数表示整体延后 |

加载逻辑在 `ChartStore.ts`：校验 `time/lane/type` → 过滤非法项 → 按时间排序；资源缺失时自动使用内置兜底谱面。

---

## 八、核心参数速查（GameConfig.ts）

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `laneCount` | 5 | 轨道数量（宫商角徵羽） |
| `judgeLineFromBottom` | 250 | 判定线距屏幕底部像素 |
| `fallSpeed` | 0.62 | 下落速度（像素/毫秒，约 620 px/s） |
| `windows.perfect` | 40 | PERFECT 窗口 ±ms |
| `windows.great` | 80 | GREAT 窗口 ±ms |
| `windows.good` | 120 | GOOD 窗口 ±ms（超出即 MISS） |
| `globalOffsetMs` | 0 | 全局判定偏移（手感校准） |
| `leadInMs` | 2000 | 首音符前的前奏（含在谱面时间轴内） |

音符位置严格按需求公式计算：

```
y = judgeY + (note.time - currentAudioTime) * fallSpeed
```

---

## 九、模块边界

| 模块 | 依赖 | 职责 |
| --- | --- | --- |
| `GameEntry` | 全部 | 页面路由、输入分发、节奏模式流程 |
| `MainMenu` | `Theme` | 主界面三卡片与命中测试 |
| `FreePlay` | `AudioManager` | 五根琴弦、拨弦振动与视觉反馈 |
| `PromoPage` | `Theme` | 宣传内容排版 |
| `Backdrop` | `Theme` | 全局深色网格背景 |
| `AudioManager` | 无（仅 cc 资源系统） | 音频时钟、合成音效、BGM |
| `GameMain` | `AudioManager` 时钟、`NotePool` | 唯一时间源驱动的判定与计分 |
| `NotePool` / `NoteView` | cc 渲染 | 音符对象池与表现 |
| `SceneBuilder` | `GameConfig` / `Theme` | 五轨场景与打击光效 |
| `HUD` | `GameMain` 的数据结构 | 纯展示，不含玩法逻辑 |
| `ChartStore` | cc 资源系统 | 谱面加载与校验 |

---

## 十、已知限制

- 仅实现 Tap；Slide / Hold 等需要在 `ChartTypes` 与 `GameMain` 中扩展状态机。
- 判定发生在主线程帧回调里，帧率波动时最多引入 1 帧（约 16.7ms）误差，可用 `globalOffsetMs` 吸收；如需更精细，可在触摸回调里直接判定并缓存结果。
- 微信小游戏切后台会挂起音频时钟，返回后时间是连续的，不会出现音符瞬移。
- BGM 为单曲循环方案，长曲需要改为按小节调度或远程 CDN 加载。

---

## 十一、项目文档

| 文档 | 说明 |
| --- | --- |
| [需求说明](docs/01-需求说明.md) | 功能 / 非功能需求与验收标准 |
| [设计文档](docs/02-设计文档.md) | 架构、数据模型、判定算法、音频方案 |
| [测试报告](docs/03-测试报告.md) | 40 项单元测试与模拟器冒烟结果 |
| [部署手册](docs/04-部署手册.md) | 构建、预览、发布、排障与回滚 |
| [交付清单](docs/05-交付清单.md) | 产出物清单与需求对照 |
| [收尾报告](docs/06-收尾报告.md) | 全周期总结与结项结论 |

---

## 十二、本地校验

```bash
# 类型检查（使用 Cocos 自带 tsc）
node "<Cocos>/resources/app.asar.unpacked/node_modules/typescript/bin/tsc" --noEmit -p tsconfig.json

# 单元测试（40 项）
cd tools/tests
node "<同上>/tsc" -p tsconfig.json
node test.js
```
