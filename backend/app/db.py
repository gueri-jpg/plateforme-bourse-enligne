"""
Acces a la base de donnees PostgreSQL "bourse_db".

Ce module fournit une fonction utilitaire `get_connection()` qui ouvre une
connexion psycopg2 vers la base "bourse_db" decrite dans db/init.sql et
configuree dans docker-compose.yml (service "postgres").

Choix technique : psycopg2 "brut" (pas d'ORM) est suffisant pour ce module
admin, qui se limite a quelques lectures/ecritures simples sur des tables
de configuration (schema "administration"). Cela evite d'introduire une
dependance supplementaire (SQLAlchemy) pour un perimetre volontairement
restreint.
"""

from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extras

from app.config import settings


def _build_dsn() -> str:
    """Construit la chaine de connexion (DSN) PostgreSQL a partir de la configuration."""
    return (
        f"host={settings.POSTGRES_HOST} "
        f"port={settings.POSTGRES_PORT} "
        f"dbname={settings.POSTGRES_DB} "
        f"user={settings.POSTGRES_USER} "
        f"password={settings.POSTGRES_PASSWORD}"
    )


@contextmanager
def get_connection() -> Generator[psycopg2.extensions.connection, None, None]:
    """
    Fournit une connexion PostgreSQL sous forme de context manager.

    Utilisation typique :
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(...)

    La connexion est fermee automatiquement a la sortie du bloc "with",
    et un rollback est effectue automatiquement si une exception est levee
    (psycopg2 effectue un rollback implicite a la fermeture en cas d'erreur
    non commitee).
    """
    conn = psycopg2.connect(_build_dsn())
    try:
        yield conn
    finally:
        conn.close()


def get_dict_cursor(conn: psycopg2.extensions.connection):
    """
    Retourne un curseur dont les lignes sont accessibles comme des
    dictionnaires (cle = nom de colonne), pratique pour serialiser
    directement les resultats en JSON via Pydantic/FastAPI.
    """
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
