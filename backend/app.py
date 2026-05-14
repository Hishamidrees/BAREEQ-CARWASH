import json
import os
import ssl
import threading
import time
from calendar import month_name
from typing import Dict, Any, Optional, List, Tuple
from flask_cors import CORS

import certifi
import pymysql
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_sock import Sock
import paho.mqtt.client as mqtt
from google.cloud.sql.connector import Connector

# ===================== ENV =====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_PATH, override=True)

MQTT_HOST = os.getenv("MQTT_HOST", "").strip()
MQTT_PORT = int(os.getenv("MQTT_PORT", "8883"))
MQTT_USER = os.getenv("MQTT_USER", "").strip()
MQTT_PASS = os.getenv("MQTT_PASS", "").strip()

INSTANCE_CONNECTION_NAME = os.getenv("INSTANCE_CONNECTION_NAME", "").strip()
DB_USER = os.getenv("DB_USER", "").strip()
DB_PASS = os.getenv("DB_PASS", "").strip()
DB_NAME = os.getenv("DB_NAME", "carwash").strip()

# ===================== CONFIG =====================
SERVICE_PRICES = {
    "OUT_WASH": 20,
    "IN_OUT_WASH": 30,
    "IN_OUT_WASH_POLISH": 100,
}
DEFAULT_SERVICE = "OUT_WASH"

MISSION_HISTORY_METRICS = [
    "total_air_l",
    "total_water_l",
    "avg_env_temperature_c",
    "avg_env_humidity_pct",
    "avg_water_temperature_c",
    "avg_tds_ppm",
    "avg_turbidity_ntu",
    "samples",
]

# ===================== APP/STATE =====================
app = Flask(__name__)
sock = Sock(app)

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "https://carwash-frontend-833921043838.us-central1.run.app",
                "http://localhost:5173",
                "http://127.0.0.1:5173"
            ]
        }
    },
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"]
)

latest_lock = threading.Lock()
latest: Dict[str, Dict[str, Any]] = {}

service_lock = threading.Lock()
station_service: Dict[str, str] = {}

mqtt_lock = threading.Lock()
mqtt_client: Optional[mqtt.Client] = None

start_lock = threading.Lock()
started = False

# ===================== DB =====================
connector = Connector()


def db_connect():
    return connector.connect(
        INSTANCE_CONNECTION_NAME,
        "pymysql",
        user=DB_USER,
        password=DB_PASS,
        db=DB_NAME,
    )


def dict_cursor(con):
    return con.cursor(pymysql.cursors.DictCursor)


# ===================== HELPERS =====================
def _f(x):
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None


def _i(x):
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None


def _deep_copy_jsonable(obj):
    return json.loads(json.dumps(obj))


def normalize_uid(uid: str) -> str:
    return "".join(ch for ch in str(uid or "").upper() if ch.isalnum())


def normalize_plate_digits(v: str) -> str:
    return "".join(ch for ch in str(v or "") if ch.isdigit())


def normalize_plate_letters(v: str) -> str:
    return "".join(ch for ch in str(v or "").upper() if ch.isalpha())


def _year_bounds(year: int):
    start = int(time.mktime(time.strptime(f"{year}-01-01", "%Y-%m-%d")))
    end = int(time.mktime(time.strptime(f"{year+1}-01-01", "%Y-%m-%d")))
    return start, end


# ===================== DB INIT =====================
def ensure_column(cur, table: str, column: str, ddl: str):
    cur.execute(
        """
        SELECT COUNT(*) AS c
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s
        """,
        (DB_NAME, table, column),
    )
    row = cur.fetchone()
    if row and int(row[0] if not isinstance(row, dict) else row["c"]) == 0:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                balance INT NOT NULL,
                plate_digits VARCHAR(50) DEFAULT '',
                plate_letters VARCHAR(50) DEFAULT '',
                created_at BIGINT NOT NULL
            )
        """)

        ensure_column(cur, "users", "blocked", "blocked TINYINT NOT NULL DEFAULT 0")
        ensure_column(cur, "users", "updated_at", "updated_at BIGINT NULL")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                ts BIGINT NOT NULL,
                station_id VARCHAR(255) NOT NULL,
                uid VARCHAR(255) NOT NULL,
                service VARCHAR(100) NOT NULL,
                price INT NOT NULL,
                approved TINYINT NOT NULL,
                req_id VARCHAR(255) NOT NULL UNIQUE,
                balance_before INT NULL,
                balance_after INT NULL,
                reason TEXT NULL,
                INDEX idx_transactions_req_id (req_id),
                INDEX idx_transactions_uid (uid),
                INDEX idx_transactions_station_ts (station_id, ts)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS sensor_points (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                ts BIGINT NOT NULL,
                station_id VARCHAR(255) NOT NULL,
                uid VARCHAR(255) DEFAULT '',
                metric VARCHAR(255) NOT NULL,
                value DOUBLE NOT NULL,
                unit VARCHAR(50) DEFAULT '',
                INDEX idx_sensor_points_ts (ts),
                INDEX idx_sensor_points_station_metric_ts (station_id, metric, ts),
                INDEX idx_sensor_points_uid (uid)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS missions (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                ts BIGINT NOT NULL,
                station_id VARCHAR(255) NOT NULL,
                device VARCHAR(255) DEFAULT '',
                uid VARCHAR(255) DEFAULT '',
                req_id VARCHAR(255) DEFAULT '',
                total_air_l DOUBLE NULL,
                total_water_l DOUBLE NULL,
                avg_env_temperature_c DOUBLE NULL,
                avg_env_humidity_pct DOUBLE NULL,
                avg_water_temperature_c DOUBLE NULL,
                avg_tds_ppm DOUBLE NULL,
                avg_turbidity_ntu DOUBLE NULL,
                samples INT NULL,
                INDEX idx_missions_station_ts (station_id, ts),
                INDEX idx_missions_uid (uid)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS station_services (
                station_id VARCHAR(255) PRIMARY KEY,
                service VARCHAR(100) NOT NULL,
                updated_at BIGINT NOT NULL,
                INDEX idx_station_services_updated_at (updated_at)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS service_discounts (
                service VARCHAR(100) PRIMARY KEY,
                enabled TINYINT NOT NULL DEFAULT 0,
                discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
                updated_at BIGINT NOT NULL
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS loyalty_progress (
                uid VARCHAR(255) NOT NULL,
                service VARCHAR(100) NOT NULL,
                streak_count INT NOT NULL DEFAULT 0,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (uid, service)
            )
        """)

        ensure_column(cur, "transactions", "original_price", "original_price INT NULL")
        ensure_column(cur, "transactions", "final_price", "final_price INT NULL")
        ensure_column(cur, "transactions", "discount_pct", "discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0")
        ensure_column(cur, "transactions", "is_free", "is_free TINYINT NOT NULL DEFAULT 0")

        con.commit()
    finally:
        cur.close()
        con.close()


