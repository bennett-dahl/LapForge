"""Keyring helpers for OAuth token storage and Google credentials."""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger(__name__)

_SERVICE = "LapForge"


def store_token(user_key: str, token: dict) -> None:
    try:
        import keyring
        keyring.set_password(_SERVICE, f"oauth:{user_key}", json.dumps(token))
    except Exception:
        log.warning("Could not store token in keyring", exc_info=True)


def get_token(user_key: str) -> dict | None:
    try:
        import keyring
        raw = keyring.get_password(_SERVICE, f"oauth:{user_key}")
        if raw:
            return json.loads(raw)
    except Exception:
        log.debug("Could not read token from keyring", exc_info=True)
    return None


def clear_token(user_key: str) -> None:
    try:
        import keyring
        keyring.delete_password(_SERVICE, f"oauth:{user_key}")
    except Exception:
        pass


def build_google_credentials(user_key: str, client_id: str, client_secret: str) -> Any | None:
    """Build google.oauth2.credentials.Credentials from stored refresh token."""
    token = get_token(user_key)
    if not token or not token.get("refresh_token"):
        return None
    try:
        from google.oauth2.credentials import Credentials
        return Credentials(
            token=token.get("access_token"),
            refresh_token=token["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
    except Exception:
        log.warning("Could not build Google credentials", exc_info=True)
        return None
