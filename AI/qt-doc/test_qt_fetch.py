import json, subprocess, sys, os, pathlib
sys.path.insert(0, os.path.dirname(__file__))
import qt_fetch
from bs4 import BeautifulSoup


def _soup_of(name):
    if qt_fetch.DOC_ROOT is None:
        return None
    for mod in qt_fetch.DOC_ROOT.iterdir():
        if mod.is_dir():
            p = mod / (name.lower() + ".html")
            if p.exists():
                return BeautifulSoup(p.read_text(encoding="utf-8", errors="replace"), "html.parser")
    return None


def test_extract_parents_qtcpsocket():
    soup = _soup_of("QTcpSocket")
    assert soup is not None
    parents = qt_fetch.extract_parents(soup)
    assert "QAbstractSocket" in parents


def test_fetch_class_has_parents():
    r = qt_fetch.fetch_class("QTcpSocket", offline=True)
    assert r is not None
    assert r.get("parents") == ["QAbstractSocket"]




def test_expand_qtcpsocket():
    r = qt_fetch.expand_class("QTcpSocket", offline=True)
    assert r is not None
    chain = r["inheritance_chain"]
    assert "QTcpSocket" in chain
    assert len(chain) >= 2
    apis = r["apis"]
    assert len(apis) > 2
    assert all("inheritsFrom" in a for a in apis)
    sigs = [a["signature"] for a in apis]
    assert len(sigs) == len(set(sigs))


def test_expand_root_qobject():
    r = qt_fetch.expand_class("QObject", offline=True)
    assert r is not None
    assert r["inheritance_chain"] == ["QObject"]
    assert all(a["inheritsFrom"] == "QObject" for a in r["apis"])


def test_missing_class():
    with open(os.devnull, 'w') as devnull:
        r = qt_fetch.fetch_class("QNonexistentClass", offline=True)
    assert r is None

def test_local_qthread():
    r = qt_fetch.fetch_class("QThread", offline=True)
    assert r is not None
    assert r["name"] == "QThread"
    kinds = {a["kind"] for a in r["apis"]}
    assert "Constructor" in kinds or "Signal" in kinds or "Function" in kinds

def test_kind_classification():
    r = qt_fetch.fetch_class("QThread", offline=True)
    assert r is not None
    kinds = {a["kind"] for a in r["apis"]}
    assert "Signal" in kinds
    assert "Function" in kinds

def test_main_stdout_json():
    p = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "qt_fetch.py"), "QTcpSocket"],
                       capture_output=True, text=True, timeout=90)
    assert p.returncode == 0
    data = json.loads(p.stdout)
    r = data["results"][0]
    assert r["name"] == "QTcpSocket"
    assert "inheritance_chain" in r
    assert len(r["inheritance_chain"]) >= 2
