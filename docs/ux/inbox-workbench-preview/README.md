# 收件箱组件静态取证

实际 InboxWorkbench + inboxWorkbenchView，模拟26条提醒/3项目/3台设备的同名Reviewer。导出列表、详情、批量确认、空列表与失败提示；不读取或写入真实消息。实际组件CSS，宿主主题变量样例；截图不等于DSH实机操作或真正已读持久化。

7张截图覆盖1440浅色列表/批量确认、1024深色详情/失败、640窄窗详情、1024空状态，以及1440宽窗口内主区只有540px时的详情。均无页面横向溢出、无运行错误、无行内文本被裁切。

## 重新生成

```
node scripts/inbox-workbench-preview.mjs
```

脚本先按 ui/inbox/inbox-workbench.css 重写 5 个 fixture 的组件样式，再用本机 Chromium（Edge/Chrome，路径探测）以 CDP 逐例截图并测量，最后写 screenshots/*.png 与 preview-validation.json。没有可用浏览器时只刷新 fixture 并明确退出，不伪造测量值——这正是本目录早先的问题：组件从 `@media` 换成 `@container` 后，fixture 的 CSS 停在旧版本，640px 那张“窄窗详情”其实还是双栏。

## 容器宽度退化为单栏（handoff 要求的 540px 主区）

`.lm-inboxWorkbench` 声明 `container-type:inline-size`，`@container lm-inbox (max-width:850px)` 折叠为单栏。因此判断依据是主区宽度而不是窗口宽度：

| 用例 | 窗口 | 主区 | columns | 列表 | 详情 |
| --- | --- | --- | --- | --- | --- |
| list-1440-light-default | 1440 | 1440 | grid | 显示 | 显示 |
| detail-1024-dark-default | 1024 | 1024 | grid | 显示 | 显示 |
| detail-640-light-default | 640 | 640 | flex | 隐藏 | 显示 |
| detail-1440-main540-light | 1440 | 540 | flex | 隐藏 | 显示 |

1440 宽窗口里把主区压到 540px，实测 columns 计算值从 grid 变为 flex、列表 display:none、详情 block，根节点 scrollWidth 等于 clientWidth，4 个按钮（106/78/78/204px）均无溢出。即窄主区在宽窗口下同样退化为单栏，不再依赖窗口宽度。

## 数据

preview-validation.json 记录每例的 page/theme/width/height、实测 rootWidth/mainWidth、columnsDisplay/listDisplay/detailDisplay、overflow、rootOverflow、clippedRows、rows/visibleRows 与每个 lm-btn 的宽度和溢出状态。1440×900 列表可见 8 行（DOM 保留 26 行），1024×768 详情可见 6 行。
