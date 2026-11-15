# UX-1c 第一修正：插件重载样式

用户提供真实0.4.7截图，界面与服务版本均新，但新头部和项目行布局未生效。源码 installStyles 发现同ID样式即返回，因此插件热重载复用旧style；旧panel harness返回undefined且只处理不存在!==null，意外跳过整个CSS注入，未覆盖此场景。

先复现现有旧style不更新 → 原位更新同ID插件style并标记实际版本 → 覆盖首次安装/重复安装/重载旧CSS/无DOM，浏览器用相同fixture前后验证computed styles；不要求用户清缓存，不触碰宿主或业务协议。修复后继续UX-1其余导航/状态事项，0.4.8仅代表这一修正。
