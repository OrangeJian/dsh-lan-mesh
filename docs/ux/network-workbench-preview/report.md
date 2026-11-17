# 网络总览独立视觉取证

直接渲染实际 NetworkWorkbench 组件（fakeReact/h 静态导出），所有节点与状态为明确模拟数据，不连接真实节点。组件 CSS 由 `scripts/network-workbench-preview.mjs` 从 `ui/network/network-workbench.css` **整体重写注入**（sha1 `916537473c52c29e93827e6001bbf42ec6737318`，6879 字节），预览不可能停留在比组件更旧的样式上。宿主颜色变量为样例。

## 测量结果

| 用例 | 视口 | 主题 | 工作台宽 | 布局列 | 显示方式 | 横向溢出 | 可见节点 | 被裁剪节点 | runtimeErrors | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| one-1440-light | 1440x900 | light | 1440 | 2 | 拓扑 block（560px 放射） | 无 | 1/1 | 0 | 0 | PASS |
| three-1440-light | 1440x900 | light | 1440 | 2 | 拓扑 block（560px 放射） | 无 | 3/3 | 0 | 0 | PASS |
| three-640-light | 640x768 | light | 640 | 1 | 拓扑 grid（静态排布） | 无 | 3/3 | 0 | 0 | PASS |
| three-stale-1024-dark | 1024x768 | dark | 1024 | 1 | 拓扑 block（520px 放射） | 无 | 2/3 | 0 | 0 | PASS |
| ten-1440-light | 1440x900 | light | 1440 | 2 | 拓扑 block（560px 放射） | 无 | 10/10 | 0 | 0 | PASS |
| ten-1024-dark | 1024x768 | dark | 1024 | 1 | 拓扑 block（520px 放射） | 无 | 10/10 | 0 | 0 | PASS |
| ten-640-light | 640x768 | light | 640 | 1 | 拓扑 grid（静态排布） | 无 | 9/10 | 0 | 0 | PASS |
| ten-narrow-1440-dark | 1440x900 | dark | 640 | 1 | 拓扑 grid（静态排布） | 无 | 10/10 | 0 | 0 | PASS |
| thirty-1440-light | 1440x900 | light | 1440 | 2 | 列表 4 列 | 无 | 20/30 | 0 | 0 | PASS |
| thirty-1024-light | 1024x768 | light | 1024 | 1 | 列表 3 列 | 无 | 12/30 | 0 | 0 | PASS |
| thirty-640-light | 640x768 | light | 640 | 1 | 列表 2 列 | 无 | 6/30 | 0 | 0 | PASS |

PASS 11 / 11；无 FAIL

“可见节点”是首屏内完整落在工作台视口里的节点数，小于总数表示节点在 `lm-networkWorkbench` 的内部纵向滚动区内，滚一下即可见；“被裁剪节点”统计的是几何上被容器切掉、无法通过滚动看到的节点，这一类必须为 0。

每个用例的断言：页面与工作台无横向溢出、节点数与 fixture 声明一致、节点卡片无两两矩形碰撞、布局列数符合预期（工作台宽 ≤650px 或视口 ≤1100px 为单列，否则两列）、`compactNotice` 仅在工作台容器查询生效时显示、拓扑模式下节点定位方式（宽屏 `absolute` 放射 vs 窄容器 `grid` 静态排布并隐藏连线）、浏览器侧 runtimeErrors 为 0。

关键不变式：`three-640-light`（工作台 640px）、`ten-640-light`（工作台 640px）、`ten-narrow-1440-dark`（工作台 640px）、`thirty-640-light`（工作台 640px） 都落在 `@container lm-network (max-width:650px)` 内：拓扑转静态网格、连线隐藏、`compactNotice` 显示。其中 `ten-narrow-1440-dark` 的窗口是 1440px 而工作台外框 640px——窄窗证据来自容器宽度而不是媒体查询宽度，这正是上一批 inbox 取证踩过的坑（fixture 停在旧 @media，窄窗截图其实是双栏）。

重名用例：`three-1440-light`、`three-640-light`、`three-stale-1024-dark`、`ten-1440-light`、`ten-1024-dark`、`ten-640-light`、`ten-narrow-1440-dark`、`thirty-1440-light`、`thirty-1024-light`、`thirty-640-light` 都含重名节点 “Reviewer 所在设备”（10 个用例覆盖同名节点）。重名节点各自保留独立 ID，节点卡片不合并、不碰撞，详情区按选中 ID 显示。

过期快照用例：`three-stale-1024-dark` 显示 `lm-networkStale` 提示条，摘要三格改为“未核对”文案而不是实时计数。

## 未运行（NOT RUN）

- 真实 DSH 宿主内的板块切换、滚动与真实主题变量：证据只渲染组件，不含 App 外壳。
- 真实双机节点发现、失联与恢复：单机无法复现。`stale` 用例只证明过期快照的文案与排版，不证明失联检测本身。
- 离线/offline 设备的专属视觉状态：组件当前没有该状态（DOM 与 CSS 中都没有对应类名），fixture 无法呈现，因此未构造。若组件后续补上，需要同步新增 fixture 并让本脚本纳入。
- 键盘焦点顺序与读屏（NVDA/VoiceOver）验收：未运行。
- 搜索输入后的过滤、拓扑/列表切换后的重绘：静态快照不含交互，未运行。

截图是软件组件布局证据，不证明节点连接健康或授权能力。

## 重新生成

```
node scripts/network-workbench-preview.mjs
```

脚本幂等：先把 6 个 fixture 的组件样式段按 `ui/network/network-workbench.css` 重写（已是最新则不改文件），再用隔离的无头 Chromium（本机为 Edge，headless + CDP）在 1440/1024/640 三档窗口、深/浅色下实测 11 个用例，写出 `screenshots/*.png`、`preview-validation.json` 与本文。若本机找不到浏览器，脚本只刷新 fixture 并明确报告“未测量”，不会写入任何测量数字。
