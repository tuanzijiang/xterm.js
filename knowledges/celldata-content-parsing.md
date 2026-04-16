# CellData.content 解析

## 概览

`CellData.content` 不是字符串本身，而是一个压缩后的 `number`。它把一个 cell 的字符内容状态编码到不同 bit 位里，真实字符串只在某些场景下额外存放。

相关定义在 `src/common/buffer/Constants.ts` 的 `Content` 枚举中，相关解析逻辑在 `src/common/buffer/CellData.ts`。

## 位布局

`content` 的位定义如下：

- `bit 0..20`：Unicode codepoint
- `bit 21`：是否为 combined（组合字符）
- `bit 22..23`：字符宽度 `wcwidth`

对应常量：

```ts
CODEPOINT_MASK = 0x1FFFFF
IS_COMBINED_MASK = 0x200000
HAS_CONTENT_MASK = 0x3FFFFF
WIDTH_MASK = 0xC00000
WIDTH_SHIFT = 22
```

可以理解成：

```text
23      22 21                0
+---------+--+----------------+
|  width  |C |   codepoint    |
+---------+--+----------------+
```

- `width` 占 2 bit
- `C` 是 combined 标记
- `codepoint` 最多占 21 bit，足够覆盖 UTF-32 最大值 `0x10FFFF`

## 解析方式

`CellData.ts` 中对 `content` 的解析非常直接。

### 1. 是否为组合字符

```ts
isCombined = content & Content.IS_COMBINED_MASK
```

如果结果非 0，说明这个 cell 里存的是组合字符，真实字符串在 `combinedData` 里。

### 2. 解析宽度

```ts
width = content >> Content.WIDTH_SHIFT
```

由于宽度在高位，并且当前实现里 `width` 是 `content` 的最高有效字段，因此可以直接右移 22 位。

### 3. 解析字符内容

普通字符：

```ts
codepoint = content & Content.CODEPOINT_MASK
chars = stringFromCodePoint(codepoint)
```

组合字符：

```ts
chars = combinedData
```

对应 `CellData.getChars()` 的逻辑：

```ts
if (this.content & Content.IS_COMBINED_MASK) {
  return this.combinedData;
}
if (this.content & Content.CODEPOINT_MASK) {
  return stringFromCodePoint(this.content & Content.CODEPOINT_MASK);
}
return '';
```

### 4. 解析 code

普通字符时：

```ts
code = content & Content.CODEPOINT_MASK
```

组合字符时：

```ts
code = combinedData.charCodeAt(combinedData.length - 1)
```

这里的行为是为了和旧的 `CharData` 表示保持一致。组合字符没有单一 codepoint，因此返回最后一个字符的 code。

## 写入方式

### 普通单字符

普通字符直接把 codepoint 和 width 编到一个整数里：

```ts
content = codepoint | (width << Content.WIDTH_SHIFT)
```

### surrogate pair

如果输入是 JS 的 surrogate pair，例如某些 emoji，`CellData.setFromCharData()` 会先把 UTF-16 的高低代理项合成为一个 UTF-32 codepoint，再写入：

```ts
content = utf32Codepoint | (width << Content.WIDTH_SHIFT)
```

### 组合字符

如果是多个 codepoint 组合成一个显示单元，例如 `e + ◌́`：

```ts
combinedData = 原始字符串
content = Content.IS_COMBINED_MASK | (width << Content.WIDTH_SHIFT)
```

这时 `content` 不再保存真实字符的 codepoint，只保存：

- 这是 combined
- 它的宽度是多少

真实字符序列放在 `combinedData`。

## 具体例子

### 1. ASCII 字符 `A`

- codepoint: `65`
- width: `1`

计算：

```ts
content = 65 | (1 << 22)
        = 65 | 4194304
        = 4194369
```

解析：

```ts
content & 0x1FFFFF = 65
content & 0x200000 = 0
content >> 22 = 1
```

还原后得到：

- 字符：`A`
- 宽度：`1`
- 非组合字符

### 2. 中文字符 `你`

- codepoint: `20320`（`0x4F60`）
- width: `2`

计算：

```ts
content = 20320 | (2 << 22)
        = 20320 | 8388608
        = 8408928
```

解析：

```ts
content & 0x1FFFFF = 20320
content >> 22 = 2
```

还原后得到：

- 字符：`你`
- 宽度：`2`

### 3. emoji `😀`

这个字符在 JS 中通常是两个 UTF-16 code unit，但 xterm.js 会在写入时先合成为单个 UTF-32 codepoint。

- codepoint: `0x1F600 = 128512`
- width: `2`

计算：

```ts
content = 128512 | (2 << 22)
        = 128512 | 8388608
        = 8517120
```

解析：

```ts
content & 0x1FFFFF = 128512
content >> 22 = 2
```

还原后得到：

- 字符：`😀`
- 宽度：`2`

### 4. 组合字符 `é`

这里的字符实际上由两个 codepoint 组成：

- `e`
- 组合重音 `◌́`

假设 width 为 `1`：

```ts
content = (1 << 21) | (1 << 22)
        = 2097152 | 4194304
        = 6291456
combinedData = "é"
```

解析：

```ts
content & 0x200000 !== 0
content >> 22 = 1
```

此时：

- `getChars()` 返回 `combinedData`
- `getCode()` 返回最后一个字符的 `charCodeAt(...)`

也就是说，`content` 只负责标记这是组合字符，并记录宽度，真实字符串内容从 `combinedData` 取。

## 与 BufferLine 的配合

`BufferLine` 中也使用同样的解析方式：

- `getString()`：如果有 `IS_COMBINED_MASK`，返回 `_combined[index]`
- `getCodePoint()`：组合字符时返回 `_combined[index]` 最后一个字符的 code
- `getWidth()`：通过 `content >> Content.WIDTH_SHIFT` 获取

另外在 `addCodepointToCell()` 中可以看到普通字符升级为组合字符的过程：

1. 原本 cell 里已经有一个普通字符
2. 又追加一个 width 为 0 的 combining codepoint
3. 把原字符和新字符拼到 `_combined[index]`
4. 清掉原来的 codepoint 位
5. 设置 `IS_COMBINED_MASK`

也就是说，一个 cell 最开始可以是普通字符，后续在输入阶段被“升级”为组合字符。

## 结论

`CellData.content` 的职责可以概括为：

- 普通字符时：保存 `codepoint + width`
- 组合字符时：保存 `combined 标记 + width`

真实字符内容的来源分两种：

- 普通字符：从 `content & CODEPOINT_MASK` 解出
- 组合字符：从 `combinedData` 读取

因此，理解 `content` 的关键不是把它当成字符串，而是把它当成一个按位编码的 cell 元数据字段。
