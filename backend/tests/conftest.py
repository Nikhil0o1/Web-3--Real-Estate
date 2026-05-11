import os
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_db
from backend.db.connection import get_connection
from backend.db.schema import init_db
from backend.main import app


@pytest.fixture(scope="session")
def test_client():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL is not set")

    init_db()

    def override_get_db():
        db = get_connection()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    yield client
