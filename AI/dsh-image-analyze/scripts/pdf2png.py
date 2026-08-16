#!/usr/bin/env python3
"""dsh-image-analyze: 把 PDF 每页渲染为 PNG（依赖 PyMuPDF）。"""
import sys
import os
import fitz

def main():
    src, out, max_pages = sys.argv[1], sys.argv[2], int(sys.argv[3])
    os.makedirs(out, exist_ok=True)
    doc = fitz.open(src)
    n = min(doc.page_count, max_pages)
    for i in range(n):
        pix = doc[i].get_pixmap(dpi=150)
        pix.save(os.path.join(out, f"page-{i + 1:03d}.png"))
    print(f"OK {n}")

if __name__ == "__main__":
    main()
