# backend/db.py
import os
import psycopg2
import psycopg2.extras

from dotenv import load_dotenv

# .env.backend 읽기 (원하는 파일명으로 맞춰도 됨)
load_dotenv(".env.backend")


def get_connection():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT", "5432"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
    )
    return conn
