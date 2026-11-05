#!/usr/bin/env python3
"""Write an IPK (a plain ar archive) without needing GNU binutils.

macOS `ar` writes a BSD archive with a `__.SYMDEF` symbol table, which opkg
does not understand; the result is a 96-byte "package" that installs nothing.
This writes the standard GNU ar layout instead, on any platform.

Usage: make-ipk.py <out.ipk> <debian-binary> <control.tar.gz> <data.tar.gz>
"""
import os
import sys


def ar_write(out_path, files):
    with open(out_path, "wb") as out:
        out.write(b"!<arch>\n")
        for path in files:
            name = os.path.basename(path)
            data = open(path, "rb").read()

            # ar header: 16 name, 12 mtime, 6 uid, 6 gid, 8 mode, 10 size, 2 magic
            header = b"".join([
                (name + "/").ljust(16)[:16].encode(),
                b"0".ljust(12),
                b"0".ljust(6),
                b"0".ljust(6),
                b"100644".ljust(8),
                str(len(data)).encode().ljust(10),
                b"`\n",
            ])
            assert len(header) == 60, len(header)

            out.write(header)
            out.write(data)
            if len(data) % 2:
                out.write(b"\n")  # entries are 2-byte aligned


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    ar_write(sys.argv[1], sys.argv[2:])
