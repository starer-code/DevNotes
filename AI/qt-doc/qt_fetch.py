import sys, os, json, time, re
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ONLINE = os.environ.get("QT_DOC_ONLINE", "https://doc.qt.io/qt-6")
CACHE_DIR = Path(os.environ.get("QT_DOC_CACHE", str(Path.home() / ".cache" / "qt-doc")))
TTL_SECONDS = 30 * 24 * 3600
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qt-doc-skill"}

_CANDIDATE_ROOTS = [
    "D:/Qt", "C:/Qt", "C:/Qt5", "C:/Qt6",
    str(Path.home() / "Qt"),
]


def _discover_doc_root():
    env = os.environ.get("QT_DOC_ROOT")
    if env:
        p = Path(env)
        return p if p.is_dir() else None
    for root in _CANDIDATE_ROOTS:
        base = Path(root)
        if not base.is_dir():
            continue
        docs = base / "Docs"
        if docs.is_dir():
            for ver in sorted(docs.iterdir(), key=lambda x: x.name, reverse=True):
                if ver.is_dir() and ver.name.lower().startswith("qt-"):
                    return ver
            for ver in sorted(base.iterdir(), key=lambda x: x.name, reverse=True):
                if ver.is_dir() and ver.name[0].isdigit():
                    return ver
    return None


DOC_ROOT = _discover_doc_root()

MAX_DEPTH = 5


def _clean_text(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def _parse_apis(soup):
    apis = []
    for h3 in soup.find_all("h3", class_="fn"):
        sig = _clean_text(h3)
        lower = sig.lower()
        if "signal" in lower and lower.startswith("["):
            kind = "Signal"
        elif "slot" in lower and lower.startswith("["):
            kind = "Slot"
        elif "explicit" in lower:
            kind = "Constructor"
        elif "static" in lower:
            kind = "Static"
        elif "protected" in lower:
            kind = "Protected"
        else:
            kind = "Function"
        desc_el = h3.find_next_sibling()
        desc = _clean_text(desc_el) if desc_el and desc_el.name in ("p", "dd") else ""
        apis.append({"kind": kind, "signature": sig, "description": desc})
    return apis


def extract_parents(soup):
    parents = []
    td = soup.find("td", string=lambda t: t and "Inherits:" in t)
    if td is None:
        return parents
    tr = td.find_parent("tr")
    if tr is None:
        return parents
    for a in tr.find_all("a"):
        txt = a.get_text(strip=True)
        if txt.startswith("Q"):
            parents.append(txt)
    return parents


def _parse_html(html, name):
    soup = BeautifulSoup(html, "html.parser")
    title_el = soup.find("h1", class_="title")
    title = _clean_text(title_el) if title_el else name
    dd = soup.find("dd")
    brief_el = dd if dd else None
    brief = _clean_text(brief_el) if brief_el else ""
    return {"name": name, "title": title, "brief": brief,
            "parents": extract_parents(soup), "apis": _parse_apis(soup)}


def _cache_path(name):
    return CACHE_DIR / f"{name}.json"


def _load_cache(name):
    p = _cache_path(name)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if time.time() - data.get("ts", 0) < TTL_SECONDS:
                return data["data"]
        except Exception:
            pass
    return None


def _save_cache(name, data):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_cache_path(name)).write_text(json.dumps({"ts": time.time(), "data": data}, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _fetch_local(name):
    if DOC_ROOT is None:
        return None
    fname = name.lower() + ".html"
    for mod in DOC_ROOT.iterdir():
        if mod.is_dir():
            p = mod / fname
            if p.exists():
                return p.read_text(encoding="utf-8", errors="replace")
    return None


def _fetch_online(name):
    r = requests.get(f"{ONLINE}/{name}.html", headers=HEADERS, timeout=8)
    r.raise_for_status()
    return r.text


def fetch_class(name, offline=False):
    cached = _load_cache(name)
    if cached:
        cached.setdefault("parents", [])
        return cached
    html = None
    if not offline:
        try:
            html = _fetch_online(name)
        except Exception:
            html = None
    if html is None:
        html = _fetch_local(name)
    if html is None:
        return None
    data = _parse_html(html, name)
    _save_cache(name, data)
    return data


def expand_class(name, offline=False, _depth=0, _visited=None):
    visited = set(_visited) if _visited else set()
    if name in visited:
        return None
    visited.add(name)
    data = fetch_class(name, offline=offline)
    if data is None:
        return None
    apis = []
    for api in data["apis"]:
        api = dict(api)
        api["inheritsFrom"] = name
        apis.append(api)
    chain = [name]
    if _depth + 1 < MAX_DEPTH:
        for parent in data.get("parents", []):
            sub = expand_class(parent, offline=offline, _depth=_depth + 1, _visited=visited)
            if sub:
                chain.extend(sub["inheritance_chain"])
                apis.extend(sub["apis"])
    merged = []
    seen = set()
    for api in apis:
        sig = api["signature"]
        if sig not in seen:
            seen.add(sig)
            merged.append(api)
    return {"name": data["name"], "title": data["title"], "brief": data["brief"],
            "inheritance_chain": chain, "apis": merged}


def main():
    names = [a for a in sys.argv[1:] if a.startswith("Q")]
    results, errors = [], []
    for n in names:
        data = expand_class(n)
        if data is None:
            errors.append({"name": n, "error": "class not found online or in local docs"})
        else:
            results.append(data)
    print(json.dumps({"results": results, "errors": errors}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
