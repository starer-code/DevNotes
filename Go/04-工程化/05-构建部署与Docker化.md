# 05 - 构建部署与 Docker 化

> 从 C++ 的动态库/libtool 部署噩梦到 Go 的静态二进制：一个文件搞定容器化

---

## 一、简述

Go 编译产出**静态二进制**（前提下 `CGO_ENABLED=0`），没有动态库依赖、没有运行时安装（对比 C++ 的 `.so`/`.dll` + 运行时动态链接）。这让部署模型极简：

1. `go build` → 一个可执行文件
2. 多阶段 Dockerfile（**builder 编译 → 肥镜像剥离 → 瘦镜像运行**）
3. `scratch`/`alpine` 镜像，体积通常 **10~30MB**
4. `docker run` / Compose 编排

C++ 部署的经典烦恼——`libstdc++.so.6 not found`、`GLIBC_2.34 not found`、ldconfig、需要把一堆 `.so` 一起拷走——在纯 Go 世界里直接消失。

> **核心要点**：静态编译 + 多阶段构建演示了 Go 的部署哲学：「**产物单一、环境无关**」。只要你控制好 CGO 开关，一个二进制能跑在任意 Linux 上。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 构建产物 | 动态库/静态库 + 可执行文件 | 单一可执行文件 | 无 `.so`/`.a` 需分发 |
| 运行时依赖 | 目标机需匹配 libc/动态库 | `CGO_ENABLED=0` 时零依赖 | 拷贝即运行 |
| 版本冲突 | `GLIBC_2.30 not found`、`.so` 名冲突 | 无（Go 自带运行时） | 彻底告别 ABI 地狱 |
| 镜像方案 | 手动装依赖/多级 COPY .so | 多阶段：build → scratch/alpine | 一条 `FROM ... AS builder` |
| 镜像体积 | 常见 500MB~2GB | 常见 10~30MB | 静态二进制省掉一层层库 |
| 基础镜像 | ubuntu/debian 全量 | `scratch`（空镜像）/ `alpine` | 可以空到极致 |
| 健康检查 | 手写探针/脚本 | `HEALTHCHECK` + HTTP /healthz | Dockerfile 指令 |
| 服务发现/编排 | systemd / 手动进程管理 | 同样 systemd，但容器内单进程 | 容器化程度完全可控 |
| 部署步骤 | 装库 → 拷二进制 → 起服务 | 跑镜像 | 镜像即交付物 |

---

## 三、逐主题详解

### 3.1 go build 产物：静态优先

```bash
# 常见部署编译命令（Linux amd64、静态、精简符号）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
go build -ldflags "-s -w" -o app ./cmd/server

# 产物检查（Linux 上）
file app
# app: ELF 64-bit LSB executable, x86-64, statically linked

# 确认没有动态链接
ldd app
# 不是 a dynamic executable
```

> ⚠️ **C++ 对照**：C++ 默认生成动态链接可执行文件，目标机必须带好 `.so` 与匹配的 libc 版本；Go 默认（cgo 关）就是**静态链接**。代价与取舍见 3.3。

### 3.2 多阶段 Dockerfile（核心模式）

Docker 多阶段构建让「编译环境大、运行环境小」成为可能：

```dockerfile
# 阶段一：builder —— 只要编译产物
FROM golang:1.22-alpine AS builder

# 依赖证书（静态二进制访问 HTTPS 需要）
RUN apk add --no-cache ca-certificates && update-ca-certificates

WORKDIR /build
# 先拷贝 go.mod/go.sum 利用 Docker 层缓存（依赖层几乎不变）
COPY go.mod go.sum ./
RUN go mod download

# 拷贝源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w" -o /app ./cmd/server

# 阶段二：scratch —— 极简运行镜像
FROM scratch

# 证书与时区数据（scratch 什么都没有）
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# 非 root 运行
USER 65534:65534

# 拷进单文件二进制
COPY --from=builder /app /server

EXPOSE 8080
ENTRYPOINT ["/server"]
```

**关键点解析**：

- `FROM golang:... AS builder`：编译镜像可以大（含 Go 工具链）
- `FROM scratch`：**运行镜像从零开始**，只含我们拷进去的文件
- `COPY go.mod go.sum . && go mod download`：依赖层独立，源码改动不触发整层重编（镜像缓存友好）
- `CGO_ENABLED=0`：确保静态
- `USER 65534:65534`：普通用户 `nobody`，无 root 攻击面（C++ 部署常忘这步）

