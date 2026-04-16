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
