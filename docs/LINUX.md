# Linux 沙箱与部署验收

当前 0.10.0 已于 2026-11-05 完成复验：Docker Desktop Linux VM、ARM64、内核 `6.12.76-linuxkit`、Node `24.21.0`、Bubblewrap `0.12.0`，测试以 UID 1000 运行。**337 项测试通过，0 失败、0 跳过**，其中 22 项必须实际执行的沙箱/后台作业用例通过。原始逐测试结果见 [机器可读报告](acceptance/linux-operator-ui-2026-11-05.json)。这不是裸机、AMD64 或所有发行版的验收。

0.7.0 首次验收的 293 项结果仍保存在 [历史报告](acceptance/linux-2026-11-04.json)。0.8.0 的 297 项结果见 [历史配置台报告](acceptance/linux-2026-11-05.json)。0.9.0 的 312 项结果见 [历史首次配置报告](acceptance/linux-onboarding-2026-11-05.json)。0.10.0 加入实际入口配置、操作员配对、来源和模型独立保存、客户端安装与真实回执判定回归。

## 验证内容

- 独立 Bubblewrap 驱动运行真实命令，Codex 路径为不存在的文件。
- 工作目录写入、只读拒绝写入、宿主私有状态隔离、状态目录下当前工作区与分配附件可读、其他工作区不可读。
- 模型/来源凭据环境变量不转发给命令；`AGENTHUB_ENV_FILE` 指向的凭据文件在允许读取的目录中也被单独屏蔽，符号链接按真实目标处理，原文件不能改写。任务文件资源接口同样拒绝读取该文件。
- 网络关闭时不能访问父进程的回环 HTTP 服务；明确开启时可以访问。测试容器本身无公网网络。
- 等待子进程实际产生启动标记后结束 Assignment，确认后代进程不能继续落盘。
- 后台期限、交接豁免、作业去重和完成通知、停止及子代理回收。
- OpenAI Responses、Chat Completions、Anthropic 三条协议到真实 Linux shell 的宿主执行链路。模型响应来自隔离 HTTP 服务，不是商业模型实测。
- 官方企微 SDK 通过真实回环 WebSocket 完成认证、回执、任务路由及结果发送；不是企业微信平台实测。

Linux 的 `/tmp` 是独立 tmpfs；在里面创建同名临时文件不等于改写宿主文件。测试同时检查工作区外宿主原文件仍未改变，不能只根据一次 `touch` 的返回值判断隔离是否成立。

## 重复运行

在源码根目录，Docker 已启动且 Node 依赖已安装时：

```sh
node --import tsx examples/linux-acceptance.ts
```

脚本只复制白名单中的源码、测试和锁文件，不复制 `.local`、状态库、访问令牌、工作目录或客户端 MCP 凭据。构建和验收日志及报告保存在 `.local/linux-acceptance-*`。镜像留在本机缓存；测试容器自动移除，不推送镜像。

测试容器采用：普通用户、`--network none`、`--cap-drop ALL`、`no-new-privileges`，不挂宿主目录、Docker socket，不使用 `--privileged`。由于容器内再次创建沙箱，测试容器另外设置：

```text
--security-opt seccomp=unconfined
--security-opt systempaths=unconfined
```

这两项只用于无业务凭据的隔离验收容器，允许内层 Bubblewrap 创建命名空间和挂载自己的 proc。默认 Docker 策略的探针确实失败，报告保留了失败结果；不能声称默认 Docker 配置也能运行。Docker 对这些选项的定义见 [运行选项](https://docs.docker.com/reference/cli/docker/container/run) 与 [默认 seccomp 策略](https://docs.docker.com/engine/security/seccomp/)。

## 日常使用建议

团队常驻部署优先用独立 Linux VM/主机及专用普通用户，安装 Node 22.19+、Bubblewrap 和所需任务依赖，把 `work.sandboxDriver` 设为 `bubblewrap`。API 后端不需要 Codex；选择原生 Codex 后端才需要该机器上的 CLI 和登录。飞书 CLI 需要在 Linux 上单独安装和配置，不能复制 macOS 可执行文件。

提供 [systemd 服务模板](../deployment/agent-hub.service.example)。它需要管理员先准备专用账号、安装路径、配置和私有凭据文件权限，再审核安装；当前未完成 systemd 实机启动验收，不会自动写入系统目录。模板保留 supervisor 和正常停止流程，不在配置中关闭用户命名空间保护来掩盖启动失败。

```sh
./start.sh check /absolute/path/to/config.json
./start.sh serve /absolute/path/to/config.json
```

setup 现在会启动一个真实的空沙箱进程，不再只检查可执行文件是否存在。用户命名空间、AppArmor、外层容器或 proc 策略阻止启动时，检查会失败并给出原因；不会回退成不受限命令。应由管理员针对该服务审核运行策略，不要为了测试修改全局系统保护。

Bubblewrap 是构建沙箱的基础工具，最终权限由宿主传入的参数决定，见 [项目说明](https://github.com/containers/bubblewrap)。当前结果不构成内核漏洞防护、资源滥用防护或多租户隔离认证。AMD64、裸机发行版、Windows 独立驱动、长期负载及专用账号生产部署仍需分别验收。
