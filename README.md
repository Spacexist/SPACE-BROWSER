# 自由画布 · Free Canvas 🎨

### 一个无源、超轻量、纯前端驱动且极致流畅的无限自由协作看板
集成了外部网页嵌套、本地图片、Excel 电子表格与本地 HTML 组件的热插拔渲染，提供拟物化的高级设计美学与秒级启动性能。

---

## ⚡ 核心特性

* **🛸 纯静态架构（无本地服务进程）**：不需要 Node.js 或 JVM 后台服务，`clickme.bat` 生成运行时白名单后，直接通过浏览器本地文件协议（`file:///`）启动。
* **🚀 面向多网页卡片的渲染优化**：
  - **双层点阵**：基础点阵仅在视角稳定后重绘；鼠标附近使用固定 `320 × 320` 的局部弹性场，缩放不会增减点阵数量。
  - **输入合帧**：滚轮与鼠标移动事件通过 `requestAnimationFrame` 合并，同一帧只提交一次视图更新。
  - **合成线程 Focus 动画**：F / ESC 镜头移动使用 Web Animations API 驱动 `transform`，主线程只提交起点和终点；动画中暂停点阵重绘，并临时隐藏非目标 Page 的 iframe 像素层。
  - **可中断状态同步**：Focus 动画被拖拽、ESC 或下一次 Focus 打断时，会从当前合成矩阵继续，不会回跳；`will-change` 仅在动画期间启用并及时释放。
* **🧠 墓碑式后台内存挂起（Apple-like Tombstone Memory Saver）**：
  - **原生 IntersectionObserver 驱动**：使用浏览器原生、高性能的可见性观察器，当网页卡片滑出视口（加 300px 缓冲边缘）且**持续时间满 30 秒**时，自动释放并移除对应的 `<iframe>` 节点，使页面开销降为零。
  - **白名单支持（White-list）**：支持在 [`memory-manage/WhiteList.json`](memory-manage/WhiteList.json) 中添加白名单域名，加入白名单的网页（例如需要保持持续监控的仪表盘）不会被离屏释放。
  - **平滑无感还原**：当冷冻的网页重新滑入视口时，先展示加载占位标志，iframe 重建加载成功后通过 CSS 过滤动画平滑淡出，保障操作无感恢复。
* **🛡️ 网页冻结与隔离（Freeze Mode）**：
  - 网页组件默认处于**冻结状态**，使用常驻的半透明输入遮罩阻断滚动和点击；遮罩切换不卸载 iframe，也不使用大面积实时模糊。
  - 遮罩中心配有浮动 pill 标识：`🔒 按下 F 键 解冻组件`，给用户极致清晰的交互暗示。
* **🎯 统一卡片聚焦（Focus Manager）**：
  - Note、Page、Image、Excel 等卡片共用同一套 Focus 状态机；鼠标悬浮后按 **F**，视角平滑居中，Page 卡片会额外解锁 iframe、地址栏和导航按钮。
  - 按下 **ESC** 同时退出卡片编辑态与 Focus，并恢复进入 Focus 前的画布视角；iframe 内的 ESC 由扩展转发给外层画布。
  - 左右拖动、缩放或中途切换卡片会先同步当前动画位置，不会误触发退出动画，也不会残留 Focus 状态。
  - 左上角状态灯显示当前画布是否处于 Focus 状态。
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
│   ├── canvas/                  # 无限画布模块
│   │   ├── canvas.css           # 无限视口、浮动控制栏与网格背景样式
│   │   └── canvas.js            # Pan/Zoom、双击新建与拖放导入分流
│   ├── card/                    # 卡片模块
│   │   ├── cards.css            # Note、Image、Excel、Page 与缩放手柄样式
│   │   └── cards.js             # 各类卡片 DOM 与实体行为驱动
│   └── focus-manage/            # 全局聚焦状态模块
│       ├── focus-manager.css    # 聚焦指示灯与卡片聚焦视觉状态
│       └── focus-manager.js     # F / ESC 聚焦状态机管理器
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
