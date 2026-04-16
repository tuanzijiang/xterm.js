# xterm.js Buffer 相关对象说明

本文说明以下几个核心概念：

- `Buffer`
- `BufferRange`
- `BufferLine`
- `BufferReflow`
- `BufferSet`
- `CellData`

## 总览

可以先把它们分成三类：

1. 终端内容本体
2. 内容里的最小单元
3. 围绕内容做切换、重排、定位的辅助对象

最核心的关系链路是：

```ts
BufferSet
  -> normal: Buffer
  -> alt: Buffer
  -> active: Buffer

Buffer
  -> lines: CircularList<BufferLine>

BufferLine
  -> internal typed-array cell storage
  -> logical cells
```

其中：

- `BufferSet` 管理 normal/alt 两个 buffer
- `Buffer` 表示一个完整终端缓冲区
- `BufferLine` 表示 buffer 中的一行
- `CellData` 表示一个 cell 的读写视图
- `BufferRange` 表示 buffer 中一段坐标范围
- `BufferReflow` 是 resize 时对 buffer line 做重排的算法模块

## Buffer

`Buffer` 是一个终端屏幕缓冲区的完整状态对象。它不只是文本内容，还包含光标、滚动和 tab stop 等状态。

主要内容包括：

- `lines`
- `x / y`
- `ydisp / ybase`
- `scrollTop / scrollBottom`
- `tabs`
- `markers`
- 保存的 cursor/charset/attr 状态

定义位置：

- `src/common/buffer/Buffer.ts`
- `src/common/buffer/Types.ts`

最关键的字段是：

```ts
Buffer
  -> lines: CircularList<IBufferLine>
```

运行时这里面的 `IBufferLine` 通常就是 `BufferLine` 实例。

## BufferLine

`BufferLine` 表示 `Buffer` 里的一行。它不是 JS 字符串，而是一行 terminal cell 的结构化数据。

主要成员包括：

- `_data: Uint32Array`
- `_combined`
- `_extendedAttrs`
- `isWrapped`

定义位置：

- `src/common/buffer/BufferLine.ts`

这里有两个关键点：

1. `BufferLine` 是 `Buffer.lines` 里的元素
2. `BufferLine` 内部不是直接用 `CellData[]` 存储，而是使用压缩后的 typed array 存储

因此更准确的理解是：

```ts
Buffer
  -> many BufferLine
```

### `BufferLine.isWrapped` 是什么

`isWrapped` 表示“当前这一行是不是上一行因为自动换行接出来的 continuation line”。

它的语义要点是：

- `true`：当前行不是独立起始行，而是前一行 soft wrap 之后续出来的
- `false`：当前行是一个新的逻辑起点

注意它描述的是“当前行和上一行的连接关系”，不是“当前行未来会不会继续换到下一行”。

例如终端宽度是 5，写入 `hello world`：

```text
row0: hello   isWrapped = false
row1:  worl   isWrapped = true
row2: d       isWrapped = true
```

如果程序输出的是显式换行 `\n`，那么新进入的那一行应当是：

```text
isWrapped = false
```

因为它不是上一行溢出后自动续出来的。

## `isWrapped` 的作用链路

`isWrapped` 的完整链路可以按“谁设置它、谁依赖它”来理解。

### 1. 产生：输入写入触发自动换行

当 `InputHandler` 写入字符时，如果字符放不下当前行且开启了 wraparound mode，就会移动到下一行，并把“新行”标记成 wrapped：

- `src/common/InputHandler.ts:578`

也就是：

```ts
this._activeBuffer.lines.get(...)!.isWrapped = true;
```

这里的含义是：

- 旧行是逻辑段的起点
- 新行是从旧行自动接出来的续行

如果因为滚动产生新 blank line，`BufferService.scroll` 也会把这个 blank line 带上 `isWrapped` 标记：

- `src/common/services/BufferService.ts:64`

因此“自动换行进入新行”这条路径，无论有没有触发 scroll，都会尽量保留 wrapped 关系。

