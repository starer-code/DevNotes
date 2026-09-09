# qt-doc Skill 触发规则模拟回归测试
# 用法: python skill_trigger_test.py
# 验证 description 的触发逻辑: 未开启专家模式仅"开启词"触发; 开启后 Qt 语境触发、非 Qt 不触发。
# 注意: 真实 opencode 中由 LLM 判定, 本脚本是规则近似; 权威测试见 run-qt-doc-tests.ps1。

NON_QT = ["Java", "Python", "React", "JavaScript", "JS", "Web", "前端", "HashMap",
          "C#", "Go语言", "Spring", "Django", "CSS", "HTML", "Flask", "Node"]

TRIGGER_WORDS = ["开启Qt专家模式", "进入Qt专家模式", "Qt专家模式",
                 "开启 Qt 专家模式", "进入 Qt 专家模式"]


def would_trigger(msg, expert_active):
    if expert_active:
        return not any(k in msg for k in NON_QT)
    return any(w in msg for w in TRIGGER_WORDS)


CASES = [
    # (id, 输入, 是否已开启专家模式, 期望触发)
    ("A1", "开启Qt专家模式",             False, True),
    ("A2", "进入Qt专家模式",             False, True),
    ("A3", "Qt专家模式",                 False, True),
    ("A4", "开启 Qt 专家模式",           False, True),
    ("B1", "查一下 QTcpSocket 怎么用",   False, False),
    ("B2", "Java 里线程和进程的区别",    False, False),
    ("B3", "React 里定时器怎么用",       False, False),
    ("B4", "Python 的 list 和 tuple 区别", False, False),
    ("B5", "什么是线程池",               False, False),
    ("B6", "用 Qt 写个界面",             False, False),
    ("C1", "查一下线程怎么用",           True,  True),
    ("C2", "QTimer 和信号槽怎么配合",    True,  True),
    ("C4", "Java 的 HashMap 原理",       True,  False),
    ("D2", "查一下线程怎么用",           False, False),
]


def main():
    print(f"{'id':<4} {'输入':<26} {'期望':<4} {'实际':<4} 结果")
    print("-" * 66)
    fail = 0
    for cid, msg, active, expected in CASES:
        actual = would_trigger(msg, active)
        ok = (actual == expected)
        if not ok:
            fail += 1
        print(f"{cid:<4} {msg:<26} {str(expected):<4} {str(actual):<4} {'PASS' if ok else 'FAIL'}")
    print("-" * 66)
    total = len(CASES)
    print(f"通过 {total-fail}/{total}" + (" 全部通过" if fail == 0 else f" 失败 {fail} 项"))
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
