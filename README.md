# 自由画布 · Free Canvas 🎨

### 一个无源、超轻量、纯前端驱动且极致流畅的无限自由协作看板
集成了外部网页嵌套、本地图片、Excel 电子表格与本地 HTML 组件的热插拔渲染，提供拟物化的高级设计美学与秒级启动性能。

---

## ⚡ 核心特性

* **🛸 纯静态架构（零后台开销）**：不需要拉起任何 Node.js 或 JVM 等重量级后台服务。直接通过浏览器本地文件协议（`file:///`）瞬间开启，零运行内存和网络开销。
* **🚀 极致性能：GPU 硬件加速与粒子网格优化**：
  - **Compositor Compositing Layer**：为画布视口元素 `#world` 以及卡片元素 `.card-item` 全面开启 `will-change: transform` 以及 `transform: translateZ(0)`，使缩放平移、拖拽拉伸仅占用 GPU 显卡带宽进行复合操作，避免页面频繁重排（Reflow）与重绘（Repaint）。
  - **GPU 粒子网格渲染**：优化了鼠标磁场点阵的绘制路径，将原先消耗巨大的 `ctx.arc` 复杂圆弧路径绘制转换为 GPU 优化的 `ctx.rect` 1x1 像素快速填充，使得数千个粒子背景即使在 4K 超高分屏上也能跑满 60fps 帧率。
