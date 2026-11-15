# 离线安装及0.4.x升级

## 离线包

本轮实际验证版本0.4.2，源码b541feaa1ccd8f4c74ecbaedaef0b6f2f4c08438。使用git archive导出已提交版本再npm pack，不包含当前工作区暂停的M6草稿。依赖diff从本地已安装9.0.0重新打包；这是新生成的tar包，不宣称与注册表原tarball具有相同integrity。

离线材料：dsh-lan-mesh-0.4.2.tgz、diff-9.0.0.tgz、offline-manifest.json及本说明。Node要求>=22.19，验证机器为Node24.11.1；还需要本地已经安装npm与DSH。此包只解决插件依赖，不包含DSH、Node、内网模型或Git服务。

转移后先核对清单中的SHA-256：

```powershell
Get-FileHash .\dsh-lan-mesh-0.4.2.tgz -Algorithm SHA256
Get-FileHash .\diff-9.0.0.tgz -Algorithm SHA256
```

在包所在目录，用你选定的新安装目录执行：

```powershell
npm.cmd install --offline --ignore-scripts --no-audit --no-fund --update-notifier=false --cache .\offline-cache --prefix .\plugin-install .\dsh-lan-mesh-0.4.2.tgz .\diff-9.0.0.tgz
```

macOS/Linux使用npm而非npm.cmd。必须同时列出两个tar包，仅安装插件tar包会仍然需要解析diff依赖。可将DSH加载目录指向plugin-install/node_modules/dsh-lan-mesh，沿用原来的插件加载流程；本流程不自动改DSH配置。

2026-11-15已在全新缓存、全新隔离安装目录，用上述offline/ignore-scripts/no-audit/no-fund/update-notifier=false组合安装成功；实际Node导入插件入口成功，并断言从插件入口解析的diff落在隔离安装目录。没有借用开发仓库node_modules，也没有把安装成功称为真实DSH加载或三机执行成功。首次验证读取未导出的package.json子路径失败，已改为从入口所在目录只读获取包版本；未修改包的exports绕过错误。

## 全量升级流程

1. 各机器记录当前插件版本、commit、DSH版本和实例端口；不要记录密钥。
2. 在测试房间核对未解决Team执行。running/uncertain不能仅因升级而清空、重试或当作已停止。暂停产生新任务，按现有状态查询和人工对账保留证据。
3. 停止对应测试实例后，复制整个对应实例数据目录作为备份，保留原实例路径及端口映射。默认路径和非默认端口实例目录见store.meshRootDir；不使用删除或覆盖历史来“恢复”。
4. 所有参与节点安装同一0.4.x版本并重载；检查界面版与服务端版均一致。只更新磁盘文件不代表已加载。
5. 核对双向发现、既有房间/文档历史、附件校验及偏好；归档/恢复要求当前成员节点在线且全部支持生命周期能力。
6. Team仍保留原显式本机授权；不因更新而扩大trustedPeers或授权目录，不将Room Leader变化当作Team或文档权威迁移。

## 混合版本与回退限制

0.4起有密钥state pull强制校验回复proof。旧端没有proof会明确失败，不能把混合版本错误解释为“没有房间”，也不应关闭密钥来绕过。完成全量升级后再使用归档。

使用过生命周期的房间即使恢复active，generation与审计仍需新版理解；不能退回旧插件继续编辑。若确需回退，应保留现状副本，在单独测试目录使用升级前备份核对，明确期间新增历史如何保留；不要把较早备份直接覆盖正在运行实例。既有Team外部副作用也不能靠文件备份撤销。

## 验收状态

| 项目 | 状态与证据 |
|---|---|
| 空npm缓存离线安装两个tar包 | PASS，实际隔离安装 |
| 插件入口导入及diff解析位置 | PASS，Node断言 |
| Lifecycle签名篡改/降级拒绝 | 已有room-lifecycle.test.mjs实际localhost HTTP用例；非真实旧版宿主运行 |
| 物理双机/三机升级、备份恢复、真实模型 | NOT RUN，负责人设备验证 |
| 完全离线DSH/模型/Git/证书环境 | NOT RUN，不由插件依赖安装通过推出 |
