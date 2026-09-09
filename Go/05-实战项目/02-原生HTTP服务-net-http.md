# 02 - 原生 HTTP 服务 net/http

> 从 C++ 的 Boost.Beast / Crow 到 Go：标准库就是一套完整的 HTTP 服务器，Handler 即函数签名

---

## 一、简述

在 C++ 里写 HTTP 服务要选库（Boost.Beast 偏底层、Crow 要自己搭路由、Drogon 大而全），而在 Go 里**标准库 `net/http` 就是一个能上生产的基础 HTTP 服务框架**——路由、请求解析、响应写出、超时控制、优雅关闭全都有。它的核心哲学是「一个 `http.Handler` 就是一个 http.ResponseWriter 参数 + 一个 *http.Request 参数的函数」，一切中间件、路由、框架都是这个接口的装饰与组合。

> **核心要点**：`Handler` 是唯一的核心接口。Go 1.22 起 `http.ServeMux` 原生支持「方法 + 路径」路由（`"GET /users/{id}"`），标准库写 REST 服务不再需要任何第三方框架。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| HTTP 库 | Boost.Beast / Crow / Drogon / cpp-httplib | `net/http` 标准库 | 开箱即用，零依赖起服务 |
| 处理器 | 继承 handler / 回调 | `http.Handler` 接口 + `http.HandlerFunc` | 函数签名即处理器 |
| 路由 | Crow 手动匹配 / router 库 | `http.NewServeMux` | Go 1.22+ 支持方法路由 |
| 路径参数 | `:id` 需框架支持 | `r.PathValue("id")` | ServeMux 通配符 `{id}` |
| 服务对象 | `Crow::run()` | `http.Server` 结构体 | 超时/监听全是 Server 字段 |
| 会话/keep-alive | 手管 socket | 自动，`IdleTimeout` 管空闲连接 | 默认开启 |
| JSON 响应 | 序列化库 + 手动 header | `json.NewEncoder(w).Encode(v)` | 一行流式写出 |
| 中间件 | 手写装饰器 / Crow 外挂 | `func(http.Handler) http.Handler` | 纯函数包裹，标准模式 |
| 优雅关闭 | 自行实现 | `srv.Shutdown(ctx)` | 标准库内置，等待在飞请求 |

---

## 三、逐主题详解

### 3.1 最小 HTTP 服务 —— Handler 与 HandlerFunc

任何 HTTP 服务都绕不开这两个类型：

- `http.Handler`：接口，只有一个方法 `ServeHTTP(w http.ResponseWriter, r *http.Request)`；
- `http.HandlerFunc`：函数类型，**让普通函数也能当 Handler** 用的适配器。

```go
package main

import (
	"fmt"
	"log"
	"net/http"
)

// 普通函数，签名与 HandlerFunc 一致
func hello(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, %s!\n", r.URL.Path)
}

func main() {
	// http.HandleFunc 内部把函数转成 HandlerFunc，再注册进默认的 DefaultServeMux
	http.HandleFunc("/hello", hello)

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil)) // nil = 使用 DefaultServeMux
}
```

与 C++ 最大的差异：**没有任何「框架启动魔法」**。`ListenAndServe` 即监听即服务，`nil` 表示「用全局默认的那棵路由树」。

> **C++ 对照**：Boost.Beast 你得自己解析 HTTP 报文、手写回调处理连接；net/http 把 accept、解析、路由、响应封装的干干净净，就像 Crow 的 `CROW_ROUTE` 宏帮你把一切接好——只不过 Go 这是标准库。

Handler 也可以显式写成结构体（实现接口），适合把状态挂进处理器：

```go
type Greeter struct {
	Greeting string
}

func (g *Greeter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "%s, %s!\n", g.Greeting, r.URL.Path)
}

// 注册一个带状态的 Handler
g := &Greeter{Greeting: "你好"}
http.Handle("/", g)
```

### 3.2 http.NewServeMux —— 路由器与 Go 1.22 方法路由

`http.NewServeMux` 创建一棵独立的路由树（**不污染全局 DefaultServeMux**，测试、多服务共进程时更干净）。

