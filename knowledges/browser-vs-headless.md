# xterm.js 中 `src/browser` 和 `src/headless` 的区别

本文聚焦 public `Terminal` API，说明：

- `src/browser` 和 `src/headless` 分别负责什么
- 两边都具备哪些能力
- 哪些能力只在其中一边存在

核心结论先说：

- `src/browser` 是浏览器终端实现，负责 DOM、渲染、输入事件、选择、链接等可视化交互能力
- `src/headless` 是无界面终端实现，负责终端状态、buffer、parser、输入输出等核心行为，但不负责显示和浏览器交互
- 两者都建立在共享核心 `src/common/CoreTerminal.ts` 之上

## 目录定位

关键入口：

- 浏览器 public API: `src/browser/public/Terminal.ts`
- 浏览器核心实现: `src/browser/CoreBrowserTerminal.ts`
- headless public API: `src/headless/public/Terminal.ts`
- headless 核心实现: `src/headless/Terminal.ts`
- 共享核心基类: `src/common/CoreTerminal.ts`

可以把关系理解成：

```ts
src/common/CoreTerminal.ts
  -> shared terminal core

src/browser/CoreBrowserTerminal.ts
  -> browser-specific UI and interaction layer

src/browser/public/Terminal.ts
  -> browser public facade

src/headless/Terminal.ts
  -> headless terminal core wrapper

src/headless/public/Terminal.ts
  -> headless public facade
```

## 一句话区别

如果你的问题是“要不要显示在页面上并接收浏览器交互”，判断标准很简单：

- 需要 `open(...)` 到页面、需要 `element`/`textarea`、需要选择和链接能力，用 `browser`
- 只需要维护终端状态、处理输入输出、读取 buffer，不需要 DOM，用 `headless`

## Public `Terminal` API 对比

下面的对比是基于：

- `src/browser/public/Terminal.ts`
- `src/headless/public/Terminal.ts`

### 两者都有的能力

| 类别 | Browser | Headless | 说明 |
| --- | --- | --- | --- |
| 基本属性 | `rows` `cols` `options` | `rows` `cols` `options` | 终端尺寸和配置 |
| 基本事件 | `onBell` `onBinary` `onCursorMove` `onData` `onLineFeed` `onResize` `onScroll` `onTitleChange` `onWriteParsed` | `onBell` `onBinary` `onCursorMove` `onData` `onLineFeed` `onResize` `onScroll` `onTitleChange` `onWriteParsed` | 核心终端事件 |
| 公共子 API | `parser` `unicode` `buffer` `markers` `modes` | `parser` `unicode` `buffer` `markers` `modes` | 都能访问 parser、unicode、buffer 等 facade |
| 输入输出 | `input()` `write()` `writeln()` | `input()` `write()` `writeln()` | 都能送入数据和写入终端 |
| 尺寸和滚动 | `resize()` `scrollLines()` `scrollPages()` `scrollToTop()` `scrollToBottom()` `scrollToLine()` | `resize()` `scrollLines()` `scrollPages()` `scrollToTop()` `scrollToBottom()` `scrollToLine()` | 这些都属于终端核心行为 |
| 状态控制 | `clear()` `reset()` `dispose()` | `clear()` `reset()` `dispose()` | 两边都支持 |
| 标记和扩展 | `registerMarker()` `loadAddon()` | `registerMarker()` `addMarker()` `loadAddon()` | 都支持 marker/addon，headless 额外保留了 `addMarker()` 别名 |

### `browser` 有、`headless` 没有的能力