### 3.3 CGO_ENABLED=0 vs 1：取舍

| 维度 | CGO_ENABLED=0（推荐默认） | CGO_ENABLED=1 |
|------|---------------------------|---------------|
| 链接方式 | 纯静态 | 动态链接 libc 等 |
| 运行环境 | 任意 Linux（含不匹配 glibc 的） | 依赖基础镜像 libc |
| 可用能力 | 纯 Go（net 用纯 Go 实现） | 可调 C 库（sqlite3、oracle、专有 SDK） |
| 镜像体积 | 更小、无兼容性坑 | 需带 libc 的基础镜像 |
| 适用 | 绝大多数 Web/微服务 | 必须 cgo 的库（如达梦、oracle 驱动） |

判断点：**只有不得不调 C 库时才开 cgo**（比如某些数据库驱动、图像库）。纯 Go 的 `net`/`crypto` 都自带实现，无需 cgo。

> **C++ 对照**：cgo 等价于自己链接 `/lib/x86_64-linux-gnu/libc.so.6`；它把 C++ 世界的「目标机 libc 版本」问题带回来。所以默认 `CGO_ENABLED=0`，GO 的部署优势才成立。

### 3.4 镜像体积优化清单

| 手段 | 效果 | 说明 |
|------|------|------|
| scratch 基础镜像 | GB→10MB 级 | 只拷二进制 + 证书 |
| `-ldflags "-s -w"` | 再减 30~50% | strip 符号与调试信息 |
| `CGO_ENABLED=0` | 免带 libc | 动态链接会拖进 libgcc/libc |
| 多阶段构建 | 编译层不进产物层 | Docker 自动只保留末层 |
| 需要调试/工具时 | 用 alpine 而非 ubuntu | alpine 自带 sh + busybox |
| 压缩器（可选） | 额外 50% | `upx app`，但会拖慢启动、可能误报杀软 |

衡量：`docker images` 看 `REPOSITORY SIZE`；`docker history` 看每层大小。目标是**只保留能跑的**。

### 3.5 健康检查 HEALTHCHECK

```dockerfile
# 在 Dockerfile 里声明，交给 Docker 周期检查
HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
```

服务端 Go 程序配套实现：

```go
// cmd/server/main.go 里注册健康端点
http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte("ok"))
})
```

场景：容器编排（Compose/K8s）据此决定重启/下线实例。

### 3.6 docker run 与 Compose 部署

```bash
# 单容器运行（-p 端口映射，--env 传配置）
docker build -t myapp:1.0.0 .
docker run -d --name myapp -p 8080:8080 \
  --env APP_PORT=8080 \
  myapp:1.0.0

# 查看健康状态
docker ps
docker inspect --format='{{.State.Health.Status}}' myapp
```

多服务用 `docker-compose.yml`：

```yaml
# docker-compose.yml
version: "3.8"
services:
  api:
    build: .
    image: myapp:1.0.0
    ports:
      - "8080:8080"
    environment:
      - APP_PORT=8080
      - DB_DSN=host=db;user=app;password=secret;dbname=app
    depends_on:
      - db
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
      interval: 5s
      timeout: 3s
      retries: 3

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=secret
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```bash
docker compose up -d          # 起服务
docker compose logs -f api    # 看日志
docker compose down           # 停
```

> **C++ 对照**：C++ 服务通常配 systemd unit 文件管理进程生命周期；Compose 提供的是同样的「这一套服务怎么起」声明——但还顺带管了网络、依赖顺序、卷。

### 3.7 集 CI 简笔（GitHub Actions 示例）

CI 的作用：提交即验证 + 产出镜像。

```yaml
# .github/workflows/build.yml（节选）
name: build

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: |
          go vet ./...
          go test -race ./...
          CGO_ENABLED=0 go build -ldflags "-s -w" -o app ./cmd/server
      - uses: docker/build-push-action@v6
        with:
          push: false
          tags: myapp:ci-${{ github.sha }}
