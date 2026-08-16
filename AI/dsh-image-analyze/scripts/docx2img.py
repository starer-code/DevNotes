#!/usr/bin/env python3
"""dsh-image-analyze: 从 .docx 解包 word/media/ 下的内嵌图片。"""
import sys
import os
import zipfile

EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.webp')

def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    count = 0
    with zipfile.ZipFile(src) as z:
        for name in z.namelist():
            low = name.lower()
            if low.startswith('word/media/') and low.endswith(EXTS):
                with open(os.path.join(out, os.path.basename(name)), 'wb') as f:
                    f.write(z.read(name))
                count += 1
    print(f"OK {count}")

if __name__ == "__main__":
    main()