# ===================== USERS =====================
def map_user_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "uid": row.get("uid", ""),
        "name": row.get("name", ""),
        "balance": int(row.get("balance", 0)),
        "plate_digits": row.get("plate_digits", "") or "",
        "plate_letters": row.get("plate_letters", "") or "",
        "blocked": bool(row.get("blocked", 0)),
    }


def db_get_user(uid: str):
    uid = normalize_uid(uid)
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute(
            "SELECT uid, name, balance, plate_digits, plate_letters, blocked FROM users WHERE uid=%s",
            (uid,)
        )
        row = cur.fetchone()
        return map_user_row(row) if row else None
    finally:
        cur.close()
        con.close()


def db_find_user_by_carplate(plate_digits: str, plate_letters: str):
    plate_digits = normalize_plate_digits(plate_digits)
    plate_letters = normalize_plate_letters(plate_letters)
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute(
            """
            SELECT uid, name, balance, plate_digits, plate_letters, blocked
            FROM users
            WHERE plate_digits=%s AND plate_letters=%s
            LIMIT 1
            """,
            (plate_digits, plate_letters)
        )
        row = cur.fetchone()
        return map_user_row(row) if row else None
    finally:
        cur.close()
        con.close()


def db_add_user(uid: str, name: str, balance: int, plate_digits: str = "", plate_letters: str = ""):
    uid = normalize_uid(uid)
    plate_digits = normalize_plate_digits(plate_digits)
    plate_letters = normalize_plate_letters(plate_letters)

    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            """
            INSERT INTO users(uid, name, balance, plate_digits, plate_letters, blocked, created_at, updated_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (uid, name, int(balance), plate_digits, plate_letters, 0, int(time.time()), int(time.time()))
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_delete_user(uid: str):
    uid = normalize_uid(uid)
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute("DELETE FROM users WHERE uid=%s", (uid,))
        con.commit()
        return cur.rowcount > 0
    finally:
        cur.close()
        con.close()


def db_set_balance(uid: str, balance: int):
    uid = normalize_uid(uid)
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            "UPDATE users SET balance=%s, updated_at=%s WHERE uid=%s",
            (int(balance), int(time.time()), uid)
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_add_balance(uid: str, delta: int):
    uid = normalize_uid(uid)
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            "UPDATE users SET balance = balance + %s, updated_at=%s WHERE uid=%s",
            (int(delta), int(time.time()), uid)
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_set_blocked(uid: str, blocked: bool):
    uid = normalize_uid(uid)
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            "UPDATE users SET blocked=%s, updated_at=%s WHERE uid=%s",
            (1 if blocked else 0, int(time.time()), uid)
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_search_users(q: str, by: str = "any", limit: int = 200):
    con = db_connect()
    cur = dict_cursor(con)
    try:
        q = (q or "").strip()
        by = (by or "any").strip().lower()
        limit = int(limit)

        if not q:
            sql = """
                SELECT uid, name, balance, plate_digits, plate_letters, blocked
                FROM users
                ORDER BY uid
                LIMIT %s
            """
            cur.execute(sql, (limit,))
            return [map_user_row(r) for r in cur.fetchall()]

        if by == "uid":
            like_q = f"%{normalize_uid(q)}%"
            sql = """
                SELECT uid, name, balance, plate_digits, plate_letters, blocked
                FROM users
                WHERE REPLACE(REPLACE(UPPER(uid), ' ', ''), '-', '') LIKE %s
                ORDER BY uid
                LIMIT %s
            """
            cur.execute(sql, (like_q, limit))
            return [map_user_row(r) for r in cur.fetchall()]

        if by == "name":
            like_q = f"%{q}%"
            sql = """
                SELECT uid, name, balance, plate_digits, plate_letters, blocked
                FROM users
                WHERE name LIKE %s
                ORDER BY name, uid
                LIMIT %s
            """
            cur.execute(sql, (like_q, limit))
            return [map_user_row(r) for r in cur.fetchall()]

        if by == "carplate":
            raw = q.upper().replace(" ", "")
            digits = "".join(ch for ch in raw if ch.isdigit())
            letters = "".join(ch for ch in raw if ch.isalpha())

            sql = """
                SELECT uid, name, balance, plate_digits, plate_letters, blocked
                FROM users
                WHERE (%s = '' OR plate_digits LIKE %s)
                  AND (%s = '' OR plate_letters LIKE %s)
                ORDER BY uid
                LIMIT %s
            """
            cur.execute(sql, (digits, f"{digits}%", letters, f"{letters}%", limit))
            return [map_user_row(r) for r in cur.fetchall()]

        like_q = f"%{q}%"
        like_uid = f"%{normalize_uid(q)}%"
        sql = """
            SELECT uid, name, balance, plate_digits, plate_letters, blocked
            FROM users
            WHERE REPLACE(REPLACE(UPPER(uid), ' ', ''), '-', '') LIKE %s
               OR name LIKE %s
               OR plate_digits LIKE %s
               OR plate_letters LIKE %s
            ORDER BY uid
            LIMIT %s
        """
        cur.execute(sql, (like_uid, like_q, like_q, like_q, limit))
        return [map_user_row(r) for r in cur.fetchall()]
    finally:
        cur.close()
        con.close()


def db_wallet_charge_atomic(station_id: str, uid: str, service: str, req_id: str) -> Dict[str, Any]:
    uid = normalize_uid(uid)
    original_price = SERVICE_PRICES.get(service)
    if original_price is None:
        return {"approved": False, "price": 0, "new_balance": None, "reason": "invalid_service"}

    con = db_connect()
    cur = dict_cursor(con)

    try:
        con.begin()

        cur.execute("SELECT balance, blocked FROM users WHERE uid=%s FOR UPDATE", (uid,))
        row = cur.fetchone()

        if not row:
            approved = 0
            reason = "user_not_found"
            balance_before = None
            balance_after = None
            final_price = 0
            discount_pct = 0.0
            is_free = 0
        elif int(row.get("blocked", 0)) == 1:
            approved = 0
            reason = "user_blocked"
            balance_before = int(row["balance"])
            balance_after = balance_before
            final_price = 0
            discount_pct = 0.0
            is_free = 0
        else:
            balance_before = int(row["balance"])

            cur.execute("SELECT enabled, discount_pct FROM service_discounts WHERE service=%s", (service,))
            disc_row = cur.fetchone() or {}
            discount_enabled = bool(disc_row.get("enabled", 0))
            discount_pct = float(disc_row.get("discount_pct") or 0)

            cur.execute("SELECT streak_count FROM loyalty_progress WHERE uid=%s AND service=%s FOR UPDATE", (uid, service))
            lp = cur.fetchone()
            streak_count = int(lp["streak_count"]) if lp else 0

            is_free = 1 if streak_count >= 7 else 0
            if is_free:
                final_price = 0
                discount_pct = 0.0
            else:
                discounted = original_price
                if discount_enabled and discount_pct > 0:
                    discounted = round(original_price * (1 - (discount_pct / 100.0)))
                final_price = max(int(discounted), 0)

            if balance_before >= final_price:
                balance_after = balance_before - final_price
                cur.execute("UPDATE users SET balance=%s, updated_at=%s WHERE uid=%s", (balance_after, int(time.time()), uid))
                approved = 1
                reason = ""

                new_streak = 0 if is_free else streak_count + 1
                cur.execute(
                    """
                    INSERT INTO loyalty_progress(uid, service, streak_count, updated_at)
                    VALUES(%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE streak_count = VALUES(streak_count), updated_at = VALUES(updated_at)
                    """,
                    (uid, service, new_streak, int(time.time())),
                )
            else:
                balance_after = balance_before
                approved = 0
                reason = "insufficient_balance"

        cur.execute("""
            INSERT INTO transactions(
                ts, station_id, uid, service, price, approved, req_id,
                balance_before, balance_after, reason, original_price, final_price, discount_pct, is_free
            ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            int(time.time()), station_id, uid, service, int(final_price if 'final_price' in locals() else 0), int(approved), req_id,
            balance_before, balance_after, reason, int(original_price), int(final_price if 'final_price' in locals() else 0), float(discount_pct if 'discount_pct' in locals() else 0), int(is_free if 'is_free' in locals() else 0)
        ))

        con.commit()
        return {
            "approved": bool(approved),
            "price": int(final_price if 'final_price' in locals() else 0),
            "new_balance": balance_after,
            "reason": reason,
            "original_price": int(original_price),
            "final_price": int(final_price if 'final_price' in locals() else 0),
            "discount_pct": float(discount_pct if 'discount_pct' in locals() else 0),
            "is_free": bool(is_free if 'is_free' in locals() else 0),
        }

    except pymysql.err.IntegrityError:
        con.rollback()
        cur.execute(
            "SELECT approved, price, balance_after, reason, service, original_price, final_price, discount_pct, is_free FROM transactions WHERE req_id=%s",
            (req_id,)
        )
        prev = cur.fetchone()
        if prev:
            return {
                "approved": bool(prev["approved"]),
                "price": int(prev["price"]),
                "new_balance": prev["balance_after"],
                "reason": prev["reason"] or "",
                "service": prev["service"],
                "original_price": int(prev.get("original_price") or prev["price"]),
                "final_price": int(prev.get("final_price") or prev["price"]),
                "discount_pct": float(prev.get("discount_pct") or 0),
                "is_free": bool(prev.get("is_free") or 0),
                "duplicate": True,
            }
        return {"approved": False, "price": 0, "new_balance": None, "reason": "duplicate_req_id"}

    except Exception as e:
        con.rollback()
        return {"approved": False, "price": 0, "new_balance": None, "reason": f"server_error:{type(e).__name__}"}

    finally:
        cur.close()
        con.close()


