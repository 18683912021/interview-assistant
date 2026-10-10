"""The shipped file:// renderer must be able to call the authenticated API."""
import importlib
from unittest.mock import patch

import httpx
import pytest


@pytest.mark.asyncio
async def test_packaged_renderer_cors_and_untrusted_origin(monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS', 'null,http://localhost:5173,http://127.0.0.1:5173')
    # This test only exercises preflight/health, never startup or real credentials.
    with patch('dotenv.load_dotenv', return_value=False):
        main = importlib.import_module('app.main')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
        headers={'Origin':'null','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type'}
        response=await client.options('/api/workspace/interviews/test',headers=headers)
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'null'
        assert 'access-control-allow-credentials' not in response.headers
        denied=await client.options('/api/workspace/interviews/test',headers={**headers,'Origin':'https://untrusted.example'})
        assert denied.status_code == 400
        assert 'access-control-allow-origin' not in denied.headers
        health=await client.get('/health',headers={'Origin':'null'})
        assert health.status_code == 200 and health.headers['access-control-allow-origin'] == 'null'