Go 1.22 的重要升级：pattern 里可以写 **方法 + 路径 + 通配符**，且支持路径参数：

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type User struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func main() {
	mux := http.NewServeMux()

	// 路径字面量 + 方法限定
	mux.HandleFunc("GET /api/users", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]User{{ID: 1, Name: "Tom"}})
	})

	// 路径参数 {id}，运行时用 r.PathValue 取
	mux.HandleFunc("GET /api/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		json.NewEncoder(w).Encode(User{ID: 1, Name: "用户" + id})
	})

	// POST 也能限定方法（不认识的方法直接 405）
	mux.HandleFunc("POST /api/users", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

几个关键规则：

- `"GET /path"` 表示「GET 且路径匹配」；不带方法的 `"/path"` 匹配所有方法；
- `{id}` 是单段通配符，`/files/{path...}` 是通配**多段**路径；
- 路径与方法都不匹配时自动返回 405 / 404；
- 更具体的 pattern 优先（`/api/users/me` 优先于 `/api/users/{id}`）。

> ⚠️ 方法路由（`"GET /path"` 这种写法）要求 **Go 1.22+**。2024 年后主流 Go 版本都满足；老项目升级时注意 `net/http` 行为差异（旧版 `"/api/users/{id}"` 会被当普通字符串路径，通配符不生效）。

### 3.3 http.Server —— 超时与连接控制

裸的 `ListenAndServe` 用的是零配置；生产上**必须**用 `http.Server` 结构体显式施加超时，否则慢连接会拖垮进程：

```go
package main

import (
	"log"
	"net/http"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	srv := &http.Server{ // 注意是结构体，不是函数
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,   // 读取完整请求体的超时
		WriteTimeout: 10 * time.Second,  // 写出响应的超时
		IdleTimeout:  60 * time.Second,  // keep-alive 空闲连接保留时间
		MaxHeaderBytes: 1 << 20,         // 请求头上限 1MB
	}

	log.Printf("server on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
```

| 字段 | 作用 | 不设置的后果 |
|------|------|--------------|
| `ReadTimeout` | 读请求（含 body）超时 | 慢速攻击者可占用连接 |
| `ReadHeaderTimeout` | 读请求头超时 | 同上，且更基础 |
| `WriteTimeout` | 写响应超时 | 慢客户端拖住 goroutine |
| `IdleTimeout` | 空闲 keep-alive 连接关闭时间 | 连接被长期占着 |

> **C++ 对照**：等价于手写 socket 时给 `SO_RCVTIMEO`/`SO_SNDTIMEO`、给 acceptor 设置非阻塞 + 超时轮询——但那些要自己算好读一半怎么办。Go 的 Server 字段把这些语义打包成声明式配置。

### 3.4 REST JSON 返回 —— Marshal 与 Encoder

JSON 响应在 Go 里有两种写法，推荐**流式 Encoder**：

```go
package main

import (
	"encoding/json"
	"net/http"
)

type Resp struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data any    `json:"data"`
}

func ok(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(Resp{Code: 0, Msg: "ok", Data: data})
}

func fail(w http.ResponseWriter, status int, errMsg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(Resp{Code: status, Msg: errMsg})
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/user", func(w http.ResponseWriter, r *http.Request) {
		ok(w, map[string]string{"name": "Tom", "role": "admin"})
	})

	mux.HandleFunc("GET /api/missing", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "user not found")
	})

	http.ListenAndServe(":8080", mux)
}
```

两种写法的区别：

- `json.Marshal(v)` → 先序列化成 `[]byte`，再 `w.Write`。额外占一块内存；
- `json.NewEncoder(w).Encode(v)` → 直接流式写到 `w`，还**自动追加 `\n`**。一般服务推荐后者。

> **C++ 对照**：`json.NewEncoder(w).Encode(v)` 近似「把 json 序列化结果直接喂给响应流」，而 C++ 里一般先 `j.dump()` 成一个 string 再设置 body——Go 少一次整块拷贝。

> ⚠️ `w.WriteHeader` 必须在第一次 `Write`/`Encode` **之前**调用，且只能调一次。先写 body 再 WriteHeader 会打出 `http: superfluous WriteHeader` 警告且无效。

### 3.5 中间件模式 —— 包装 Handler

「中间件就是一层洋葱」：一个 `func(http.Handler) http.Handler`，它把外层的通用逻辑（日志、鉴权、CORS、恢复 panic）包在 next 之外：

```go
package main

import (
	"log"
	"net/http"
	"time"
)

// 记录日志的中间件：包一层，执行自动记日志
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r) // 调用链往下走
		log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// 设置统一响应头
func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "go-demo")
		next.ServeHTTP(w, r)
	})
}

// 恐慌恢复：防止单个 panic 挂掉整个进程
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("panic: %v", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("home"))
	})

	// 多层包装：执行的顺序是 recoverer → withHeaders → logging → mux
	app := recoverer(withHeaders(logging(mux)))

	http.ListenAndServe(":8080", app)
}
```

> **C++ 对照**：这就是「装饰器模式」的 Go 写法。C++ 里用继承或 std::function 包一层；Go 里因为 Handler 只是接口，包装就是「返回一个新 Handler 的函数」，嵌套可读，也常见到别人封装成 `Middleware` 切片 `for i := len(m)-1; i >= 0; i-- { h = m[i](h) }` 循环套。

### 3.6 优雅关闭 Shutdown

线上发版不能直接 kill 进程——在飞请求会断。标准做法：监听 `SIGINT`/`SIGTERM`，然后 `Shutdown`：

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello"))
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}

	// 后台启动
	go func() {
		log.Printf("server on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	// 等待退出信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("收到退出信号，开始优雅关闭...")

	// 给在飞请求最多 10s 收尾，然后强制结束
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown: %v", err)
	}
	log.Println("server stopped")
}
```

`Shutdown` 的行为：立即停止接受新连接，等已有连接处理完（或超时）才返回。返回 `nil` 代表干净退出。相比 C++ 往往要用信号处理 + 手动 close acceptor，Go 标准库一条调用链搞定。

---

## 四、常见坑与误区

### 坑 1：`WriteHeader` 在 Write 之后调用

- **现象**：日志出现 `http: superfluous WriteHeader call`，状态码没生效。
- **原因**：`w.Write` 会先隐式把状态码写为 `200`（并发送 header），之后再调 `WriteHeader` 就晚了。
- **正确写法**：设置 header → 需要时 `w.WriteHeader(status)` → 最后才 `w.Write` / `Encode`。

### 坑 2：忘记设置 `Content-Type`

- **现象**：浏览器里 JSON 显示成纯文本或触发下载。
- **原因**：不设置时 Go 很聪明地由 `Encode` 自动检测类型，但自定义响应（尤其先 `WriteHeader` 再 Write body）不会自动猜。
- **正确写法**：写 JSON 前 `w.Header().Set("Content-Type", "application/json; charset=utf-8")`。

### 坑 3：`http.ListenAndServe` 的 error 被忽略

- **现象**：端口被占用时没有任何输出，程序静默退出。
- **原因**：`ListenAndServe` 出错返回 error，直接裸调用会丢。
- **正确写法**：用 `log.Fatal(http.ListenAndServe(...))`，或 `srv.ListenAndServe()` 后检查 error。

### 坑 4：生产环境没设 ReadTimeout / WriteTimeout

- **现象**：慢速连接/慢客户端把连接占死，goroutine 越积越多。
- **原因**：默认 0 = 不超时。
- **正确写法**：`http.Server` 里显式设 `ReadHeaderTimeout`、`ReadTimeout`、`WriteTimeout`、`IdleTimeout`。

### 坑 5：在 Handler 里直接对 map / 共享变量并发写

- **现象**：并发请求下偶发 `concurrent map writes`（直接 panic）。
- **原因**：每个请求一个 goroutine，handler 并发执行；无锁共享状态必炸。
- **正确写法**：把状态放结构体 + `sync.Mutex`/`sync.RWMutex`；或**每个 Handler 用闭包/方法持有只读配置**，可变状态走数据库/原子操作。

### 坑 6：方法路由的路径参数用错 `r.URL.Path` 手工解析

- **现象**：`/api/users/123` 反复 split，还容易漏 `{id}` 的「多段」语义。
- **原因**：用了 1.22 之前的习惯，手工字符串处理。
- **正确写法**：路由写 `"GET /api/users/{id}"`，handler 里 `r.PathValue("id")` 一步取；需要通配多段用 `{path...}`。

### 坑 7：直接返回错误会让用户看到泄露内部信息的 `http.Error`

- **现象**：把底层 err 原样 `http.Error(w, err.Error(), 500)`，SQL 细节暴露给客户端。
- **原因**：`http.Error` 的 msg 直接进响应体。
- **正确写法**：日志里记 `err`，客户端只回通用消息（`"internal error"`），详见 [[02-错误处理-error-panic-recover]] 的 error 包装思路。

---

## 五、练习任务

- [ ] 写最小服务：`GET /` 返回 `Hello`，`curl` 验证；用 `http.ServeMux` 替换默认 mux
- [ ] 用 Go 1.22 方法路由实现用户 REST：`GET/POST /api/users`、`GET /api/users/{id}`，验证 404/405 行为
- [ ] 给所有响应包一层统一 JSON 骨架（`code/msg/data`）——参考 3.4 的 `ok`/`fail`
- [ ] 实现三层中间件：日志、CORS（加 `Access-Control-Allow-Origin`）、panic 恢复，用嵌套与循环两种方式组装
- [ ] **对照 C++ 重写**：把之前用 Crow / Boost.Beast / cpp-httplib 写的任一小 HTTP 服务，用 net/http 重写，比较代码量与超时/关闭的处理
- [ ] 实现优雅关闭：`Ctrl+C` 时打印「收到信号→正在收尾」并干净退出，验证 `curl` 一个慢请求不会断
- [ ] 用 `httptest.NewRecorder` 给 handler 写单元测试（不真实起端口）

---

## 六、延伸与参考

- net/http 官方文档：<https://pkg.go.dev/net/http>
- Go 1.22 ServeMux 新特性与模式说明（官方博文）：<https://go.dev/blog/routing-enhancements>
- 官方《Go by Example: HTTP Server》：<https://gobyexample.com/http-servers>
- `httptest` 包（handler 单测的标配）：<https://pkg.go.dev/net/http/httptest>
- 相关笔记：[[01-CLI工具-flag与cobra]] · [[03-Web框架-Gin-Echo]] · [[05-综合项目实战记录]]