# ===================== DATA HELPERS =====================
def data_insert_point(ts: int, station_id: str, metric: str, value: float, unit: str = "", uid: str = ""):
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            """
            INSERT INTO sensor_points(ts, station_id, uid, metric, value, unit)
            VALUES(%s,%s,%s,%s,%s,%s)
            """,
            (int(ts), station_id, normalize_uid(uid), metric, float(value), unit or "")
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def data_insert_mission(ts: int, station_id: str, device: str, uid: str, req_id: str, m: Dict[str, Any]):
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute("""
            INSERT INTO missions(
                ts, station_id, device, uid, req_id,
                total_air_l, total_water_l,
                avg_env_temperature_c, avg_env_humidity_pct,
                avg_water_temperature_c, avg_tds_ppm, avg_turbidity_ntu,
                samples
            ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            int(ts), station_id, device or "", normalize_uid(uid), req_id or "",
            _f(m.get("total_air_l")), _f(m.get("total_water_l")),
            _f(m.get("avg_env_temperature_c")), _f(m.get("avg_env_humidity_pct")),
            _f(m.get("avg_water_temperature_c")), _f(m.get("avg_tds_ppm")), _f(m.get("avg_turbidity_ntu")),
            _i(m.get("samples")),
        ))
        con.commit()
    finally:
        cur.close()
        con.close()


def data_get_points(station_id: str, metric: str, since_ts: int, limit: int = 8000):
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute(
            """
            SELECT ts, value, unit
            FROM sensor_points
            WHERE station_id=%s AND metric=%s AND ts>=%s
            ORDER BY ts ASC
            LIMIT %s
            """,
            (station_id, metric, int(since_ts), int(limit))
        )
        rows = cur.fetchall()
        return [{"ts": int(r["ts"]), "value": float(r["value"]), "unit": r["unit"]} for r in rows]
    finally:
        cur.close()
        con.close()


def data_get_mission_points(station_id: str, metric: str, since_ts: int, limit: int = 8000):
    allowed = {
        "total_air_l",
        "total_water_l",
        "avg_env_temperature_c",
        "avg_env_humidity_pct",
        "avg_water_temperature_c",
        "avg_tds_ppm",
        "avg_turbidity_ntu",
        "samples",
    }
    if metric not in allowed:
        return []

    con = db_connect()
    cur = dict_cursor(con)
    try:
        sql = f"""
            SELECT ts, {metric} AS value
            FROM missions
            WHERE station_id=%s
              AND ts >= %s
              AND {metric} IS NOT NULL
            ORDER BY ts ASC
            LIMIT %s
        """
        cur.execute(sql, (station_id, int(since_ts), int(limit)))
        rows = cur.fetchall()
        return [{"ts": int(r["ts"]), "value": float(r["value"]), "unit": ""} for r in rows]
    finally:
        cur.close()
        con.close()


def db_get_known_stations() -> List[str]:
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute("""
            SELECT station_id FROM station_services
            UNION
            SELECT station_id FROM missions
            UNION
            SELECT station_id FROM sensor_points
            ORDER BY station_id
        """)
        rows = cur.fetchall()
        return [str(r["station_id"]) for r in rows if r.get("station_id")]
    finally:
        cur.close()
        con.close()


def db_get_latest_mission(station_id: str):
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute("""
            SELECT ts, uid, req_id, total_air_l, total_water_l,
                   avg_env_temperature_c, avg_env_humidity_pct,
                   avg_water_temperature_c, avg_tds_ppm,
                   avg_turbidity_ntu, samples
            FROM missions
            WHERE station_id=%s
            ORDER BY ts DESC, id DESC
            LIMIT 1
        """, (station_id,))
        return cur.fetchone()
    finally:
        cur.close()
        con.close()


def hydrate_latest_from_db():
    stations = db_get_known_stations()
    snapshot: Dict[str, Dict[str, Any]] = {}
    for station in stations:
        st: Dict[str, Any] = {}
        mission = db_get_latest_mission(station)
        if mission:
            st["mission_summary"] = {
                "ts": int(mission["ts"]),
                "uid": mission.get("uid", "") or "",
                "req_id": mission.get("req_id", "") or "",
                "total_air_l": _f(mission.get("total_air_l")),
                "total_water_l": _f(mission.get("total_water_l")),
                "avg_env_temperature_c": _f(mission.get("avg_env_temperature_c")),
                "avg_env_humidity_pct": _f(mission.get("avg_env_humidity_pct")),
                "avg_water_temperature_c": _f(mission.get("avg_water_temperature_c")),
                "avg_tds_ppm": _f(mission.get("avg_tds_ppm")),
                "avg_turbidity_ntu": _f(mission.get("avg_turbidity_ntu")),
                "samples": _i(mission.get("samples")),
            }
        snapshot[station] = st

    with latest_lock:
        latest.clear()
        latest.update(snapshot)


# ===================== ANALYTICS =====================
def db_get_user_visits_summary():
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute("""
            SELECT uid, COUNT(*) AS visits_count
            FROM transactions
            WHERE approved = 1
            GROUP BY uid
            ORDER BY uid
        """)
        return [{"uid": str(r["uid"]), "visits_count": int(r["visits_count"])} for r in cur.fetchall()]
    finally:
        cur.close()
        con.close()


def db_get_analytics_overview(year: int, station_id: Optional[str] = None):
    start_ts, end_ts = _year_bounds(year)
    con = db_connect()
    cur = dict_cursor(con)
    try:
        if station_id:
            cur.execute("""
                SELECT COUNT(*) AS visits_count, COALESCE(SUM(price), 0) AS revenue_sar
                FROM transactions
                WHERE approved = 1 AND station_id = %s AND ts >= %s AND ts < %s
            """, (station_id, start_ts, end_ts))
        else:
            cur.execute("""
                SELECT COUNT(*) AS visits_count, COALESCE(SUM(price), 0) AS revenue_sar
                FROM transactions
                WHERE approved = 1 AND ts >= %s AND ts < %s
            """, (start_ts, end_ts))
        tx = cur.fetchone() or {}

        if station_id:
            cur.execute("""
                SELECT
                    COUNT(*) AS missions_count,
                    COALESCE(SUM(total_water_l), 0) AS total_water_l,
                    COALESCE(SUM(total_air_l), 0) AS total_air_l,
                    AVG(avg_tds_ppm) AS avg_tds_ppm,
                    AVG(avg_turbidity_ntu) AS avg_turbidity_ntu,
                    AVG(avg_env_temperature_c) AS avg_env_temperature_c,
                    AVG(avg_env_humidity_pct) AS avg_env_humidity_pct,
                    AVG(avg_water_temperature_c) AS avg_water_temperature_c
                FROM missions
                WHERE station_id = %s AND ts >= %s AND ts < %s
            """, (station_id, start_ts, end_ts))
        else:
            cur.execute("""
                SELECT
                    COUNT(*) AS missions_count,
                    COALESCE(SUM(total_water_l), 0) AS total_water_l,
                    COALESCE(SUM(total_air_l), 0) AS total_air_l,
                    AVG(avg_tds_ppm) AS avg_tds_ppm,
                    AVG(avg_turbidity_ntu) AS avg_turbidity_ntu,
                    AVG(avg_env_temperature_c) AS avg_env_temperature_c,
                    AVG(avg_env_humidity_pct) AS avg_env_humidity_pct,
                    AVG(avg_water_temperature_c) AS avg_water_temperature_c
                FROM missions
                WHERE ts >= %s AND ts < %s
            """, (start_ts, end_ts))
        ms = cur.fetchone() or {}

        return {
            "ok": True,
            "year": year,
            "station": station_id or "",
            "totals": {
                "revenue_sar": int(tx.get("revenue_sar") or 0),
                "visits_count": int(tx.get("visits_count") or 0),
                "missions_count": int(ms.get("missions_count") or 0),
                "total_water_l": float(ms.get("total_water_l") or 0),
                "total_air_l": float(ms.get("total_air_l") or 0),
                "avg_tds_ppm": float(ms.get("avg_tds_ppm") or 0),
                "avg_turbidity_ntu": float(ms.get("avg_turbidity_ntu") or 0),
                "avg_env_temperature_c": float(ms.get("avg_env_temperature_c") or 0),
                "avg_env_humidity_pct": float(ms.get("avg_env_humidity_pct") or 0),
                "avg_water_temperature_c": float(ms.get("avg_water_temperature_c") or 0),
            }
        }
    finally:
        cur.close()
        con.close()


def db_get_analytics_monthly(year: int, station_id: Optional[str] = None):
    start_ts, end_ts = _year_bounds(year)
    con = db_connect()
    cur = dict_cursor(con)
    try:
        if station_id:
            cur.execute("""
                SELECT MONTH(FROM_UNIXTIME(ts)) AS month_num, COUNT(*) AS visits_count, COALESCE(SUM(price), 0) AS revenue_sar
                FROM transactions
                WHERE approved = 1 AND station_id = %s AND ts >= %s AND ts < %s
                GROUP BY MONTH(FROM_UNIXTIME(ts))
            """, (station_id, start_ts, end_ts))
        else:
            cur.execute("""
                SELECT MONTH(FROM_UNIXTIME(ts)) AS month_num, COUNT(*) AS visits_count, COALESCE(SUM(price), 0) AS revenue_sar
                FROM transactions
                WHERE approved = 1 AND ts >= %s AND ts < %s
                GROUP BY MONTH(FROM_UNIXTIME(ts))
            """, (start_ts, end_ts))
        tx_rows = {int(r["month_num"]): r for r in cur.fetchall()}

        if station_id:
            cur.execute("""
                SELECT MONTH(FROM_UNIXTIME(ts)) AS month_num,
                       COUNT(*) AS missions_count,
                       COALESCE(SUM(total_water_l), 0) AS total_water_l,
                       COALESCE(SUM(total_air_l), 0) AS total_air_l,
                       AVG(avg_tds_ppm) AS avg_tds_ppm,
                       AVG(avg_turbidity_ntu) AS avg_turbidity_ntu,
                       AVG(avg_env_temperature_c) AS avg_env_temperature_c,
                       AVG(avg_env_humidity_pct) AS avg_env_humidity_pct,
                       AVG(avg_water_temperature_c) AS avg_water_temperature_c
                FROM missions
                WHERE station_id = %s AND ts >= %s AND ts < %s
                GROUP BY MONTH(FROM_UNIXTIME(ts))
            """, (station_id, start_ts, end_ts))
        else:
            cur.execute("""
                SELECT MONTH(FROM_UNIXTIME(ts)) AS month_num,
                       COUNT(*) AS missions_count,
                       COALESCE(SUM(total_water_l), 0) AS total_water_l,
                       COALESCE(SUM(total_air_l), 0) AS total_air_l,
                       AVG(avg_tds_ppm) AS avg_tds_ppm,
                       AVG(avg_turbidity_ntu) AS avg_turbidity_ntu,
                       AVG(avg_env_temperature_c) AS avg_env_temperature_c,
                       AVG(avg_env_humidity_pct) AS avg_env_humidity_pct,
                       AVG(avg_water_temperature_c) AS avg_water_temperature_c
                FROM missions
                WHERE ts >= %s AND ts < %s
                GROUP BY MONTH(FROM_UNIXTIME(ts))
            """, (start_ts, end_ts))
        mission_rows = {int(r["month_num"]): r for r in cur.fetchall()}

        items = []
        for month in range(1, 13):
            tx = tx_rows.get(month, {})
            ms = mission_rows.get(month, {})
            items.append({
                "month": month,
                "month_name": month_name[month],
                "revenue_sar": int(tx.get("revenue_sar") or 0),
                "visits_count": int(tx.get("visits_count") or 0),
                "missions_count": int(ms.get("missions_count") or 0),
                "total_water_l": float(ms.get("total_water_l") or 0),
                "total_air_l": float(ms.get("total_air_l") or 0),
                "avg_tds_ppm": float(ms.get("avg_tds_ppm") or 0),
                "avg_turbidity_ntu": float(ms.get("avg_turbidity_ntu") or 0),
                "avg_env_temperature_c": float(ms.get("avg_env_temperature_c") or 0),
                "avg_env_humidity_pct": float(ms.get("avg_env_humidity_pct") or 0),
                "avg_water_temperature_c": float(ms.get("avg_water_temperature_c") or 0),
            })
        return items
    finally:
        cur.close()
        con.close()


def db_get_service_discounts():
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute("SELECT service, enabled, discount_pct, updated_at FROM service_discounts")
        rows = cur.fetchall()
        return {
            str(r["service"]): {
                "enabled": bool(r.get("enabled", 0)),
                "discount_pct": float(r.get("discount_pct") or 0),
                "updated_at": int(r.get("updated_at") or 0),
            }
            for r in rows
        }
    finally:
        cur.close()
        con.close()


def db_set_service_discount(service: str, enabled: bool, discount_pct: float):
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            """
            INSERT INTO service_discounts(service, enabled, discount_pct, updated_at)
            VALUES(%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
              enabled = VALUES(enabled),
              discount_pct = VALUES(discount_pct),
              updated_at = VALUES(updated_at)
            """,
            (service, 1 if enabled else 0, float(discount_pct), int(time.time())),
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_get_loyalty_progress(uid: str, service: str):
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute(
            "SELECT streak_count FROM loyalty_progress WHERE uid=%s AND service=%s",
            (normalize_uid(uid), service),
        )
        row = cur.fetchone()
        return int(row["streak_count"]) if row else 0
    finally:
        cur.close()
        con.close()


def db_set_loyalty_progress(uid: str, service: str, streak_count: int):
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute(
            """
            INSERT INTO loyalty_progress(uid, service, streak_count, updated_at)
            VALUES(%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
              streak_count = VALUES(streak_count),
              updated_at = VALUES(updated_at)
            """,
            (normalize_uid(uid), service, int(streak_count), int(time.time())),
        )
        con.commit()
    finally:
        cur.close()
        con.close()


def db_get_analytics_summary(year: int, station_id: Optional[str] = None):
    overview = db_get_analytics_overview(year, station_id)
    monthly = db_get_analytics_monthly(year, station_id)

    con = db_connect()
    cur = dict_cursor(con)
    try:
        start_ts, end_ts = _year_bounds(year)
        if station_id:
            cur.execute("""
                SELECT service, COUNT(*) AS cnt
                FROM transactions
                WHERE approved = 1 AND station_id=%s AND ts >= %s AND ts < %s
                GROUP BY service
                ORDER BY cnt DESC
            """, (station_id, start_ts, end_ts))
        else:
            cur.execute("""
                SELECT service, COUNT(*) AS cnt
                FROM transactions
                WHERE approved = 1 AND ts >= %s AND ts < %s
                GROUP BY service
                ORDER BY cnt DESC
            """, (start_ts, end_ts))
        service_rows = cur.fetchall()

        if station_id:
            cur.execute("SELECT COALESCE(SUM(balance),0) AS total_credit, AVG(balance) AS avg_budget FROM users")
        else:
            cur.execute("SELECT COALESCE(SUM(balance),0) AS total_credit, AVG(balance) AS avg_budget FROM users")
        credit = cur.fetchone() or {}
    finally:
        cur.close(); con.close()

    distinct_users = max(len({item.get('uid') for item in db_get_user_visits_summary() if item.get('uid')}), 1)
    revenue = overview['totals']['revenue_sar']
    arpu = revenue / distinct_users if distinct_users else 0

    avg_return_days = 0
    counts=[]
    # derive rough histogram from per-user transaction gaps by using visits summary not enough; placeholder buckets from monthly
    if monthly:
        counts = [
            {"bucket": "0-7", "count": 0},
            {"bucket": "8-14", "count": 0},
            {"bucket": "15-30", "count": 0},
            {"bucket": ">30", "count": 0},
        ]

    latest_tds = overview['totals'].get('avg_tds_ppm', 0)
    latest_turb = overview['totals'].get('avg_turbidity_ntu', 0)

    service_mix = [{"service": r['service'], "count": int(r['cnt'])} for r in service_rows]
    most_frequent_service = service_mix[0]['service'] if service_mix else ''
    most_frequent_count = service_mix[0]['count'] if service_mix else 0

    return {
        "ok": True,
        "year": year,
        "station": station_id or "",
        "revenue": {
            "total_revenue_sar": revenue,
            "arpu_sar": round(arpu, 2),
        },
        "retention": {
            "avg_return_days": round(avg_return_days, 2),
        },
        "retention_histogram": counts,
        "water_quality": {
            "latest_tds_ppm": latest_tds,
            "latest_turbidity_ntu": latest_turb,
        },
        "operations": {
            "avg_water_flow_per_cycle_l": overview['totals'].get('total_water_l', 0) / max(overview['totals'].get('missions_count', 1), 1),
            "baseline_water_l": 100,
        },
        "environment": {
            "avg_env_temperature_c": overview['totals'].get('avg_env_temperature_c', 0),
            "avg_env_humidity_pct": overview['totals'].get('avg_env_humidity_pct', 0),
        },
        "credit": {
            "total_credit_sar": int(credit.get('total_credit') or 0),
            "avg_budget_per_user_sar": round(float(credit.get('avg_budget') or 0), 2),
        },
        "service_mix": {
            "items": service_mix,
            "most_frequent_service": most_frequent_service,
            "most_frequent_count": most_frequent_count,
        },
        "service_mix_list": service_mix,
    }


# ===================== SERVICE SELECTION =====================
def db_set_station_service(station_id: str, service: str):
    con = db_connect()
    cur = con.cursor()
    try:
        cur.execute("""
            INSERT INTO station_services(station_id, service, updated_at)
            VALUES(%s, %s, %s)
            ON DUPLICATE KEY UPDATE service = VALUES(service), updated_at = VALUES(updated_at)
        """, (station_id, service, int(time.time())))
        con.commit()
    finally:
        cur.close()
        con.close()


def db_load_station_services():
    con = db_connect()
    cur = dict_cursor(con)
    try:
        cur.execute("SELECT station_id, service FROM station_services")
        return cur.fetchall()
    finally:
        cur.close()
        con.close()


def load_station_services_into_memory():
    rows = db_load_station_services()
    with service_lock:
        station_service.clear()
        for r in rows:
            station_id = str(r.get("station_id") or "").strip()
            service = str(r.get("service") or "").strip()
            if station_id and service in SERVICE_PRICES:
                station_service[station_id] = service


def get_station_service(station_id: str) -> str:
    with service_lock:
        return station_service.get(station_id, DEFAULT_SERVICE)


def set_station_service(station_id: str, service: str):
    if service not in SERVICE_PRICES:
        raise ValueError("invalid_service")
    with service_lock:
        station_service[station_id] = service
    db_set_station_service(station_id, service)


# ===================== MQTT =====================
def mqtt_publish(topic: str, payload: str, qos: int = 1, retain: bool = False):
    with mqtt_lock:
        c = mqtt_client
    if c is not None:
        c.publish(topic, payload, qos=qos, retain=retain)


def parse_station(topic: str) -> Optional[str]:
    parts = topic.split("/")
    if len(parts) >= 2 and parts[0] == "carwash":
        return parts[1]
    return None


def on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"MQTT connected. reason_code={reason_code}")
    client.subscribe("carwash/+/wallet/request", qos=1)
    client.subscribe("carwash/+/mission/summary", qos=1)


def on_disconnect(client, userdata, reason_code, properties=None):
    print(f"MQTT disconnected. reason_code={reason_code}")


def _store_metric_point(ts: int, station: str, metric: str, value, unit: str, uid: str = ""):
    v = _f(value)
    if v is None:
        return
    data_insert_point(ts, station, metric, v, unit, uid=uid)


def on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload.decode("utf-8", errors="ignore")
    station = parse_station(topic)
    if not station:
        return

    if topic.endswith("/wallet/request"):
        try:
            req = json.loads(payload)
        except Exception:
            return
        req_id = str(req.get("req_id", "")).strip()
        uid = normalize_uid(req.get("uid", ""))
        if not req_id or not uid:
            return
        service = get_station_service(station)
        result = db_wallet_charge_atomic(station, uid, service, req_id)
        service_used = result.get("service", service)
        resp = {
            "req_id": req_id,
            "uid": uid,
            "service": service_used,
            "approved": bool(result["approved"]),
            "price": int(result["price"]),
            "new_balance": result["new_balance"],
            "reason": result.get("reason", "")
        }
        mqtt_publish(f"carwash/{station}/wallet/response", json.dumps(resp), qos=1, retain=False)
        return

    if topic.endswith("/mission/summary"):
        try:
            d = json.loads(payload)
        except Exception:
            return
        ts = int(d.get("ts", int(time.time())))
        device = str(d.get("device", "")).strip()
        uid = normalize_uid(d.get("uid", ""))
        req_id = str(d.get("req_id", "")).strip()
        mission = d.get("mission", d)
        if not isinstance(mission, dict):
            mission = {}

        with latest_lock:
            st = latest.setdefault(station, {})
            st["mission_summary"] = {
                "ts": ts,
                "uid": uid,
                "req_id": req_id,
                "total_air_l": _f(mission.get("total_air_l")),
                "total_water_l": _f(mission.get("total_water_l")),
                "avg_env_temperature_c": _f(mission.get("avg_env_temperature_c")),
                "avg_env_humidity_pct": _f(mission.get("avg_env_humidity_pct")),
                "avg_water_temperature_c": _f(mission.get("avg_water_temperature_c")),
                "avg_tds_ppm": _f(mission.get("avg_tds_ppm")),
                "avg_turbidity_ntu": _f(mission.get("avg_turbidity_ntu")),
                "samples": _i(mission.get("samples")),
            }

        try:
            data_insert_mission(ts, station, device, uid, req_id, mission)
        except Exception as e:
            print("mission insert error:", repr(e))

        try:
            _store_metric_point(ts, station, "total_air_l", mission.get("total_air_l"), "l", uid=uid)
            _store_metric_point(ts, station, "total_water_l", mission.get("total_water_l"), "l", uid=uid)
            _store_metric_point(ts, station, "avg_env_temperature_c", mission.get("avg_env_temperature_c"), "c", uid=uid)
            _store_metric_point(ts, station, "avg_env_humidity_pct", mission.get("avg_env_humidity_pct"), "pct", uid=uid)
            _store_metric_point(ts, station, "avg_water_temperature_c", mission.get("avg_water_temperature_c"), "c", uid=uid)
            _store_metric_point(ts, station, "avg_tds_ppm", mission.get("avg_tds_ppm"), "ppm", uid=uid)
            _store_metric_point(ts, station, "avg_turbidity_ntu", mission.get("avg_turbidity_ntu"), "ntu", uid=uid)
            _store_metric_point(ts, station, "samples", mission.get("samples"), "count", uid=uid)
        except Exception as e:
            print("metric store error:", repr(e))
        return


def mqtt_thread():
    global mqtt_client
    if not MQTT_HOST or not MQTT_USER or not MQTT_PASS:
        print("Missing MQTT env vars.")
        return
    while True:
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(MQTT_USER, MQTT_PASS)
            client.tls_set(ca_certs=certifi.where(), cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
            client.tls_insecure_set(False)
            client.on_connect = on_connect
            client.on_disconnect = on_disconnect
            client.on_message = on_message
            print(f"MQTT connecting to {MQTT_HOST}:{MQTT_PORT} (TLS).")
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            with mqtt_lock:
                mqtt_client = client
            client.loop_forever()
        except Exception as e:
            print("MQTT thread error:", repr(e))
            time.sleep(3)


# ===================== WEBSOCKET =====================
@sock.route("/ws")
def ws(ws):
    try:
        hydrate_latest_from_db()
        while True:
            with latest_lock:
                payload = _deep_copy_jsonable(latest)
            ws.send(json.dumps(payload))
            time.sleep(1)
    except Exception:
        return


# ===================== API =====================
@app.get("/")
def home():
    return "carwash backend is running"


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "service": "carwash-backend",
        "instance_connection_name": INSTANCE_CONNECTION_NAME
    })


@app.get("/api/stations/services")
def api_get_station_services():
    known_stations = db_get_known_stations()
    with service_lock:
        services = {station: station_service.get(station, DEFAULT_SERVICE) for station in known_stations}
        for station, service in station_service.items():
            services[station] = service
    return jsonify({
        "ok": True,
        "default": DEFAULT_SERVICE,
        "services": services,
        "prices": SERVICE_PRICES,
        "discounts": db_get_service_discounts(),
    })


@app.post("/api/services/<service>/discount")
def api_set_service_discount(service: str):
    if service not in SERVICE_PRICES:
        return jsonify({"ok": False, "error": "invalid_service"}), 400
    body = request.get_json(force=True, silent=True) or {}
    enabled = bool(body.get("enabled", False))
    discount_pct = float(body.get("discount_pct", 0) or 0)
    if discount_pct < 0 or discount_pct > 100:
        return jsonify({"ok": False, "error": "invalid_discount_pct"}), 400
    db_set_service_discount(service, enabled, discount_pct)
    return jsonify({"ok": True, "service": service, "enabled": enabled, "discount_pct": discount_pct})


@app.post("/api/stations/<station_id>/service")
def api_set_station_service(station_id: str):
    body = request.get_json(force=True, silent=True) or {}
    service = str(body.get("service", "")).strip()
    if service not in SERVICE_PRICES:
        return jsonify({"ok": False, "error": "invalid_service"}), 400
    set_station_service(station_id, service)
    return jsonify({"ok": True, "station": station_id, "service": service, "price": SERVICE_PRICES[service]})


@app.get("/api/users/<path:uid>")
def api_get_user(uid: str):
    row = db_get_user(uid)
    if not row:
        return jsonify({"ok": False, "error": "user_not_found"}), 404
    return jsonify({"ok": True, **row})


@app.get("/api/users/search")
def api_search_users():
    q = (request.args.get("q") or "").strip()
    by = (request.args.get("by") or "any").strip().lower()
    by_map = {"any": "any", "uid": "uid", "name": "name", "carplate": "carplate", "id": "uid", "plate": "carplate"}
    if by not in by_map:
        return jsonify({"ok": False, "error": "invalid_search_type"}), 400
    rows = db_search_users(q, by=by_map[by], limit=500)
    return jsonify({"ok": True, "q": q, "by": by, "items": rows})


@app.get("/api/users/visits-summary")
def api_users_visits_summary():
    return jsonify({"ok": True, "items": db_get_user_visits_summary()})


@app.post("/api/users")
def api_add_user():
    body = request.get_json(force=True, silent=True) or {}
    uid = normalize_uid(body.get("uid", ""))
    name = str(body.get("name", "")).strip()
    balance = int(body.get("balance", 0))
    plate_digits = normalize_plate_digits(body.get("plate_digits", ""))
    plate_letters = normalize_plate_letters(body.get("plate_letters", ""))
    if not uid or not name or len(plate_digits) != 4 or len(plate_letters) != 3:
        return jsonify({"ok": False, "error": "uid_name_plate_required"}), 400
    try:
        db_add_user(uid, name, balance, plate_digits, plate_letters)
        return jsonify({"ok": True})
    except pymysql.err.IntegrityError:
        return jsonify({"ok": False, "error": "uid_already_exists"}), 409


def resolve_user_from_body(body: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    by = str(body.get("by", "")).strip().lower()
    if by == "uid":
        uid = normalize_uid(body.get("q", body.get("uid", "")))
        if not uid:
            return None, "uid_required"
        user = db_get_user(uid)
        return user, None if user else "user_not_found"
    if by == "carplate":
        digits = normalize_plate_digits(body.get("plate_digits", ""))
        letters = normalize_plate_letters(body.get("plate_letters", ""))
        if len(digits) != 4 or len(letters) != 3:
            return None, "plate_required"
        user = db_find_user_by_carplate(digits, letters)
        return user, None if user else "user_not_found"
    return None, "invalid_by"


@app.post("/api/users/block")
def api_block_user():
    body = request.get_json(force=True, silent=True) or {}
    blocked = bool(body.get("blocked", True))
    user, err = resolve_user_from_body(body)
    if err:
        return jsonify({"ok": False, "error": err}), 400 if err in {"invalid_by", "uid_required", "plate_required"} else 404
    db_set_blocked(user["uid"], blocked)
    updated = db_get_user(user["uid"])
    return jsonify({"ok": True, "user": updated})


@app.post("/api/users/add-balance")
def api_add_balance():
    body = request.get_json(force=True, silent=True) or {}
    amount = int(body.get("amount", 0))
    user, err = resolve_user_from_body(body)
    if err:
        return jsonify({"ok": False, "error": err}), 400 if err in {"invalid_by", "uid_required", "plate_required"} else 404
    db_add_balance(user["uid"], amount)
    updated = db_get_user(user["uid"])
    return jsonify({"ok": True, "user": updated, "delta": amount})


@app.post("/api/users/delete")
def api_delete_user():
    body = request.get_json(force=True, silent=True) or {}
    uid = normalize_uid(body.get("uid", ""))
    if not uid:
        return jsonify({"ok": False, "error": "uid_required"}), 400
    ok = db_delete_user(uid)
    if not ok:
        return jsonify({"ok": False, "error": "user_not_found"}), 404
    return jsonify({"ok": True})


@app.post("/api/users/<path:uid>/add")
def api_add_balance_legacy(uid: str):
    body = request.get_json(force=True, silent=True) or {}
    amount = int(body.get("amount", 0))
    user = db_get_user(uid)
    if not user:
        return jsonify({"ok": False, "error": "user_not_found"}), 404
    db_add_balance(uid, amount)
    return jsonify({"ok": True, "delta": amount})


@app.post("/api/users/<path:uid>/set")
def api_set_balance(uid: str):
    body = request.get_json(force=True, silent=True) or {}
    balance = int(body.get("balance", 0))
    user = db_get_user(uid)
    if not user:
        return jsonify({"ok": False, "error": "user_not_found"}), 404
    db_set_balance(uid, balance)
    return jsonify({"ok": True, "balance": balance})


@app.get("/api/history/<station_id>/<metric>")
def api_history(station_id: str, metric: str):
    range_key = (request.args.get("range") or "12h").strip()
    now = int(time.time())
    ranges = {"1h": 3600, "12h": 12 * 3600, "1d": 24 * 3600, "1w": 7 * 24 * 3600, "1m": 30 * 24 * 3600, "1y": 365 * 24 * 3600}
    seconds = ranges.get(range_key, 12 * 3600)
    since = now - seconds
    if metric in MISSION_HISTORY_METRICS:
        pts = data_get_mission_points(station_id, metric, since, limit=8000)
    else:
        pts = data_get_points(station_id, metric, since, limit=8000)
    return jsonify({"ok": True, "station": station_id, "metric": metric, "range": range_key, "points": pts})


@app.get("/api/analytics/overview")
def api_analytics_overview():
    year = int(request.args.get("year") or time.gmtime().tm_year)
    station = (request.args.get("station") or "").strip() or None
    return jsonify(db_get_analytics_overview(year, station))


@app.get("/api/analytics/summary")
def api_analytics_summary():
    year = int(request.args.get("year") or time.gmtime().tm_year)
    station = (request.args.get("station") or "").strip() or None
    return jsonify(db_get_analytics_summary(year, station))


@app.get("/api/analytics/monthly")
def api_analytics_monthly():
    year = int(request.args.get("year") or time.gmtime().tm_year)
    station = (request.args.get("station") or "").strip() or None
    return jsonify({"ok": True, "year": year, "station": station or "", "items": db_get_analytics_monthly(year, station)})


# ===================== STARTUP =====================
def start():
    global started
    with start_lock:
        if started:
            return
        init_db()
        load_station_services_into_memory()
        hydrate_latest_from_db()
        t = threading.Thread(target=mqtt_thread, daemon=True)
        t.start()
        started = True
        print("Server started.")


start()
