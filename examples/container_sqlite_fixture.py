"""Generate bounded SQLite writes for the isolated container acceptance fixture."""
import json


def sqlite_write(sql, parameters, *, timeout_ms=5000, path='/data/state/state.sqlite'):
    if not isinstance(timeout_ms, int) or not 1 <= timeout_ms <= 5000:
        raise ValueError('Fixture lock wait must be between 1 and 5000 ms')
    return (
        "import {DatabaseSync} from 'node:sqlite';"
        f"const d=new DatabaseSync({json.dumps(path)});"
        "try{"
        f"d.exec('PRAGMA busy_timeout={timeout_ms}');"
        f"d.prepare({json.dumps(sql)}).run(...{json.dumps(parameters)});"
        "}finally{d.close()}"
    )