```

本地即可预演 CI 的校验链（同 [[04-常用工具]] 的体检四连）：

```bash
gofmt -l . && go vet ./... && go test -race ./... && CGO_ENABLED=0 go build ./cmd/server
```

### 3.8 部署形态小结与对照

| 部署方式 | C++ 常见做法 | Go 对应 |
|----------|--------------|---------|
| 裸机/VM | 装库 → 拷贝 so/bin → systemd | 拷二进制 + systemd 即可 |
| 容器 | 大镜像 + 手动装依赖 | 多阶段 scratch 小镜像 |
| 镜像体积 | 500MB~1GB 常见 | 10~30MB 常见 |
| arm/多平台 | 交叉工具链较重 | `GOOS=linux GOARCH=arm64` 一步 |

### 3.9 三类基础镜像：scratch / alpine / distroless

| 方案 | 内容 | 体积 | 适合场景 |
|------|------|------|----------|
| `scratch` | 空镜像 | 最小（几 MB + 应用） | 纯 Go 静态二进制、对体积极敏感 |
| `alpine` | busybox + musl 工具 | 中等 | 需要 shell/wget/ping 排查问题 |
| `distroless`（Google） | 运行库最小集，无 shell/包管理器 | 略大于 scratch | 要「非 root 安全 + 依赖完整」，信任 Google 制 |

`FROM scratch` 能跑的前提是二进制**完全静态**；只要有一点动态链接就崩。需要 shell 时改用：

```dockerfile
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app /server
USER 10001
ENTRYPOINT ["/server"]
```

> **C++ 对照**：C++ 几乎不可能用 scratch（目标机得带 libc++/libstdc++/libc）；只能退到 debian/ubuntu 装依赖，体积量级天然差 20 倍。这就是「静态二进制 + scratch」是 Go 专属红利的原因。

### 3.10 多平台镜像：一镜像多 CPU

Linux 服务器 + ARM 开发板共存时，用 Docker `buildx` 打出多平台镜像：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t myapp:multi \
  --push .   # 推送到 registry 后，拉取方按运行平台自动取对应版本
```

Dockerfile 里注意两点就能多平台顺利构建：

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder
# 拷贝源码时排除平台无关的 vendor 缓存等
# 编译阶段用 TARGETOS/TARGETARCH 传参：
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags "-s -w" -o /app ./cmd/server
```

> ⚠️ **C++ 对照**：等价 CMake 多架构交叉构建矩阵，但 Go 只要两行 ARG，无需每架构一套工具链。

### 3.11 配置从环境变量来：代码侧配合

镜像化的 Go 服务，配置一律走环境变量（运行环境注入），而不是读「镜像内文件」：

```go
// internal/config/config.go
func FromEnv() *Config {
	port := os.Getenv("APP_PORT")
	if port == "" {
		port = "8080" // 默认值兜底
	}
	return &Config{
		Port: port,
		DSN:  os.Getenv("DB_DSN"), // 必填项不给默认，启动时校验
	}
}
```

启动时校验必填：

```go
func (c *Config) Validate() error {
	if c.DSN == "" {
		return errors.New("DB_DSN 未设置")
	}
	return nil
}
```

配合 Compose 的 `environment:` 或 `docker run --env-file .env` 注入，同一镜像在不同环境只换变量。**敏感值（密码/token）不要写进 `.env` 进 git**——用 docker secret / CI 的 secret 注入。

### 3.12 发布全链路回放（从提交到线上）

```bash
# 1. 本地体检（等价 CI 第一步）
gofmt -l . && go vet ./... && go test ./... -race

# 2. 本地构建 + 手工冒烟
CGO_ENABLED=0 go build -ldflags "-s -w" -o app ./cmd/server
./app &            # 本地起，curl /healthz 看 200

# 3. 构建镜像
docker build -t myapp:1.0.0 .
docker run -d --name smoke -p 8080:8080 -e DB_DSN="..." myapp:1.0.0
curl -f http://127.0.0.1:8080/healthz

# 4. 推送 registry（CI 中触发）
docker tag myapp:1.0.0 registry.example.com/myapp:1.0.0
docker push registry.example.com/myapp:1.0.0

# 5. 服务器拉取并 run（或 compose up）
```

这套流程里，「产物」从「一堆 .so + 配置 + systemd unit」变成了「**一个不可变镜像**」，回滚即换 tag 重新 run——这是 Go 相对 C++ 部署模型（libtool + 安装脚本 + 手动管理依赖）最舒服的一环。

---

## 四、常见坑与误区

### 坑 1：忘 `CGO_ENABLED=0`，二进制依赖 libc，scratch 里跑不了

- **现象**：镜像构建成功但 `docker run` 直接退出；`docker logs` 里 `exec format error` 或无任何输出。`ldd` 显示动态链接。
- **原因**：不加环境变量会默认开 cgo，链接 glibc；scratch 镜像没有 glibc。
- **正确写法**：编译时显式 `CGO_ENABLED=0`（或在 Dockerfile builder 段配置）。

### 坑 2：scratch 里 HTTPS 握手失败（证书缺失）

- **现象**：程序对外 `https://` 请求报 `x509: certificate signed by unknown authority`。
- **原因**：scratch 没有 CA 证书文件；Go 静态构造信任根来自文件系统。
- **正确写法**：`COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/`（见 3.2 Dockerfile）。

