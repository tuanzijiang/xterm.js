# xterm.js 从 Buffer 到页面 UI 的渲染链路

本文说明 `_activeBuffer` 中的数据如何最终变成页面上的终端 UI。

重点链路是：

```ts
InputHandler
  -> update _activeBuffer
  -> emit onRequestRefreshRows
  -> CoreBrowserTerminal.refresh(...)
  -> RenderService.refreshRows(...)
  -> renderer.renderRows(...)
  -> DomRendererRowFactory.createRow(...)
  -> DOM update
```

## 一句话版

`_activeBuffer` 本身不会直接变成 UI。它先被 `InputHandler` 修改，然后触发刷新事件，浏览器端收到刷新请求后交给 `RenderService`，再由 `DomRenderer` 从 buffer 里读取可视行，把每个 cell 生成对应的 DOM 节点。

## 1. InputHandler 持有并更新 `_activeBuffer`

`InputHandler` 内部缓存了当前 active buffer：

- 初始值来自 `this._bufferService.buffer`
- 当 normal/alt buffer 切换时，会跟随 `onBufferActivate` 更新

关键代码：

- `src/common/InputHandler.ts:187`
- `src/common/InputHandler.ts:188`

也就是：

```ts
this._activeBuffer = this._bufferService.buffer;
this._register(this._bufferService.buffers.onBufferActivate(
  e => this._activeBuffer = e.activeBuffer
));
```

这里的 `_activeBuffer` 指向当前真正正在显示和写入的 `Buffer`。

## 2. InputHandler 改完 buffer 后请求刷新

`InputHandler` 在处理输入、写字符、滚动、擦除、移动光标等操作时，会修改：

- `Buffer`
- `BufferLine`
- cursor state

修改完成后，它会通过 `onRequestRefreshRows` 通知浏览器层应该刷新哪些行。

浏览器侧的监听在：

- `src/browser/CoreBrowserTerminal.ts:164`

逻辑是：

```ts
this._register(this._inputHandler.onRequestRefreshRows((e) =>
  this.refresh(e?.start ?? 0, e?.end ?? (this.rows - 1))
));
```

也就是说，`InputHandler` 不直接碰 DOM，它只发“这些行脏了，需要刷新”的请求。

## 3. CoreBrowserTerminal 把刷新请求交给 RenderService

`CoreBrowserTerminal.refresh(start, end)` 非常薄，只做一层转发：

- `src/browser/CoreBrowserTerminal.ts:852`

即：

```ts
public refresh(start: number, end: number): void {
  this._renderService?.refreshRows(start, end);
}
```

这一步的职责是把“终端状态层”的刷新请求转成“浏览器渲染层”的刷新任务。

## 4. RenderService 负责调度真正的渲染

`RenderService` 不是直接每次立刻画，而是负责：

- 合并刷新范围
- debounce
- 处理 synchronized output
- 在终端不可见时暂停刷新
- 最终调用 renderer

关键代码：

- `src/browser/services/RenderService.ts:148`
- `src/browser/services/RenderService.ts:171`

核心过程：

```ts
refreshRows(start, end) {
  this._renderDebouncer.refresh(start, end, this._rowCount);
}

_renderRows(start, end) {
  this._renderer.value.renderRows(start, end);
}
```

所以 `RenderService` 更像“渲染调度器”，而不是内容读取者。

## 5. DomRenderer 从当前 buffer 里取可视行

真正开始把 buffer 数据转成 UI 的是 `DomRenderer.renderRows(start, end)`：

- `src/browser/renderer/dom/DomRenderer.ts:441`

关键逻辑：

```ts
const buffer = this._bufferService.buffer;

for (let y = start; y <= end; y++) {
  const row = y + buffer.ydisp;
  const rowElement = this._rowElements[y];
  const lineData = buffer.lines.get(row);
  rowElement.replaceChildren(
    ...this._rowFactory.createRow(...)
  );
}
```

这里有几个关键点：

1. 它读取的是 `this._bufferService.buffer`
   也就是当前 active buffer
2. 它显示的不是所有行，而是可视区域对应的行
   通过 `row = y + buffer.ydisp` 把 viewport 行号映射到 buffer 绝对行号
3. 它从 `buffer.lines.get(row)` 取到当前可见的 `BufferLine`
4. 再交给 `DomRendererRowFactory.createRow(...)`

因此屏幕上显示哪一行，取决于：

- 当前 active buffer
- 当前滚动偏移 `ydisp`

## 6. DomRendererRowFactory 把 BufferLine 变成 span 列表

`DomRendererRowFactory.createRow(...)` 会逐个 cell 读取 `BufferLine` 内容并生成 DOM 片段：

- `src/browser/renderer/dom/DomRendererRowFactory.ts:61`
- `src/browser/renderer/dom/DomRendererRowFactory.ts:100`

关键过程：

```ts
for (let x = 0; x < lineLength; x++) {
  lineData.loadCell(x, this._workCell);
  ...
}
```

也就是说：

1. `lineData` 是一个 `BufferLine`
2. `loadCell(x, this._workCell)` 会把第 `x` 列的数据解码到一个 `CellData`
3. 然后根据这个 cell 的：
   - 字符
   - 宽度
   - 前景色/背景色
   - 光标状态
   - selection 状态
   - link hover 状态
   - decoration
4. 组装出一个或多个 `span`

最后这些 `span` 被返回给 `DomRenderer`，然后：

```ts
rowElement.replaceChildren(...)
```

于是这一行对应的 DOM 就更新了。

## 7. 为什么 `_activeBuffer` 不是直接“页面对象”

因为 `_activeBuffer` 只负责保存终端内容状态，不负责浏览器渲染。

更准确地说：

- `_activeBuffer` 是“模型”
- `RenderService` 是“调度器”
- `DomRenderer` 是“视图层”
- `DomRendererRowFactory` 是“模型到 DOM 的转换器”

所以这条路径是典型的：

```ts
Buffer state
  -> dirty row request
  -> render scheduling
  -> viewport row lookup
  -> cell decoding
  -> DOM update
```

## 8. 和 viewport 的关系

注意 `Buffer` 中通常有比屏幕更多的行，因为：

- 有 scrollback
- 有历史输出

但页面只显示当前 viewport 对应的那几行。

因此：

- `buffer.lines` 是完整缓冲区
- `buffer.ydisp` 决定当前 viewport 顶部落在哪一行
- `DomRenderer.renderRows` 用 `y + ydisp` 找到真正要显示的 `BufferLine`

## 9. 实际理解方式

可以把整条链路理解成下面这样：

```ts
write data
  -> parser
  -> InputHandler 修改 Buffer / BufferLine
  -> InputHandler 发出“第 N 到 M 行脏了”
  -> CoreBrowserTerminal 调用 refresh
  -> RenderService 合并并调度渲染
  -> DomRenderer 按 ydisp 取出当前可视 BufferLine
  -> DomRendererRowFactory 把每个 cell 变成 span
  -> 浏览器页面更新
```

## 一句话总结

`_activeBuffer` 不是页面 UI 本身，它是页面 UI 的数据源；真正把它画到页面上的，是 `RenderService + DomRenderer + DomRendererRowFactory` 这一整条浏览器渲染链路。