* **🧠 墓碑式后台内存挂起（Apple-like Tombstone Memory Saver）**：
  - **原生 IntersectionObserver 驱动**：使用浏览器原生、高性能的可见性观察器，当网页卡片滑出视口（加 300px 缓冲边缘）且**持续时间满 30 秒**时，自动释放并移除对应的 `<iframe>` 节点，使页面开销降为零。
  - **白名单支持（White-list）**：支持在 [WhiteList.json](file:///d:/Desktop/NEW/free-canvas/memory-manage/WhiteList.json) 中添加白名单域名，加入白名单的网页（例如需要保持持续监控的仪表盘）在任何时候均不会被冷冻挂起。
  - **平滑无感还原**：当冷冻的网页重新滑入视口时，先展示加载占位标志，iframe 重建加载成功后通过 CSS 过滤动画平滑淡出，保障操作无感恢复。
* **🛡️ 网页深度冻结与隔离（Freeze Mode）**：
  - 网页组件默认处于**冻结状态**，覆盖着一层柔和的毛玻璃磨砂遮罩，阻断所有滚动和点击干扰，保障画布自由拖拽和缩放的连贯性。
  - 遮罩中心配有浮动 pill 标识：`🔒 按下 F 键 解冻组件`，给用户极致清晰的交互暗示。
* **🎯 浏览器激活模式（Browser Mode）**：
  - 鼠标悬浮在卡片上按下 **F 键**，组件瞬间解冻（遮罩消退，网页原彩呈现，释放鼠标与键盘交互），同时视角平滑推近居中，输入栏与 Go 按钮解锁。
  - 按下 **ESC 键**一键退出聚焦，页面重新安全冻结。
  - **无键位重叠**：F 键仅用于进入，ESC 仅用于退出，完美避免在嵌套网页表单中输入字母 `f` / `F` 导致意外退出浏览器的 Bug！
* **🛠️ DOM 静态化（拖动不刷新）**：
  - 弃用了会导致 DOM 重挂载的 `appendChild` 置顶操作，改为全 CSS 驱动的 Z-Index 递增调度层。
  - 无论在画布上怎么拖动移动、拉伸缩放，**卡片内的 iframe 网页绝对不会刷新**，完美保护表单数据和浏览进度。
* **📂 本地 HTML 组件拖拽即用（Blob URL 封装）**：
  - 支持将写好的本地 HTML 单页小工具（时钟、日历、自研表单等）直接拖入画布。
  - 利用浏览器 `FileReader` 自动将其转换为沙箱中的 `Blob URL` 隔离运行。
  - 卡片关闭时自动触发内存 Revoke，杜绝浏览器内存泄漏。
* **🔌 原生 Chrome 解锁扩展（Frame Unlocker）与 Cookie 桥接**：
  - 配套的 **`extension`** 插件拦截底层网络请求，静默剥离 `X-Frame-Options` 与 `CSP` 安全防嵌套响应头。
  - **动态 Cookie 穿透与登录态维持**：自动在后台将目标域名的 Cookie 转译为 `SameSite=None; Secure`，解决 Iframe 内跨域 Cookie 携带问题。
  - **登录避坑小贴士**：若某些极严格的安全网站（如复杂单点登录 SSO）在画板内登录失败，您可以**先在常规浏览器网页标签页中登录该网站**让浏览器保存并记住 Cookie 登录态，随后在自由画布中刷新，即可自动识别并无缝同步登录状态！
  - **智能弹窗分流与原位重定向**：自动捕获 Iframe 内所有的 `target="_blank"`。同时，若遇到带窗口特征（如 Google 登录）的 `window.open` 授权弹窗，允许其拉起原生浮动小窗口完成认证后自动关闭回传；对普通新标签链接强制原位重定向，防跑路出画板。
* **🔙 网页独立导航历史堆栈（Back / Refresh）**：
  - 每个 Page 卡片均配有独立的 **后退（←）** 与 **刷新（↻）** 按钮。
  - 自动捕获 SPA（单页应用）内路由变化并实时更新顶部地址栏 URL。
  - 维持独立的 `history` 堆栈，使用原生 `history.back()` 回退，完美保留页面内部滚动进度与表单数据。
* **📊 Excel 电子表格集成**：
  - 引入本地 SheetJS 引擎，支持直接拖入 `.xlsx` / `.xls` 表格文件，以精美的暗色拟物网格自适应呈现数据。

---

## 📂 优雅的解耦结构 (Modularized Architecture)

```text
free-canvas/
├── clickme.bat                  # 一键启动脚本（已更新为直启 ui/index.html）
├── README.md                    # 本项目核心说明文档
├── proxy-module.psm1            # 网页代理服务模块
├── extension/                   # 原生 Chrome 解锁/Cookie桥接扩展
│   ├── manifest.json            # 插件配置（已注入主世界 patches）
│   ├── rules.json               # declarativeNetRequest 过滤规则集
│   ├── content.js               # 隔离域 content script
│   └── main-world-patches.js    # 主执行域原生 window.open / history API 劫持脚本
├── ui/                          # 前端 UI 与视图交互层（纯静态解耦）
│   ├── index.html               # 空间画板主入口网页
│   ├── canvas.css               # 无限视口、浮动控制栏与网格背景样式
│   ├── canvas.js                # 无限画布 Pan/Zoom 计算、双击新建与拖放导入分流
│   ├── cards.css                # Note、Image、Excel、Page 样式、四手柄缩放与 LED 指示小圆点
│   ├── cards.js                 # 各类卡片的 DOM 生成与实体行为驱动（拖拽/拉伸）
│   └── focus-manager.js         # 全局 F / ESC 聚焦状态机管理器
└── memory-manage/               # 独立内存管理与域白名单控制
    ├── WhiteList.json           # 域白名单配置文件（写入防止被挂起的域名）
    ├── WhiteList.runtime.js     # 内存管理器运行时加载的白名单数据
    ├── load-white-list.ps1      # PowerShell 转化脚本
    └── memory-manager.js        # 核心内存挂起控制器（IntersectionObserver、30s定时器及加载占位）
```

---

## 🎮 快速开始与交互指南

### 1. 运行画布
- **一键双击**：双击运行项目根目录下的 **`clickme.bat`**，它会自动转换白名单并以 `file:///` 协议瞬间在默认浏览器拉起画板主页。

### 2. 导入高安全网页（解除 X-Frame-Options 限制）
由于大部分主流网站设置了防嵌套安全响应头，我们提供了配套扩展来解锁访问：
1. 在 Chrome 中打开 `chrome://extensions/`。
2. 开启右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击左上角 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选取项目中的 **`free-canvas/extension`** 文件夹导入即可！

### 3. 画布快捷手势
* **平移画布**：按住 **空格键** 并拖拽鼠标，或按住 **鼠标中键**，或在画布空白处直接按住**鼠标左键**拖拽。
* **以指针为中心缩放**：滚动 **鼠标滚轮**。
* **聚焦卡片**：鼠标悬浮在任意卡片上，按下 **F** 键。Page 卡片聚焦时会额外解冻网页交互。
* **退出聚焦/重新锁定**：按下 **ESC** 键。
* **卡片拉伸**：拖拽卡片四角的白色弧形半透明控制手柄。
* **卡片拖动**：拖拽卡片底部边缘 of iOS **Home Indicator（小白条手柄）**。