### 2. 清除：显式换行、编辑和光标修正会打断 wrapped 关系

如果进入下一行不是因为自动换行，而是显式 `LF`，则新行会被标记成非 wrapped：

- `src/common/InputHandler.ts:732`

这是因为显式换行意味着一个新的逻辑行开始了，不应该再和上一行拼接。

类似地，一些会重写当前行结构的操作也会把 `isWrapped` 清掉，例如：

- reverse wrap-around 回退时取消当前行 wrapped 状态
- 某些 erase/insert/delete/重排修正逻辑中把 line 重新视为独立行

这些调用点在 `InputHandler.ts` 里很多，核心思想一致：

- 一旦上一行和当前行不再应被视为同一个软换行段，就把 `isWrapped` 置回 `false`

### 3. 特殊来源：Windows 模式下的启发式修复

在 Windows 某些后端里，底层数据流不会正确告诉 xterm.js 哪些行是自动换行出来的。

这时 `WindowsMode.ts` 会在每次 line feed 后，基于“前一行最后一个字符是否为空白”去猜测下一行是不是 wrapped：

- `src/common/WindowsMode.ts:8`

所以在 windows 兼容模式下，`isWrapped` 有一部分是启发式推断值，不一定完全来自原始输入语义。

### 4. 消费：把多行视为同一个逻辑行

`Buffer.getWrappedRangeForLine` 会向上、向下扫描连续的 `isWrapped` 行，求出某一行所属的整段 wrapped range：

- `src/common/buffer/Buffer.ts:698`

逻辑是：

```ts
while (first > 0 && lines[first].isWrapped) first--;
while (last + 1 < lines.length && lines[last + 1].isWrapped) last++;
```

这个能力的含义是：

- buffer 物理上存的是多行
- 但逻辑上可以把连续 wrapped 的几行看成一个段落

### 5. 消费：Selection 会据此拼接文本

复制/选择文本时，`SelectionService` 不会把 wrapped line 当作真正的换行。

它会在遍历选区时检查：

- 如果当前 `bufferLine.isWrapped === true`
- 就把这行文本直接拼接到前一行结果后面

代码位置：

- `src/browser/services/SelectionService.ts:224`

这就是为什么从终端复制一段自动换行的长命令时，通常不会在中间多出人为换行符。

双击/三击整行选择时，也会先通过 `getWrappedRangeForLine` 找到整段 wrapped range：

- `src/browser/services/SelectionService.ts:1030`

所以：

- `isWrapped` 直接影响“用户看到的一整行”如何定义
- 也直接影响复制出来的纯文本长什么样

### 6. 消费：resize reflow 依赖它识别可重排的 wrapped block

terminal 列数变化时，`BufferReflow` 需要知道哪些物理行原本属于同一个 wrapped block。

它的判断方式很直接：

- 看后续行的 `isWrapped`
- 把连续 wrapped 的多行收集成 `wrappedLines`

代码位置：

- `src/common/buffer/BufferReflow.ts:34`

这使得：

- 列数变大时，多行可以重新并回更少的行
- 列数变小时，一行也可以重新拆成更多行

如果没有 `isWrapped`，reflow 就无法区分：

- 真正的逻辑换行
- 只是显示宽度导致的自动折行

### 7. 对外暴露：Buffer API 也能看到它

浏览器侧的 `BufferLineApiView` 直接把 `isWrapped` 暴露给外部 API：

- `src/common/public/BufferLineApiView.ts:13`

因此插件或上层调用方如果通过 buffer API 读行，也能判断：

- 这是不是一个独立行
- 还是前一行的延续

## 一句话总结

`isWrapped` 是 xterm.js 里“物理行”和“逻辑行”之间最关键的连接标记之一。

它的职责不是保存字符内容，而是保存行与行之间的结构关系：

