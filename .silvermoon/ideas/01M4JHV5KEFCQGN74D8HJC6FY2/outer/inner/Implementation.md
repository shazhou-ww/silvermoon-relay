# Implementation

## Steps

### I-S01: 建立显式本地 profile 与启动编排

为 Web、Worker 和 Connector 定义不回退到生产地址的本地配置，编排依赖检查、D1 migration、服务 readiness 与有序启动，并在配置不完整时给出可执行错误。

### I-S02: 打通隔离认证、数据与 Connector

在本地 D1 中提供可重置的开发身份和连接数据，通过选定的登录方式创建真实 browser session 与 CSRF cookie，并以独立 ID 启动指向本地 Worker 的临时 Connector。

### I-S03: 固化 parity 检查与开发说明

增加覆盖 origin、cookie、CSRF、session、WebSocket 和资源隔离的自动检查，并把首次配置、日常启动、重置和故障定位收敛为一条文档路径。

## Acceptance criteria

### I-AC01: 标准命令具备确定性 readiness

在干净本地状态运行标准命令，自动化检查证明 migration 完成、Worker health 通过后 Web 才报告 ready；缺依赖或配置时进程以非零状态和明确修复命令退出。

### I-AC02: 本地认证与 Connector 形成完整闭环

浏览器自动化证明本地登录产生可验证 session，至少一个 CSRF 写操作成功，临时 Connector 通过本地 WebSocket 上线且不会复用生产 token。

### I-AC03: 本地模式不会静默访问生产

测试枚举 Web、Worker、D1 和 Connector 的有效 endpoint/binding，证明本地 profile 中出现生产 Relay、生产 D1 ID 或生产凭据时启动会被阻止。
