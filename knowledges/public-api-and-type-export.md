# xterm.js 如何新增一个 Public API，导出一个新的类型

本文说明在 xterm.js 里：

- 如何新增一个对外 public API
- 如何导出一个新的 public 类型
- 改动时通常需要同步哪些文件

核心结论先说：

`typings/xterm.d.ts` 是对外契约，`src/browser/public/Terminal.ts` 和 `src/common/public/*` 是这份契约对应的实现层。新增 public 能力时，通常要同时改“声明”和“实现”，不能只改一边。

## 总览

可以把 public API 维护分成三层：

1. 对外声明层
2. public facade 实现层
3. 内部 core 能力层

最常见的链路是：

```ts
typings/xterm.d.ts
  -> declare external API contract

src/browser/public/Terminal.ts
  -> implement Terminal public facade

src/common/public/*
  -> implement sub APIs like parser/buffer/unicode

src/browser/* / src/common/* / src/headless/*
  -> actual internal behavior
```

其中：

- `typings/xterm.d.ts` 决定外部用户能看到什么类型和文档
- `src/browser/public/Terminal.ts` 决定浏览器版本的 public `Terminal` 实际暴露什么行为
- `src/common/public/*` 负责 parser、buffer、unicode 这类子 API 的 facade
- 更底层的 `src/browser/*`、`src/common/*`、`src/headless/*` 负责真正实现

## 关键文件

新增或调整 public API 时，最常涉及这些文件：

- `typings/xterm.d.ts`
- `src/browser/public/Terminal.ts`
- `src/common/public/ParserApi.ts`
- `src/common/public/BufferNamespaceApi.ts`
- `src/common/public/UnicodeApi.ts`
- `src/common/Types.ts`

如果能力也要暴露给 headless：

- `typings/xterm-headless.d.ts`
- `src/headless/public/Terminal.ts`

## 1. `typings/xterm.d.ts` 是 public API 基准

这个文件不是普通的构建产物，而是仓库里直接维护的 public API 声明。

它的职责是：

- 定义 npm 用户能看到的对外类型
- 提供 public API 注释文档
- 明确哪些能力属于稳定的外部契约

因此：

- 新增 public 方法，要先考虑这里怎么声明
- 新增 public 类型，也要先考虑这里怎么导出
- public 注释通常也写在这里

## 2. `src/browser/public/Terminal.ts` 是浏览器 public facade

浏览器侧的 `Terminal` public 类在这里实现。

它的特点是：

- 通过 `implements` 对齐 `@xterm/xterm` 的 public 类型契约
- 很多方法本身只是对 `_core` 的一层包装
- 一些 getter 会返回 facade 对象，例如 parser、buffer、unicode

因此如果你在 `typings/xterm.d.ts` 的 `Terminal` 上加了一个新方法，通常也要在这里补实现。

## 3. `src/common/public/*` 是子 API facade

不是所有 public 能力都直接挂在 `Terminal` 上。

例如：

- parser API 在 `src/common/public/ParserApi.ts`
- buffer API 在 `src/common/public/BufferNamespaceApi.ts`
- unicode API 在 `src/common/public/UnicodeApi.ts`

如果新增的是这些子接口上的方法或类型，通常要同步修改：

- `typings/xterm.d.ts` 中对应接口
- 对应 facade 实现
- 底层 core service 或 buffer/parser 实现

## 4. `src/common/Types.ts` 是内部类型对 public 类型的承接层

`src/common/Types.ts` 里的 `ITerminalOptions` 继承自 public 的 `ITerminalOptions`。

这意味着：

- 公开 option 会影响内部类型系统
- 新增 public option 时，往往也要检查内部类型和 options service 是否需要同步支持

但要注意：

- 这里只是类型承接
- 真正让一个 option 生效，还需要底层逻辑实际消费它

## 新增一个 Public API 的步骤

这里以“给 `Terminal` 新增一个 public 方法”为例。

### 步骤 1：先改 `typings/xterm.d.ts`

在 `Terminal` class 里新增方法签名和注释。

例如新增：

```ts
foo(): string;
```

应该先写到：

```ts
export class Terminal implements IDisposable {
  /**
   * Returns foo.
   */
  foo(): string;
}
```

这一步的意义是：

- 定义外部用户能看到的 API 形状
- 明确参数、返回值、注释和实验性语义

### 步骤 2：再改 `src/browser/public/Terminal.ts`

把这个方法真正实现出来。

典型写法是对 `_core` 做一层包装：

```ts
public foo(): string {
  return this._core.foo();
}
```

如果这个能力本来就已经在 `_core` 里存在，那么这里通常只是透传。

如果 `_core` 还没有这个能力，就要继续往下补。

### 步骤 3：必要时补底层接口和实现

