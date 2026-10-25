"""Create a consistent read-only backup of the POS SQLite database."""

import sqlite3
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: sqlite-snapshot.py SOURCE DESTINATION")
    source, destination = (Path(value) for value in sys.argv[1:])
    if not source.is_file() or destination.exists():
        raise SystemExit("SQLite source is missing or destination already exists")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as live:
        with sqlite3.connect(destination) as snapshot:
            live.backup(snapshot)
            if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise SystemExit("SQLite snapshot integrity check failed")


if __name__ == "__main__":
    main()
