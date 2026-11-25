# 原话记忆 v0.11.3 · Apache-2.0 开源发布

给 DeepSeek Harness 的本地对话档案：按日期和角色回查原话，选择旧会话导入，或把不同会话的记忆隔离。

本次只更新项目许可证和包版本，不改变归档、导入或隔离行为。插件自身采用 Apache-2.0；随包第三方组件保留各自许可证。此许可不适用于用户聊天记录。

从本页附件下载 `dsh-standalone-memory-0.11.3.tgz`，在下载目录打开 PowerShell：

```powershell
$pkg = (Resolve-Path '.\dsh-standalone-memory-0.11.3.tgz').Path
if ((Get-FileHash $pkg -Algorithm SHA256).Hash -ne '97f7e1ca1d3b5e0f2ecd15bc101b70e31b2503d6a5e2e00a44c89d0142bd08c5') { throw '校验失败，请勿安装' }
dsh plugin --profile desktop add --offline --ignore-scripts "$pkg"
```

重启对应实例，在「设置 → 原话记忆」查看面板。归档以明文保存在本机，可按工作区关闭。详细操作见仓库 README。
