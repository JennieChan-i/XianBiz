import hashlib
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

VERSION = 1

def now():
    return datetime.now().astimezone().isoformat(timespec='microseconds')

def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

class BusinessError(Exception):
    def __init__(self, message, code=400):
        self.message, self.code = message, code

def require(condition, message, code=400):
    if not condition:
        raise BusinessError(message, code)

def integer(value, name='数量', minimum=0):
    require(isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= 10**12, f'{name}必须为不小于{minimum}的整数')
    return value

class Database:
    def __init__(self, directory=None):
        self.directory = Path(directory or os.environ.get('XIANBIZ_DATA_DIR') or Path(os.getenv('LOCALAPPDATA', Path.home())) / 'XianBiz')
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory/'images').mkdir(exist_ok=True)
        self.path = self.directory/'xianbiz.sqlite3'
        self.lock = threading.RLock()
        with self.connect() as conn:
            existing = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").fetchone()
            if existing:
                version = conn.execute('SELECT COALESCE(MAX(version),0) FROM schema_version').fetchone()[0]
                require(version <= VERSION, '此数据由较新版本创建，请使用兼容版本打开', 409)
            conn.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))
            conn.execute('INSERT OR IGNORE INTO schema_version VALUES(?,?)', (VERSION, now()))

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=20, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=20000')
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self):
        with self.lock, self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def command(self, key, payload, callback):
        require(isinstance(key, str) and 8 <= len(key) <= 128, '缺少有效操作号', 400)
        digest = hashlib.sha256(encode(payload).encode()).hexdigest()
        with self.transaction() as conn:
            old = conn.execute('SELECT * FROM operations WHERE key=?', (key,)).fetchone()
            if old:
                require(old['digest'] == digest, '操作号已用于不同内容，请刷新后重试', 409)
                return json.loads(old['result'])
            result = callback(conn)
            conn.execute('INSERT INTO operations VALUES(?,?,?,?)', (key,digest,encode(result),now()))
            return result

def row(conn, table, id):
    result = conn.execute(f'SELECT * FROM {table} WHERE id=?', (id,)).fetchone()
    require(result is not None, '记录不存在', 404)
    return dict(result)

def insert(conn, table, **values):
    columns = ','.join(values)
    marks = ','.join('?' for _ in values)
    return conn.execute(f'INSERT INTO {table}({columns}) VALUES({marks})', tuple(values.values())).lastrowid

def history(conn, entity, entity_id, action, before=None, after=None, reason=''):
    insert(conn,'history',entity=entity,entity_id=entity_id,action=action,before_json=encode(before),after_json=encode(after),reason=reason,created_at=now())
