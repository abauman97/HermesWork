import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:9137/api/auth/providers", timeout=3) as response:
    assert response.status == 200

    assert any(
        p["name"] == "basic" and p.get("supports_password")
        for p in json.load(response)["providers"]
    )
