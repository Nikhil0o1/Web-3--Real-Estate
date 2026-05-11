from psycopg2 import connect
from psycopg2.extras import RealDictCursor

from backend.config.settings import get_database_url


class PostgreSQLConnection:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self, dictionary: bool = False):
        if dictionary:
            return self._connection.cursor(cursor_factory=RealDictCursor)
        return self._connection.cursor()

    def commit(self):
        return self._connection.commit()

    def rollback(self):
        return self._connection.rollback()

    def close(self):
        return self._connection.close()

    def __getattr__(self, name):
        return getattr(self._connection, name)


def get_connection():
    return PostgreSQLConnection(connect(get_database_url()))
