<#
.SYNOPSIS
自动执行 qt-doc-manual-tests.md 的手动测试用例 (A-E 全量)。

.DESCRIPTION
每个用例调用 `opencode run --format json`,从 JSON 事件流解析:
- 是否加载了 qt-doc skill (tool_use / tool=skill / input.name=qt-doc)
- 会话 ID (用于会话延续测试)

A/B 类用全新会话; C/D1/E 类自动延续已开启专家模式的会话 A;
D2 用全新会话 B, D3 继续会话 B。

优化点:
- 失败用例自动重试 (排除 LLM 偶发随机性), 结果标注尝试次数
- 自动生成 markdown 报告 (与脚本同目录, 含结果表格与失败详情)

.PARAMETER Opencode
opencode 命令, 默认 "opencode"。

.PARAMETER TimeoutSec
单次 opencode run 的超时秒数, 默认 240。

.PARAMETER SkipE
跳过 E 类(输出质量)用例。

.PARAMETER MaxRetry
失败用例的最大重试次数, 默认 2 (0=不重试)。

.PARAMETER ReportPath
报告输出路径, 默认与脚本同目录的 qt-doc-auto-report-<时间戳>.md。

.PARAMETER NoReport
不生成报告文件。

.EXAMPLE
.\run-qt-doc-tests.ps1

.EXAMPLE
.\run-qt-doc-tests.ps1 -SkipE -MaxRetry 3

.EXAMPLE
.\run-qt-doc-tests.ps1 -NoReport
#>