- 输入阶段决定它
- 编辑和换行操作会修正它
- 选择复制依赖它决定是否拼接文本
- reflow 依赖它决定哪些行可以一起重排
- 对外 API 也会把它暴露出去

可以把它理解成：

```ts
BufferLine.isWrapped
  = this row belongs to the previous logical wrapped line
```

## CellData

`CellData` 表示一个 terminal cell 的数据模型，也就是“一格”。

它包含：

- `content`
- `fg`
- `bg`
- `extended`
- `combinedData`

定义位置：

- `src/common/buffer/CellData.ts`

`CellData` 通常不是 `BufferLine` 的长期底层存储结构。`BufferLine` 真正长期存储的是：

- `_data`
- `_combined`
- `_extendedAttrs`

`CellData` 更像是：

- 读取某个 cell 时使用的对象
- 写入某个 cell 时使用的对象
- 一个解码后的单格视图

例如：

```ts
line.loadCell(x, cell)
```

表示从 `BufferLine` 的压缩存储中，把第 `x` 列加载到一个 `CellData` 对象里。

因此关系更准确地说是：

```ts
BufferLine
  -> logical cells
  -> load/store through CellData
```

而不是：

```ts
BufferLine
  -> CellData[]
```

## BufferSet

`BufferSet` 是 normal buffer 和 alt buffer 的管理器。

xterm 里通常会同时维护两个 buffer：

- normal buffer
- alt buffer

`BufferSet` 管理以下对象：

- `_normal`
- `_alt`
- `_activeBuffer`

定义位置：

- `src/common/buffer/BufferSet.ts`

结构是：

```ts
BufferSet
  -> normal: Buffer
  -> alt: Buffer
  -> active: Buffer
```

因此：

- 当前屏幕显示对应的是 `active Buffer`
- 你看到的 `_activeBuffer` 就是 `BufferSet` 当前选中的 `Buffer`

## BufferRange

`BufferRange` 不是 buffer 本体，而是一个坐标范围对象。

它用于表达 buffer 里的某一段范围，例如：

- selection range
- link range
- 其他基于 buffer 坐标的区域

定义位置：

- `src/browser/Types.ts`
- `src/common/buffer/BufferRange.ts`

结构很简单：

```ts
interface IBufferRange {
  start: { x: number, y: number };
  end: { x: number, y: number };
}
```

所以它和 `Buffer`、`BufferLine` 的关系不是嵌套，而是“引用 buffer 坐标的值对象”。

## BufferReflow

`BufferReflow` 不是一个长期存在的对象，而是一组在 resize 时使用的重排算法函数。

定义位置：

- `src/common/buffer/BufferReflow.ts`

它主要处理列数变化时，wrapped lines 的重排问题：

- 列变大时，原来换行包裹出的多行可能重新合并
- 列变小时，原来的一行可能拆成更多 wrapped lines

它操作的对象主要包括：

- `CircularList<IBufferLine>`
- `BufferLine[]`
- `ICellData`

所以它和前面几者的关系不是“嵌套”，而是“算法作用于这些结构”。

## 谁嵌套谁

核心嵌套关系如下：

```ts
BufferSet
  -> Buffer (normal)
  -> Buffer (alt)
  -> active Buffer

Buffer
  -> lines: CircularList<BufferLine>

BufferLine
  -> compressed cell storage
```

`CellData`：

- 不是 `BufferLine` 主存储的一部分
- 是单个 cell 的读写视图

`BufferRange`：

- 不嵌套实际内容
- 只描述 `(x, y) -> (x, y)` 的范围

`BufferReflow`：

- 不被嵌套
- 是操作 `Buffer` / `BufferLine` 的算法模块

## 一句话版

- `BufferSet` 管两个 `Buffer`
- `Buffer` 管很多 `BufferLine`
- `BufferLine` 表示一行，并压缩存储很多 cell
- `CellData` 表示一个 cell 的读写视图
- `BufferRange` 表示 buffer 上的一段坐标范围
- `BufferReflow` 负责 resize 时的 line/cell 重排
