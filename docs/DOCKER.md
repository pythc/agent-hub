# Docker Compose 单实例部署

这套入口启动 Linux 容器中的一个 Roppo 实例：`supervise` 管理宿主和独立 Watchdog，私有数据保存在专用命名卷。首版支持 API 模型、Worker 命令沙箱和内置 Chromium。现有 macOS 安装继续使用自己的 LaunchAgent。

## 启动

本机需要运行中的 Docker Engine / Docker Desktop 和 Compose 插件，无需另装 Node、Python 或 Chromium。构建需要访问基础镜像、npm 和 Debian 软件源。在仓库根目录执行：

```sh
./deployment/compose.sh up
```

首次执行从当前源码构建 `roppo:local`，创建数据卷，执行真实 Bubblewrap 探测，等待健康检查通过，打印本机配置链接。打开链接，创建本地账号，在「模型连接」中添加 API，在「Agent 团队」中为 Router 和 Worker 选择该连接。实例创建本身不会获得模型额度。

已有实例时，`up` 启动原容器，不因源码或镜像标签改变而隐式升级。删除容器但保留卷后，`up` 会先检查兼容性并离线备份旧数据，再创建容器。更改镜像或端口使用下文的 `upgrade`。

默认只向宿主 `127.0.0.1:4337` 发布端口。若已有实例占用该端口，选择独立项目名和端口，并在后续操作中保持这些环境变量：

```sh
export COMPOSE_PROJECT_NAME=roppo-personal
export ROPPO_PORT=4338
./deployment/compose.sh up
```

每个项目使用自己的卷、账号、配置和任务账本。不要把原生安装目录直接挂到 `/data`；入口拒绝自动接管非空、未标识的数据卷。Docker 守护进程应位于执行命令的本机，控制台链接使用本机回环地址。

## 日常操作

| 命令 | 行为 |
| --- | --- |
| `./deployment/compose.sh status` | 显示容器与健康状态 |
| `./deployment/compose.sh logs` | 查看最近日志；可加 `-f` |
| `./deployment/compose.sh open` | 生成新的临时配置链接 |
| `./deployment/compose.sh check` | 实测 Bubblewrap、Chromium 和数据库兼容性 |
| `./deployment/compose.sh stop` | 停止整个容器 |
| `./deployment/compose.sh start` | 启动原容器 |
| `./deployment/compose.sh down` | 删除本项目容器和网络，保留数据卷 |
| `./deployment/compose.sh backup` | 检查未结工作、停机、完整卷备份，随后启动原容器 |
| `./deployment/compose.sh upgrade` | 检查目标镜像、停机备份、应用目标配置、检查健康 |

`restart: unless-stopped` 由 Docker 管理容器生命周期；容器内监督器管理自己的子进程。Docker Desktop 是否随登录启动由宿主设置决定。`stop` 是进程停止，不是任务取消；计划维护优先使用会检查未结工作的 `backup` / `upgrade`。

## 数据与执行边界

默认卷名为 `<项目名>_roppo-data`，挂载到 `/data`：

```text
/data/
  .roppo-container.json          卷格式及实例标识
  .roppo-container.lock          跨容器 flock 所有权锁
  state/
    config.json                 启动配置
    state.sqlite                宿主账本
    watchdog/                   独立 Watchdog 账本
    home/                       容器内 HOME
    workspace/                  默认工作目录
    backups/                    离线备份和校验清单
    …                           账号、密钥、浏览器状态、任务文件等
```

跨 PID 命名空间的 `flock` 覆盖受管容器整段生命周期；第二个受管容器不能同时启动或备份同一卷。获得所有权后才清理异常退出留下的 PID 文件，避免容器重建时 PID 复用导致误判。启动时只更新容器专用 HTTP 字段，保留已有模型、提示词、权限和私有数据。

容器以 UID/GID `1000:1000` 运行，根文件系统只读，移除全部 capabilities，不挂载 Docker socket 或宿主 HOME。浏览器和临时工具写入专用卷或 tmpfs。Worker 命令仍经过 Bubblewrap；默认来源为只读工作区，默认命令网络关闭。写入和命令网络由已有权限配置决定。

默认 Docker 策略会阻止嵌套沙箱。本方案显式使用基于固定 Moby 默认配置的 syscall 扩展，并设置 `systempaths=unconfined`。这是容器策略放宽，见[具体差异、上游来源与许可](../deployment/SECCOMP.md)。不支持嵌套 user namespace 的宿主会启动失败；检查宿主策略，不要将沙箱静默关闭。裸 Linux 的 AppArmor 等策略可能额外限制启动。

容器不继承 Mac 的 Codex、Feishu CLI 或系统钥匙串登录，镜像未安装原生 Codex / Feishu CLI。首版按 API 模型和本机网页入口验收。原生 CLI、宿主项目挂载、公开 Webhook 入站和跨容器子团队配对需分别设计、验收；本方案未提供这些连接。容器间 loopback 不互通。

## 升级与失败处理

更新源码到希望使用的版本后执行：

```sh
./deployment/compose.sh upgrade
```

默认重建本地源码镜像。使用自备镜像时，导出 `ROPPO_IMAGE=registry.example/roppo@sha256:…` 再执行，脚本会拉取它。目前没有已发布的官方应用镜像。`ROPPO_BUILD=1` 强制构建；`ROPPO_BUILD=local` 只用已有本地镜像，适用于离线操作和隔离验收。基础 Node 镜像固定 digest，应用依赖由 lockfile 固定；Debian 包由构建当时的软件源解析。