### 坑 3：多阶段构建没分段，把 Go 工具链一起打进产物

- **现象**：镜像巨大（几百 MB），`docker history` 里满屏 `COPY . .` + 工具链层。
- **原因**：只用一个 `FROM golang:...`。
- **正确写法**：`builder` 阶段编译，`scratch`/`alpine` 阶段只拷 `app` + 证书。

### 坑 4：时间变成 UTC/时区错误

- **现象**：日志时间与本地差 8 小时。
- **原因**：scratch 没任何时区数据，默认 UTC。
- **正确写法**：按业务需要 `COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo` + 设 `TZ=Asia/Shanghai`；纯微服务推荐统一 UTC 记录。

### 坑 5：root 运行，产生安全面

- **现象**：镜像内进程是 root，被黑后容器权限过大。
- **原因**：默认 `USER` 未设置。
- **正确写法**：`USER 65534:65534`（nobody）+ 只暴露必要端口；配合 `--cap-drop ALL`。

### 坑 6：配置用环境变量 → 镜像硬编码

- **现象**：换个环境（测试/生产）要重新 build。
- **原因**：把地址/密码写死在二进制或镜像 env。
- **正确写法**：配置从 `os.Getenv` 读取，Compose/编排注入；敏感值走 docker secret / K8s secret。

### 坑 7：`HEALTHCHECK` 反复失败却被忽略

- **现象**：编排认为容器 healthy，但探针从未成功。
- **原因**：`/healthz` 只注册了但不检查依赖（DB 断连还挺着 200）。
- **正确写法**：健康端点返回**真实依赖状态**（DB/ping 失败→503），探针配 `--interval` 与 `--retries` 并观察 `docker ps` 状态列。

### 坑 8：`go build` 带 cgo 却未经 `-ldflags "-s -w"`，体积暴涨

- **现象**：`CGO_ENABLED=1` 下 50MB+ 且 `ldd` 冒出一堆。
- **原因**：动态链接把 libc 及相关库的符号带进来；没 strip。
- **正确写法**：确认目标机 libc 匹配；或用 `scratch`/`distroless` 镜像；纯粹 Go 功能直接关 cgo。

---

## 五、练习任务

- [ ] 选一个你之前写过的小 Go HTTP 服务，用 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w"` 产出静态二进制，`file`/`ldd` 验证「statically linked」
- [ ] 写多阶段 Dockerfile（builder → scratch），构建后 `docker images` 记录体积，再对照用 golang 单阶段构建的体积差
- [ ] 给服务实现 `/healthz`，Dockerfile 加 `HEALTHCHECK`，用 `docker inspect` 观察 unhealthy→healthy 过渡
- [ ] 用 `docker run --env` 注入配置（端口/DSN），把程序改为从 `os.Getenv` 读取，验证换环境不 rebuild
- [ ] 对照 C++ 部署经验：把你印象最深的一次「C++ 部署跑不起来」（缺 .so / glibc 版本）写成笔记中的对比段落，说明 Go 场景为何不会发生
- [ ] 用 docker compose 编排一个「api + postgres」双服务，验证依赖顺序与日志采集
- [ ] 基线练习：`go build` 基础产物 vs `-ldflags "-s -w"` vs `upx` 三版体积对比，记录数字

---

## 六、延伸与参考

- Docker 官方文档：[Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- Go 官方文档：[Cross-compilation / 部署相关](https://go.dev/solutions#cross-platform)
- Google 维护的精简镜像：[distroless（替代 scratch 的方案）](https://github.com/GoogleContainerTools/distroless)
- Docker 官方文档：[Dockerfile 参考（ENV/USER/HEALTHCHECK）](https://docs.docker.com/reference/dockerfile/)

相关笔记：

- [[04-常用工具-gofmt-vet-doc-交叉编译]] —— 交叉编译与 ldflags 是创造静态二进制的前置
- [[01-go-mod依赖管理]] —— 依赖下载保证镜像缓存可复现
- [[03-项目结构-internal-pkg-cmd]] —— cmd/ 入口让多服务（一个仓库多 cmd）镜像化更顺
- [[02-测试-单元-表格驱动-基准-覆盖率]] —— CI 里 `go test -race` 是发布前的守门员