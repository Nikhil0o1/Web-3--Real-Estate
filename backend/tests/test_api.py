def test_health(test_client):
    response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_create_property(test_client):
    payload = {
        "name": "Sunset Villas",
        "location": "Austin, TX",
        "total_value": "2500000",
        "token_supply": "1000000",
        "token_symbol": "SVT"
    }
    response = test_client.post("/properties", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Sunset Villas"
    assert data["token_symbol"] == "SVT"