升级顺序：

1. 构建或拉取目标镜像，只读检查数据库 schema、完整性和配置。目标无法解析配置、数据库比镜像更新或配置恢复未完成时，在停机前拒绝。
2. 使用当前设置 revision 准备维护。未结任务、作业、目标、投递和工具副作用等会阻止升级，不自动取消它们。
3. 持久保存操作 ID 和原暂停状态，暂停调度，再检查一次未结工作。后来人工发出的暂停或恢复优先于安装器。
4. 停止整个原容器，用**原容器的精确镜像 ID**离线备份全卷，再复核目标兼容性。
5. 应用目标镜像，等待健康检查，结束维护。只有仍拥有该次暂停且原实例未暂停时，才恢复调度。

目标容器启动之前失败，脚本尝试启动原容器并撤销自己的维护暂停。目标容器开始启动之后失败，保留数据和维护回执，停止自动处理；不自动回滚代码或倒灌数据库，因为目标程序可能已经迁移 schema。

此时先检查 `status` / `logs`，使用兼容镜像向前修复并确认实例健康，再执行 `./deployment/compose.sh finish`。准备后取消维护且尚未发生不兼容变化时，可在原实例正常运行后执行 `./deployment/compose.sh abort`。二者仅处理已知回执，不推断任务完成，也不覆盖后来人工发出的暂停。

命令中断并提示已有维护回执时，也先检查实例，再选择 `finish` 或 `abort`，不要删除回执绕过维护状态。直接 `docker compose up` 会跳过包装脚本的停机前检查和备份。

## 备份与恢复范围

`backup` 输出归档路径、manifest 路径与 SHA-256。备份包含卷内账号、密钥、配置、浏览器状态、工作文件、SQLite 及 WAL，不重复包含历史备份目录和运行锁。归档内文件逐个校验，数据库副本执行 SQLite 完整性检查。备份含私有凭据，默认仅卷内用户可读。

备份仍位于同一个卷中，不能防止整卷丢失。需要另存时，创建仅自己可读的宿主目录，使用输出的实际文件名复制归档和 manifest：

```sh
mkdir -m 700 ./private-backup
docker cp "$(docker compose ps --all -q roppo):/data/state/backups/<实际文件>.tar.gz" ./private-backup/
docker cp "$(docker compose ps --all -q roppo):/data/state/backups/<实际文件>.json" ./private-backup/
```

当前没有产品化的一键整卷恢复命令。恢复需停止原实例、核对校验和与镜像 schema 兼容性、离线审查完整快照，并保留恢复前数据。不要在运行卷上直接解压覆盖。恢复出来的维护暂停仍需核对回执；复制的实例身份不应与原实例同时运行。快照不会撤销已发送的消息、提交或远端操作，卷外凭据和外部 CLI 登录也不在备份中。原生 CLI 的数据库备份与恢复另见[运维文档](OPERATIONS.md)。

`down` 保留卷；`docker compose down --volumes` 会删除私有数据，属于清空操作。

## 环境问题与验收范围

- **端口占用**：导出另一个 `ROPPO_PORT`。Host / Origin 校验识别外部端口；内部 Watchdog 继续使用容器回环地址。
- **Docker 地址池耗尽**：选择不与宿主、VPN、Docker 网络重叠的空闲网段，导出 `ROPPO_SUBNET`。包装脚本会加载专用 IPAM 覆盖文件，后续操作保持同一变量，无须清理其他项目网络。
- **沙箱失败**：检查 `logs` 中真实 Bubblewrap 探测错误，以及宿主 user namespace、seccomp、AppArmor 策略。不会回退为无沙箱命令执行。
- **权限不足或卷被占用**：使用专用卷，保持 UID `1000:1000`，确认没有另一个受管容器拥有它。

本轮验证环境为 Docker Desktop 的 Linux ARM64 虚拟机：Engine 29.4.3、Compose 5.1.3、Node 24.22.2。真实容器覆盖命令沙箱、Chromium、API 协议夹具到 Worker 命令完整链路、账号和账本保留、跨容器卷锁、SIGKILL 后重建、离线备份、升级与暂停所有权、准备阶段中断后的回执恢复，以及目标健康检查失败后的保留暂停和人工修复。不兼容镜像专门降低 schema 上限；失败健康检查镜像与候选镜像使用相同应用代码。二者都不代表历史发行版，夹具未调用商业模型。

仓库增加了 `Container acceptance` 工作流，在 PR 中构建运行镜像并执行隔离验收；本地已运行对应脚本，远端 CI 尚未运行。浏览器另用真实 Chrome 验证映射端口登录、容器重启后的会话保留，以及中英文、明暗主题、桌面和手机共 8 种页面状态。

AMD64 构建、裸 Linux / 不同 AppArmor 配置、Windows 宿主及真实模型提供商的容器端到端验收尚未完成。不能外推到所有 Docker 环境。原有 macOS 常驻实例未升级或迁移到容器。

本轮检查数量、故障注入与私有证据索引见[实现与验收记录](DOCKER_ACCEPTANCE_2026-11-09.md)。