| Browser 独有 API | 用途 | 为什么 headless 没有 |
| --- | --- | --- |
| `element` | 获取终端根 DOM 节点 | headless 不创建 DOM |
| `textarea` | 获取用于输入的文本框节点 | headless 不接浏览器输入控件 |
| `onKey` | 监听键盘事件和原始 `KeyboardEvent` | headless 不处理浏览器键盘事件 |
| `onRender` | 监听渲染区间变化 | headless 不做 UI 渲染 |
| `onSelectionChange` | 监听选择变化 | headless 没有浏览器选择层 |
| `blur()` `focus()` | 控制浏览器焦点 | headless 无焦点概念 |
| `open(parent)` | 挂载到页面 DOM | headless 不显示到页面 |
| `attachCustomKeyEventHandler()` | 自定义键盘事件拦截 | headless 没有 DOM 键盘事件流 |
| `attachCustomWheelEventHandler()` | 自定义滚轮事件拦截 | headless 没有 DOM 滚轮事件流 |
| `registerLinkProvider()` | 链接探测和交互 | headless 没有鼠标 hover/click 链接交互 |
| `registerCharacterJoiner()` | 自定义字符连接显示 | 这是 renderer 相关能力 |
| `deregisterCharacterJoiner()` | 注销字符连接器 | 同上 |
| `registerDecoration()` | 注册装饰并参与渲染 | decoration 依赖可视化渲染层 |
| `hasSelection()` | 查询是否有选区 | headless 没有选区模型 |
| `select()` | 选择指定范围 | 同上 |
| `getSelection()` | 读取选中文本 | 同上 |
| `getSelectionPosition()` | 读取选区位置 | 同上 |
| `clearSelection()` | 清空选区 | 同上 |
| `selectAll()` | 全选 | 同上 |
| `selectLines()` | 选择多行 | 同上 |
| `paste()` | 浏览器粘贴流程 | headless 不处理剪贴板/UI 输入 |
| `refresh()` | 主动刷新渲染行 | headless 没有 renderer |
| `clearTextureAtlas()` | 清理纹理图集 | 纯浏览器渲染能力 |
| `Terminal.strings` | 本地化字符串包装 | 面向浏览器 public 包导出 |

这些能力基本都可以归类为四组：

- DOM 相关：`element` `textarea` `open()`
- 浏览器输入事件相关：`onKey` `focus()` `blur()` `attachCustomKeyEventHandler()`
- 渲染相关：`onRender` `refresh()` `clearTextureAtlas()` `registerCharacterJoiner()`
- 交互层相关：selection、link provider、paste、decoration

### `headless` 有、`browser` 没有的能力

| Headless 独有 API | 用途 | 备注 |
| --- | --- | --- |
| `addMarker()` | 给 marker 注册提供别名 | `browser` 侧只保留 `registerMarker()`，headless 同时提供 `addMarker()` |

严格说，headless public API 相比 browser 并不是“多了一大批独有能力”，而是“去掉了浏览器层能力，只留下核心终端能力”，外加一个 `addMarker()` 兼容入口。

## 为什么会这样

从实现依赖上看，`src/browser` 明显绑定浏览器环境：

- 使用 `HTMLElement`、`HTMLTextAreaElement`、`Document`
- 依赖 renderer、viewport、selection、clipboard、mouse、theme 等 browser service

而 `src/headless` 不引入这些 DOM/渲染层能力，而是直接基于 `CoreTerminal` 提供：

- buffer 状态维护
- 输入数据处理
- 终端模式和 marker 管理
- 事件抛出

因此：

- `browser` = shared core + browser UI layer
- `headless` = shared core + no-UI wrapper

## 适用场景

| 场景 | 更适合的实现 | 原因 |
| --- | --- | --- |
| 浏览器页面里显示终端 | `src/browser` | 需要 DOM、输入、渲染、选区、链接 |
| Node.js 里维护远端终端状态 | `src/headless` | 不需要页面显示，只要终端状态机 |
| 服务端预处理终端输出后再同步给前端 | `src/headless` + `src/browser` | 后端维护状态，前端负责展示 |

## 最后总结

最重要的不是把这两个目录看成“两套完全不同的终端”，而是看成：

- 一套共享的终端核心在 `src/common`
- `src/browser` 给这套核心接上浏览器 UI 和交互
- `src/headless` 给这套核心提供无界面运行方式

如果你后面要判断“某个新 API 该放 browser、headless，还是 common”，一个实用标准是：

- 只和终端状态机/解析/buffer 有关，优先考虑 `common`
- 只和 DOM、渲染、选择、链接、焦点、剪贴板有关，放 `browser`
- 如果是对外 headless 包也要支持的 public API，要同步看 `typings/xterm-headless.d.ts` 和 `src/headless/public/Terminal.ts`