如果 `foo()` 不是一个已有内部能力的简单透传，那么还需要补：

- `ITerminal` 或相关内部接口
- `CoreBrowserTerminal`
- 更底层的 service、buffer、parser 或 renderer

判断标准很简单：

- public facade 只是包装已有能力：改 facade 即可
- public facade 需要新行为：继续改底层实现

### 步骤 4：如果 headless 也要支持，同步改 headless

如果这个 public 方法不只是浏览器侧有，也应该在 headless 里可用，那么还要同步修改：

- `typings/xterm-headless.d.ts`
- `src/headless/public/Terminal.ts`

否则会出现浏览器版本和 headless 版本的 public API 不一致。

## 导出一个新的 Public 类型的步骤

这里说的“导出新类型”，通常指的是让外部用户可以从 `@xterm/xterm` 获得新的类型名。

例如：

- 新增一个接口 `IMyFeature`
- 新增一个类型别名 `MyMode`
- 新增一个 options 子结构类型

### 情况 1：这个类型只是 public 入参/返回值的一部分

这种情况下，通常直接在 `typings/xterm.d.ts` 里导出它即可。

例如：

```ts
export interface IMyFeature {
  enabled: boolean;
}
```

然后再把它接到 public API 上：

```ts
export class Terminal implements IDisposable {
  getMyFeature(): IMyFeature;
}
```

接着在实现层对齐这个签名。

### 情况 2：这个类型对应一个真正的 facade 对象

如果这是一个新的子 API，而不是单纯的结构类型，通常还要补一层实现对象。

例如可以类比：

- `IParser` <-> `ParserApi`
- `IBufferNamespace` <-> `BufferNamespaceApi`
- `IUnicodeHandling` <-> `UnicodeApi`

这时一般要做三件事：

1. 在 `typings/xterm.d.ts` 导出新接口
2. 在 `src/common/public/` 或 `src/browser/public/` 提供实现类
3. 在 `Terminal` 或其他 public 对象上提供入口 getter/method

### 情况 3：新增一个 public option 相关类型

如果新增的是 option 相关类型，例如：

- `IMyFeatureOptions`
- `MyOptionMode`

通常还要同时检查：

- `typings/xterm.d.ts` 中 `ITerminalOptions`
- `src/common/Types.ts`
- options service 和默认值定义
- 对应消费这个 option 的运行时代码

只导出类型，不补运行时消费逻辑，通常是不完整的。

## 一个最小示例

假设要新增：

- 一个 public 类型 `IFoo`
- 一个 public 方法 `foo(): IFoo`

最小链路通常是：

### 1. 在 `typings/xterm.d.ts` 里导出类型

```ts
export interface IFoo {
  value: string;
}
```

### 2. 在 `typings/xterm.d.ts` 的 `Terminal` 上声明方法

```ts
export class Terminal implements IDisposable {
  foo(): IFoo;
}
```

### 3. 在 `src/browser/public/Terminal.ts` 实现方法

```ts
public foo(): IFoo {
  return this._core.foo();
}
```

### 4. 在底层 `_core` 提供真实能力

如果 `_core` 不支持，就继续补内部接口和实现。

## 什么时候不能只改一处

最容易出问题的是下面两种情况。

### 只改 `typings/xterm.d.ts`

这样会导致：

- 类型系统里好像有这个 API
- 但运行时可能并没有这个实现

结果就是外部用户能编译通过，但实际调用时报错或行为不一致。

### 只改实现，不改 `typings/xterm.d.ts`

这样会导致：

- 运行时代码已经有能力
- 但外部用户拿不到正确类型
- 文档和声明也不完整

结果就是 API 实际存在，但不是一个完整的 public API。

## 一个实用的维护清单

当你要新增一个 public API 或导出新类型时，可以按下面这份清单检查：

1. `typings/xterm.d.ts` 是否已经声明并导出
2. `src/browser/public/Terminal.ts` 或对应 facade 是否已经实现
3. 底层 `_core` 或 service 是否真的支持这个行为
4. 如果是子 API，`src/common/public/*` 是否已经补齐
5. 如果是 option，`src/common/Types.ts` 和 options service 是否同步
6. 如果 headless 也要支持，`xterm-headless` 对应文件是否同步
7. 注释和实验性标记是否已经补齐
8. 是否运行 `npm run lint-api` 检查声明文件

## 总结

xterm.js 的 public API 维护方式，不是“自动从源码导出声明”，而是“手工维护 public 契约，再让 public facade 与底层实现对齐”。

因此新增 public 能力时，最稳妥的思路是：

1. 先定义 public 契约
2. 再补 public facade
3. 最后补底层实现和对应平台支持

这样改出来的能力，类型、文档和运行时行为才会保持一致。