param(
    [string]$Opencode = "opencode",
    [int]$TimeoutSec = 240,
    [switch]$SkipE,
    [int]$MaxRetry = 2,
    [string]$ReportPath = "",
    [switch]$NoReport
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$script:sessionA = $null
$script:sessionB = $null
$script:results = @()
$script:startTime = Get-Date

function Invoke-OpencodeRun {
    param(
        [string]$Message,
        [string]$SessionID = ""
    )

    $opArgs = @("run", "--format", "json")
    if ($SessionID) { $opArgs += @("-s", $SessionID) }
    $opArgs += $Message

    Write-Host ("  >> opencode run {0}{1}" -f $(if ($SessionID) { "-s $SessionID " } else { "" }), $Message) -ForegroundColor DarkGray

    $lines = & $Opencode @opArgs 2>$null
    $events = @()
    foreach ($line in $lines) {
        $t = $line.Trim()
        if (-not $t) { continue }
        try {
            $obj = $t | ConvertFrom-Json
            if ($obj -and $obj.type) { $events += $obj }
        } catch {
            # 忽略无法解析的行
        }
    }

    if ($events.Count -eq 0) {
        throw "未解析到任何 JSON 事件, 请检查 opencode 命令可用性。"
    }

    return $events
}

function Get-SessionID {
    param($Events)
    if ($Events.Count -gt 0) { return $Events[0].sessionID }
    return $null
}

function Test-SkillTriggered {
    param($Events)
    foreach ($e in $Events) {
        if ($e.type -eq "tool_use" -and
            $e.part.tool -eq "skill" -and
            $e.part.state.input.name -eq "qt-doc") {
            return $true
        }
    }
    return $false
}

function Get-AllText {
    param($Events)
    $sb = New-Object System.Text.StringBuilder
    foreach ($e in $Events) {
        if ($e.type -eq "text" -and $e.part.text) {
            [void]$sb.AppendLine($e.part.text)
        }
    }
    return $sb.ToString()
}

function Test-ExpertActive {
    param($Events)
    # 信号 1: 重新加载了 qt-doc skill
    if (Test-SkillTriggered -Events $Events) { return $true }
    # 信号 2: 调用了 qt_fetch.py 抓文档
    foreach ($e in $Events) {
        if ($e.type -eq "tool_use" -and $e.part.tool -eq "bash" -and
            $e.part.state.input.command -match "qt_fetch\.py") {
            return $true
        }
    }
    # 信号 3: 输出文本以 [qt-doc] 前缀标识 (会话内持续生效的直接表现)
    $text = Get-AllText -Events $Events
    if ($text -match "\[qt-doc\]") { return $true }
    return $false
}

function Add-Result {
    param(
        [string]$ID,
        [string]$Category,
        [string]$Expected,
        [bool]$Pass,
        [string]$Detail,
        [int]$Attempt = 1
    )
    $retried = $Attempt -gt 1
    $script:results += [PSCustomObject]@{
        ID       = $ID
        Category = $Category
        Expected = $Expected
        Pass     = $Pass
        Attempt  = $Attempt
        Retried  = $retried
        Detail   = $Detail
    }
    $mark = if ($Pass) { "PASS" } else { "FAIL" }
    $color = if ($Pass) { "Green" } else { "Red" }
    $attemptTag = if ($retried) { " (尝试 $Attempt 次)" } else { "" }
    Write-Host ("[{0}] {1} expect={2}{3}" -f $mark, $ID, $Expected, $attemptTag) -ForegroundColor $color
    if ($Detail) { Write-Host ("      " + $Detail) -ForegroundColor Gray }
}

function Invoke-Case {
    param(
        [string]$ID,
        [string]$Category,
        [string]$Expected,
        [scriptblock]$Test,
        [int]$MaxRetry = 2
    )
    $attempt = 0
    $pass = $false
    $detail = ""
    while ($true) {
        $attempt++
        try {
            $r = & $Test
            if ($null -eq $r) { throw "测试脚本块未返回结果" }
            $pass = [bool]$r.Pass
            $detail = [string]$r.Detail
        } catch {
            $pass = $false
            $detail = "异常: " + $_.Exception.Message
        }
        if ($pass -or $attempt -gt $MaxRetry) { break }
        Write-Host ("  [重试 {0}] {1} 失败, 重新执行..." -f $attempt, $ID) -ForegroundColor Yellow
    }
    if (-not $pass) {
        $detail = "重试 $attempt 次后仍失败。$detail"
    } elseif ($attempt -gt 1) {
        $detail = "首测失败, 重试 $($attempt-1) 次后通过。$detail"
    }
    Add-Result -ID $ID -Category $Category -Expected $Expected -Pass $pass -Detail $detail -Attempt $attempt
}

function New-Pass {
    param($Detail)
    return @{ Pass = $true; Detail = $Detail }
}

function New-Fail {
    param($Detail)
    return @{ Pass = $false; Detail = $Detail }
}

Write-Host "=================== qt-doc skill 自动化测试 ===================" -ForegroundColor Cyan
Write-Host "开始时间: $($script:startTime.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "重试上限: $MaxRetry   E 类: $(if ($SkipE) { '跳过' } else { '执行' })"
Write-Host ""

# ========== 阶段 B: 零误触发 (全新会话) ==========
Write-Host "--- B 类: 零误触发 (新会话, 期望不触发) ---" -ForegroundColor Yellow
$bCases = @(
    @{ id = "B1"; msg = "查一下 QTcpSocket 怎么用" },
    @{ id = "B2"; msg = "Java 里线程和进程的区别" },
    @{ id = "B3"; msg = "React 里定时器怎么用" },
    @{ id = "B4"; msg = "Python 的 list 和 tuple 区别" },
    @{ id = "B5"; msg = "什么是线程池" },
    @{ id = "B6"; msg = "用 Qt 写个界面" }
)
foreach ($c in $bCases) {
    Invoke-Case -ID $c.id -Category "B" -Expected "not-triggered" -MaxRetry $MaxRetry -Test {
        $ev = Invoke-OpencodeRun -Message $c.msg
        $trig = Test-SkillTriggered -Events $ev
        if ($trig) { return (New-Fail "意外触发了 qt-doc skill") }
        return (New-Pass "OK, 未触发")
    }
}

# ========== 阶段 A: 触发正确性 (全新会话) ==========
Write-Host ""
Write-Host "--- A 类: 触发正确性 (新会话, 期望触发) ---" -ForegroundColor Yellow
$aCases = @(
    @{ id = "A1"; msg = "开启Qt专家模式" },
    @{ id = "A2"; msg = "进入Qt专家模式" },
    @{ id = "A3"; msg = "Qt专家模式" },
    @{ id = "A4"; msg = "开启 Qt 专家模式" }
)
foreach ($c in $aCases) {
    Invoke-Case -ID $c.id -Category "A" -Expected "triggered" -MaxRetry $MaxRetry -Test {
        $ev = Invoke-OpencodeRun -Message $c.msg
        $trig = Test-SkillTriggered -Events $ev
        if ($c.id -eq "A1") { $script:sessionA = Get-SessionID -Events $ev }
        if ($trig) { return (New-Pass "OK, 已触发") }
        return (New-Fail "未触发 skill")
    }
}
Write-Host ("  会话 A (已开启专家模式): {0}" -f $script:sessionA) -ForegroundColor DarkGray

# ========== 阶段 C: 会话内持续生效 (延续会话 A) ==========
Write-Host ""
Write-Host "--- C 类: 会话内持续生效 (延续会话 A) ---" -ForegroundColor Yellow
if ($script:sessionA) {
    $cCases = @(
        @{ id = "C1"; msg = "查一下线程怎么用";      expect = $true },
        @{ id = "C2"; msg = "QTimer 和信号槽怎么配合"; expect = $true },
        @{ id = "C3"; msg = "窗口布局用什么类";      expect = $true },
        @{ id = "C4"; msg = "Java 的 HashMap 原理"; expect = $false }
    )
    foreach ($c in $cCases) {
        Invoke-Case -ID $c.id -Category "C" -Expected $(if ($c.expect) { "active" } else { "not-active" }) -MaxRetry $MaxRetry -Test {
            $ev = Invoke-OpencodeRun -Message $c.msg -SessionID $script:sessionA
            $active = Test-ExpertActive -Events $ev
            if ($active -eq $c.expect) { return (New-Pass "OK") }
            return (New-Fail "预期=生效, 实际未生效; 或预期不生效, 实际生效")
        }
    }
} else {
    Write-Host "  未获取会话 A, 跳过 C 类" -ForegroundColor Red
    Add-Result -ID "C1" -Category "C" -Expected "active" -Pass $false -Detail "会话 A 未获取"
    Add-Result -ID "C2" -Category "C" -Expected "active" -Pass $false -Detail "会话 A 未获取"
    Add-Result -ID "C3" -Category "C" -Expected "active" -Pass $false -Detail "会话 A 未获取"
    Add-Result -ID "C4" -Category "C" -Expected "not-active" -Pass $false -Detail "会话 A 未获取"
}

# ========== 阶段 D: 会话隔离 ==========
Write-Host ""
Write-Host "--- D 类: 会话隔离 ---" -ForegroundColor Yellow
# D1: 复用 C1 (会话 A 恢复后仍生效), 单独再验证一次
if ($script:sessionA) {
    Invoke-Case -ID "D1" -Category "D" -Expected "active" -MaxRetry $MaxRetry -Test {
        $ev = Invoke-OpencodeRun -Message "查一下线程怎么用" -SessionID $script:sessionA
        $active = Test-ExpertActive -Events $ev
        if ($active) { return (New-Pass "会话 A 恢复后专家模式仍生效") }
        return (New-Fail "会话 A 恢复后未生效")
    }
} else {
    Add-Result -ID "D1" -Category "D" -Expected "active" -Pass $false -Detail "会话 A 未获取"
}

# D2: 全新会话 B, 查线程 -> 不触发
Invoke-Case -ID "D2" -Category "D" -Expected "not-triggered" -MaxRetry $MaxRetry -Test {
    $ev = Invoke-OpencodeRun -Message "查一下线程怎么用"
    $script:sessionB = Get-SessionID -Events $ev
    $trig = Test-SkillTriggered -Events $ev
    if ($trig) { return (New-Fail "新会话 B 意外触发") }
    return (New-Pass "新会话 B 未触发, OK")
}

# D3: 继续会话 B, 开启专家模式 -> 独立触发
if ($script:sessionB) {
    Invoke-Case -ID "D3" -Category "D" -Expected "triggered" -MaxRetry $MaxRetry -Test {
        $ev = Invoke-OpencodeRun -Message "开启Qt专家模式" -SessionID $script:sessionB
        $trig = Test-SkillTriggered -Events $ev
        if ($trig) { return (New-Pass "会话 B 独立触发, 与 A 互不影响") }
        return (New-Fail "会话 B 未触发")
    }
} else {
    Add-Result -ID "D3" -Category "D" -Expected "triggered" -Pass $false -Detail "会话 B 未获取"
}

# ========== 阶段 E: 输出质量 (延续会话 A, 专家模式) ==========
if (-not $SkipE) {
    Write-Host ""
    Write-Host "--- E 类: 输出质量 (延续会话 A) ---" -ForegroundColor Yellow
    if ($script:sessionA) {
        $eCases = @(
            @{ id = "E1"; msg = "查一下 QTcpSocket 怎么用";  match = @("QTcpSocket", "connected") },
            @{ id = "E2"; msg = "查一个不存在的类 QFakeClass"; match = @("QFakeClass", "未找到|拼写|不存在|not found|error") },
            @{ id = "E3"; msg = "查一下定时器怎么用";        match = @("QTimer", "timeout") },
            @{ id = "E4"; msg = "查一下线程和定时器怎么配合"; match = @("QThread", "QTimer") }
        )
        foreach ($c in $eCases) {
            Invoke-Case -ID $c.id -Category "E" -Expected "active+quality" -MaxRetry $MaxRetry -Test {
                $ev = Invoke-OpencodeRun -Message $c.msg -SessionID $script:sessionA
                $active = Test-ExpertActive -Events $ev
                $text = Get-AllText -Events $ev
                $missed = @()
                foreach ($m in $c.match) {
                    if ($text -notmatch $m) { $missed += $m }
                }
                if (-not $active) { return (New-Fail "专家模式未生效") }
                if ($missed.Count -gt 0) { return (New-Fail "缺失质量关键词: $($missed -join ', ')") }
                return (New-Pass "生效 + 质量关键词齐全")
            }
        }
    } else {
        Write-Host "  未获取会话 A, 跳过 E 类" -ForegroundColor Red
        foreach ($cid in @("E1", "E2", "E3", "E4")) {
            Add-Result -ID $cid -Category "E" -Expected "active+quality" -Pass $false -Detail "会话 A 未获取"
        }
    }
} else {
    Write-Host ""
    Write-Host "--- E 类已跳过 (指定了 -SkipE) ---" -ForegroundColor DarkGray
}

# ========== 汇总 ==========
Write-Host ""
Write-Host "=================== 汇总 ===================" -ForegroundColor Cyan
$script:endTime = Get-Date
$total = $script:results.Count
$passCount = @($script:results | Where-Object { $_.Pass }).Count
$failCount = $total - $passCount
$retriedCount = @($script:results | Where-Object { $_.Retried }).Count

$script:results | Format-Table -AutoSize | Out-String | Write-Host
Write-Host ("通过: {0}/{1}   失败: {2}   重试过: {3} 个用例" -f $passCount, $total, $failCount, $retriedCount) -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host "结束时间: $($script:endTime.ToString('yyyy-MM-dd HH:mm:ss'))  耗时: $([math]::Round(($script:endTime - $script:startTime).TotalSeconds))s"
Write-Host ""
Write-Host "回归判断: 通过=B1-B6 全不触发 且 A1-A4 至少 1 触发 且 C/D 符合预期 且 E 无严重错误。" -ForegroundColor DarkGray

# ========== 生成报告 ==========
if (-not $NoReport) {
    if (-not $ReportPath) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $ReportPath = Join-Path $scriptDir ("qt-doc-auto-report-{0}.md" -f $script:endTime.ToString("yyyyMMdd-HHmmss"))
    }

    $L = [System.Collections.Generic.List[string]]::new()
    $L.Add("# qt-doc Skill 自动化测试报告")
    $L.Add("")
    $L.Add("- 生成时间: $($script:endTime.ToString('yyyy-MM-dd HH:mm:ss'))")
    $L.Add("- 脚本: $(Split-Path -Leaf $MyInvocation.MyCommand.Path)")
    $L.Add("- 执行时长: $([math]::Round(($script:endTime - $script:startTime).TotalSeconds)) 秒")
    $L.Add("- 重试上限: $MaxRetry 次, E 类: $(if ($SkipE) { '跳过' } else { '执行' })")
    $L.Add("- 用例总数: $total, 通过: $passCount, 失败: $failCount, 重试过: $retriedCount 个用例")
    $L.Add("")
    $L.Add("## 总体结论")
    $L.Add("")
    $verdict = if ($failCount -eq 0) { "**通过** — 全部用例通过。" } else { "**失败** — $failCount 个用例未通过, 详见下表。" }
    $L.Add($verdict)
    $L.Add("")
    $L.Add("## 用例结果")
    $L.Add("")
    $L.Add("| ID | 类别 | 预期 | 结果 | 尝试次数 | 详情 |")
    $L.Add("|---|---|---|---|---|---|")
    foreach ($r in $script:results) {
        $mark = if ($r.Pass) { "PASS" } else { "FAIL" }
        $L.Add("| $($r.ID) | $($r.Category) | $($r.Expected) | $mark | $($r.Attempt) | $($r.Detail) |")
    }
    $L.Add("")
    $L.Add("## 分项统计")
    $L.Add("")
    $L.Add("| 类别 | 通过 | 失败 |")
    $L.Add("|---|---|---|")
    foreach ($cat in @("A", "B", "C", "D", "E")) {
        $catAll = @($script:results | Where-Object { $_.Category -eq $cat })
        if ($catAll.Count -eq 0) { continue }
        $catPass = @($catAll | Where-Object { $_.Pass }).Count
        $catFail = $catAll.Count - $catPass
        $L.Add("| $cat | $catPass/$($catAll.Count) | $catFail |")
    }
    $L.Add("")
    $L.Add("## 失败详情")
    $L.Add("")
    $fails = @($script:results | Where-Object { -not $_.Pass })
    if ($fails.Count -eq 0) {
        $L.Add("无失败用例。")
    } else {
        foreach ($f in $fails) {
            $L.Add("### $($f.ID) ($($f.Category) 类)")
            $L.Add("")
            $L.Add("- 预期: $($f.Expected)")
            $L.Add("- 尝试: $($f.Attempt) 次")
            $L.Add("- 详情: $($f.Detail)")
            $L.Add("")
        }
    }
    $L.Add("## 备注")
    $L.Add("")
    $L.Add("- 判定信号: A/B/D2/D3 检测 skill 加载事件 (`tool=skill` + `name=qt-doc`); C/D1/E 检测专家模式生效三信号(再次加载 skill / 调用 `qt_fetch.py` / 输出 `[qt-doc]` 前缀)。")
    $L.Add("- 失败用例会在上限内自动重试, 以排除 LLM 偶发随机性。")

    [System.IO.File]::WriteAllLines($ReportPath, $L, [System.Text.UTF8Encoding]::new($true))
    Write-Host ""
    Write-Host ("报告已生成: {0}" -f $ReportPath) -ForegroundColor Cyan
}

if ($failCount -gt 0) {
    exit 1
}
exit 0
