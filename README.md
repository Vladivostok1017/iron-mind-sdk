# Iron Mind SDK · 模块开发工具

> 给「钢心 / Iron Mind」写战役模块用的工具：`imdev` 开发循环（改完存盘就重载）与零警告脚手架。
> 不含任何引擎代码——它只通过引擎的公开 HTTP 接口驱动内核。

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A5%2018-3c873a)

做战役模块时用的工具，**不属于游戏**。游戏本体（引擎 + 客户端）在 [iron-mind](https://github.com/Vladivostok1017/iron-mind)，
里面对作者有用的只有两份东西：模块格式规范（[`content/README.md`](https://github.com/Vladivostok1017/iron-mind/blob/main/content/README.md)）和官方案例
（[nanxun-1938](https://github.com/Vladivostok1017/nanxun-1938)、引擎自带的两个小模块）。

## 为什么单独一个仓库

| | 放哪 | 理由 |
|---|---|---|
| tick / 补给 / 战斗 / 将领 / HTTP / 前端 / 安装包 | [`iron-mind`](https://github.com/Vladivostok1017/iron-mind) | 玩家装的是这个，出厂就必须干净 |
| 模块格式规范、校验器、迁移器 | 同上 | **规范必须和校验代码住在一起**，否则文档和实现必然漂移 |
| 脚手架、模板、开发循环、将来的可视化编辑器 | **本仓库** | 作者工具跟着工具链走，不该被引擎版本绑死，也不该混进玩家的安装包 |

一句话：**引擎里不许有开发行为，SDK 里不许有引擎逻辑。**

所以本仓库**不复制任何引擎代码**，只通过引擎的公开 HTTP 接口驱动它。
这也是维护成本的关键——引擎升级时这里几乎没有要改的东西（见下面的自检）。

## 现在有什么

| 工具 | 作用 |
|---|---|
| `imdev.mjs` | **开发循环**：起内核 → 盯模块目录 → 存盘即重载 → 页面自己换地图 |
| `tools/module-init.js` | **脚手架**：生成一个校验零警告的最小模块 |
| `check`（`imdev --check`） | **兼容性自检**：确认引擎提供了 SDK 依赖的接口 |

将来的可视化编辑器、模板库、导出打包都往这里放。

## 怎么用

需要：Node 18+（`fetch`）、Rust（编引擎）、引擎仓库已经存在。

```powershell
# 0. 引擎先编一次（改了 Rust 才需要重编；只改 JSON 不用）
cd ..\iron-mind
cargo build --release -p sim-server

# 1. 生成一个能跑的模块骨架
cd ..\iron-mind-sdk
node tools\module-init.js --id org.you.mymod --name "我的战役"

# 2. 进开发循环
node imdev.mjs --module .\mymod.imod
#   页面 http://127.0.0.1:8899/ —— 改完存盘就重载，回到第 0 日
```

引擎不在同级目录时：

```powershell
node imdev.mjs --module D:\mods\demo.imod --engine D:\src\iron-mind
# 或者设一次环境变量
$env:IRONMIND_ENGINE = "D:\src\iron-mind"
```

作者**不装游戏**也能做模块：只要有引擎源码 + 本仓库，`imdev` 起的服务就是完整的
游戏界面（网页版）。想用桌面版玩，再跑引擎仓库的 `install.ps1`。

## 开发循环的几条规矩

- 重载会**清空命令流和电报**，回到第 0 日。旧命令在新数据上重放没有意义。
  要保住进度请存档。
- **存了一半的坏 JSON 不会毁掉现场**：内核加载失败时保留旧世界，`imdev` 只把
  错误打出来。改完再存一次就重载。
- `imdev` 会把模块的**上级目录**设成引擎的模块根（`IRONMIND_MODULES`），
  这样作者放在任何地方的模块都能被重载——引擎只接受"某个模块根底下的 .imod"。

## 和引擎的版本关系

`imdev` 只用四个接口：`GET /api/version`、`GET /api/modules`、
`POST /api/module`（重载）、`GET /api/llm`（读世界代号 `generation`）。
这些是引擎的**公开契约**，改动会在引擎的 `docs/07-框架与模块架构.md` 里记。

引擎升级后的标准动作：

```powershell
node imdev.mjs --check
```

它会起一下内核、打印引擎版本与接口自检结果。**任何一个接口缺失都会明确报错**
（退出码 2），而不是让你在重载失败时才发现。

> 为什么不用 git 依赖 / submodule 把引擎代码拉进来：那会让"改一次要提交两个仓库"
> 变成常态。本仓库刻意只依赖**运行时接口**，所以引擎内部怎么重构都与人无关。

## 常见问题

| 现象 | 原因 |
|---|---|
| `找不到引擎` | 用 `--engine` 指定，或把两个仓库放在同一父目录 |
| `引擎还没编译` | 去引擎目录 `cargo build --release -p sim-server` |
| `[重载失败] …模块路径不合法` | 模块目录不在任何模块根下；`imdev` 会自动设，手调接口时需要自己设 `IRONMIND_MODULES` |
| 页面没换地图 | 引擎太旧，`/api/llm` 里没有 `generation`；`node imdev.mjs --check` 会指出来 |
| 端口被占 | `--port 8900` |
