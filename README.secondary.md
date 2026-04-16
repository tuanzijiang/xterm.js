# Init Notes

仓库初始化和构建前，需要先保证依赖按开发模式完整安装。

## 注意事项

- 当前环境如果带有 `NODE_ENV=production`，`npm` 会省略 `devDependencies`。
- 这个仓库的标准构建入口 `npm run build` 依赖 `tsgo`。
- `tsgo` 来自 `@typescript/native-preview`，属于 `devDependencies`。
- 如果开发依赖没装完整，构建会直接报 `sh: tsgo: command not found`。
- 依赖安装不完整时，`node_modules` 里可能会出现空目录，随后 `tsc` 会继续报缺少 `@types/*`。

## 推荐初始化命令

```bash
env NODE_ENV= npm ci --include=dev
```

## 构建命令

```bash
npm run build
```

## 排查建议

- 先确认 `node_modules/.bin/tsgo` 是否存在。
- 如果不存在，优先重新执行开发模式安装，不要直接怀疑源码。
- 如果 `npm install` 后依然异常，优先使用 `npm ci --include=dev` 按锁文件重建依赖树。
