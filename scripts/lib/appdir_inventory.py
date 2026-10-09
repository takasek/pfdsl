"""Inventory AppDir entries without dereferencing symbolic links."""

import hashlib
import os
import stat


def appdir_entries(root):
    """Return relative paths and each entry's type, mode and content identity."""
    entries = {}
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        entry = {'mode': oct(stat.S_IMODE(info.st_mode))}
        if stat.S_ISLNK(info.st_mode):
            entry.update(type='symlink', target=os.readlink(path))
        elif stat.S_ISREG(info.st_mode):
            entry.update(type='file', sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        else:
            assert stat.S_ISDIR(info.st_mode), str(path)
            entry.update(type='directory')
        entries[str(path.relative_to(root))] = entry
    return entries
