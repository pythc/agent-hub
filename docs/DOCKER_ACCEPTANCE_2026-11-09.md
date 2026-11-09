# Docker Compose 实现与验收记录

日期：2026-11-09。范围：Linux 单实例 Compose 安装、私有卷、API 模型配置、命令与浏览器运行环境，以及备份和升级。操作入口见 [部署指南](DOCKER.md)。

## 交付

- 多阶段运行镜像，固定 Node 基础镜像 digest，保留运行需要的 `tsx` / `esbuild` 和第三方许可。
- `compose.yaml`：宿主回环地址发布、非 root、只读根文件系统、无 capabilities、独立数据卷、日志轮转与健康检查。
- `deployment/compose.sh`：启动、检查、停止、完整离线备份、受控升级，以及中断后的 `finish` / `abort`。
- 跨容器卷锁和异常 PID 文件恢复；映射端口的 Host / Origin 校验、配置链接与 Cookie 命名空间；持久维护回执和暂停所有权。
- API 协议夹具、真实容器验收脚本、真实 Chrome 检查脚本，以及尚待远端执行的 Container acceptance CI。

现有 `.dockerignore` 继续采用默认拒绝的构建上下文白名单；私有状态、`.local`、宿主认证及原生安装未进入镜像。

## 环境与结果

| 检查 | 结果 |
| --- | --- |
| 环境 | Docker Desktop 4.73.0，Engine 29.4.3，Compose 5.1.3；Linux ARM64 VM；Node 24.22.2 |
| 候选镜像 | `roppo:compose-candidate-20261109`；本地 image ID `sha256:ea42538d5cc9a00cbfb6da65ab21b51cbef637af7d33d1399ce40c1cb8784d58` |
| 类型检查 | 主机、chat 和 workspace views 均通过 |
| 全量测试 | 88 个文件，1336 项通过 |
| 最终专项测试 | 容器部署与账号共 27 项通过，含中断与并发撤销回归 |
| 容器脚本 | 13 项检查通过，全部使用专用项目、端口 14439 和隔离数据卷 |
| 启动后的健康失败 | 独立真实容器故障注入通过；保留维护暂停，无自动代码 / DB 回滚；人工修复后正常 finish |
| 真实网页 | 中英文 × 明暗主题 × 1440 / 390 宽度共 8 状态；无横向溢出，无非预期响应 / 控制台异常；重启后原会话继续有效 |
| 备份导出 | 归档 SHA-256 与 manifest 匹配；包含账号和配置；宿主 schema 7、Watchdog schema 6 |
| 原部署保护 | 22:17 北京时间回读仍为 c9 release，supervisor 8359、host 8376，schema 7、revision 11、4 Workers；健康正常 |
| 前轮改造保护 | 原收尾工作树 50 个文件的冻结哈希均未改变 |

13 项容器检查包括：非 root / 只读根 / 无 Docker socket；端口映射和认证；Worker 私有状态不可见；API 协议夹具到真实 Worker 沙箱；真实 Bubblewrap 与 Chromium；同卷第二容器拒绝；离线备份与账号保留；SIGKILL 后重建；空闲升级与暂停恢复；有作业时停机前拒绝；不兼容镜像停机前拒绝；保留原人工暂停；中断准备回执在重启后恢复。

命令检查实际读取 `input.txt` 的内容 `2`，同时确认 Worker 无法读取私有配置和 canary 文件。Router / Worker 的模型输出由确定性 API 夹具提供，商业模型调用数为 0。这验证了协议、调度和实际命令执行链路，不能代替真实提供商的模型行为验收。

容器内 Chromium 验证了实际启动、打开页面和读取页面状态；控制面交互则由宿主真实 Chrome 验证。尚未完成容器内真实网站账号的完整浏览器工作流验收。

## 复核修正

维护准备阶段可能在进程退出后留下 `preparing` 状态。最终实现允许安全撤销该中间状态，并检查持久状态，阻止已经取消的异步准备请求稍后覆盖回执。暂停所有权同时核对审计控制 ID；后来的人工暂停或恢复不会被安装器覆盖。

实际验证的启动前失败为未结作业和 schema 不兼容，均未停止健康旧宿主；启动后的健康失败会保留维护暂停。离线备份失败后尝试启动原容器的路径已代码复核，尚未做专门故障注入。健康失败夹具与候选镜像的应用代码完全相同，只故意破坏 Docker healthcheck；修复该 healthcheck 后再 finish，没有执行历史程序降级或倒灌数据。

Seccomp 与固定上游配置逐项比较，差异仅为一组额外允许的 7 个 syscall。`systempaths=unconfined` 是另一个显式容器策略变化，已记录在[策略说明](../deployment/SECCOMP.md)。

## 边界与证据

当前交付是本地源码构建入口及本机 Docker ARM64 验收结果。未发布应用镜像，未切换现有 macOS 服务，未执行远端 CI。AMD64、裸 Linux / AppArmor、Windows 和真实模型提供商仍待验证。未实现跨机器实例委派、Worker 直接统筹远端、跨容器配对、公开 Webhook 入站或一键整卷恢复。

私有证据位于实现工作树 `.local/`，不包含在 Git 中：

- `docker-reviewed-typecheck.log`、`docker-reviewed-full-test.log`、`docker-reviewed-focused.log`
- `container-acceptance-reviewed/`：13 项容器检查结果和过程日志
- `container-health-failure/`：目标健康失败、人工修复、finish 的实际日志
- `container-browser-reviewed/`：8 张截图与浏览器结果
- `container-backup-export/`：导出的完整卷备份、manifest 与独立 SHA-256 回读
- `docker-runtime-image.json`、`deployment-readback.json`：候选镜像与原实例回读

测试容器和网络已经清理，只保留本轮专用测试卷、本地候选镜像与私有证据。未清理其他 Docker 项目、网络或镜像。
