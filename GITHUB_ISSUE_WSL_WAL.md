# SQLite WAL mode fails on WSL2 when database is on Windows filesystem (/mnt/c/)

## Summary

SQLite WAL mode fails when `bd` runs under WSL2 against a project stored on the Windows filesystem (e.g., `/mnt/c/...`). The failure appears to be caused by WAL shared-memory requirements not working across the WSL2 9P (DrvFS) boundary, which behaves like a network filesystem.

This breaks mixed Windows/WSL workflows where Windows-native tooling (VS Code + extensions + `bd.exe`) and WSL-based CLI agents need to operate on the same project.

## Error Messages

```
sqlite3: disk I/O error: truncate /mnt/c/.../.beads/beads.db-shm: invalid argument
```

```
Error: failed to open database: failed to enable WAL mode: sqlite3: locking protocol
```

From `bd doctor`:
```
Database: Unable to read database version
  Storage: SQLite
  sqlite3: disk I/O error: truncate /mnt/c/.../.beads/beads.db-shm: invalid argument
Database: Integrity check failed
```

## Environment

- OS: Windows 11 with WSL2 (Ubuntu)
- bd version: 0.44.0 (both Windows and WSL builds)
- Project location: `/mnt/c/Development/project/` (Windows filesystem accessed via WSL2)
- VS Code: Windows native, extensions accessing the database

## Root Cause

SQLite WAL requires shared-memory coordination via the `-shm` file. From the SQLite WAL docs:

> "All processes using a database must be on the same host computer; WAL does not work over a network filesystem. This is because WAL requires all processes to share a small amount of memory."

https://www.sqlite.org/wal.html

WSL2 access to `/mnt/c/` uses 9P (DrvFS). From SQLite's perspective, this behaves like a network filesystem:
- Shared memory operations do not behave correctly across the Windows/WSL boundary
- POSIX locking semantics are not fully supported
- The `-shm` file cannot be reliably truncated/locked

## Reproduction

1. Create a beads project on Windows filesystem: `C:\Development\myproject`
2. From Windows CMD/PowerShell, run: `bd.exe init` (works)
3. From WSL2, run: `bd list` or any `bd` command in `/mnt/c/Development/myproject`
4. Result: WAL/locking errors

## Impact

Mixed Windows/WSL development cannot use `bd` safely on Windows filesystem projects:
- Windows-native tools (VS Code, extensions, `bd.exe`) work
- WSL-based CLI agents fail

## Current Workarounds

1. Use Windows `bd.exe` only (breaks WSL-based agents)
2. Move project to WSL filesystem (breaks Windows-native tools)
3. Use `no-db: true` (breaks SQLite-dependent integrations)

## Suggested Solutions

Option A: Auto-detect WSL + Windows filesystem and disable WAL

```go
// Pseudo-code
if isWSL() && isWindowsFilesystem(dbPath) {
    db.Exec("PRAGMA journal_mode=DELETE")
}
```

Detection examples:
- `/proc/version` contains `Microsoft` or `WSL`
- Path prefix `/mnt/[a-z]/`

Option B: Add config/flag to control journal mode

```yaml
# .beads/config.yaml
journal-mode: delete  # or wal (default), truncate, memory
```

Option C: Document limitation

Add docs warning that WAL does not work on `/mnt/c/` and recommend:
- Use Windows `bd.exe` for projects on Windows filesystems, or
- Move the project to a native WSL filesystem

## Related Issues

- #536 - Locking between systems (Windows/Docker, similar symptoms)
- #204 - disk I/O error during migrate (mentions `-shm` files)

## Additional Context

The config file already notes a similar limitation for sockets:

```yaml
# NOTE: Unix sockets don't work on Windows filesystems (/mnt/c/...) in WSL2
no-daemon: true
```

The same limitation applies to SQLite WAL mode.
