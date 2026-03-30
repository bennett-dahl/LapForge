"""Google OAuth2 with PKCE for desktop Flask app (loopback redirect)."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from authlib.integrations.flask_client import OAuth
from flask import Blueprint, redirect, session, url_for

log = logging.getLogger(__name__)

oauth = OAuth()

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

_SCOPES = "openid email profile https://www.googleapis.com/auth/drive.file"


def init_oauth(app: Any) -> None:
    """Register the Google OAuth provider with the Flask app."""
    client_id = app.config.get("GOOGLE_CLIENT_ID")
    client_secret = app.config.get("GOOGLE_CLIENT_SECRET")

    if not client_id:
        log.info("GOOGLE_CLIENT_ID not set — OAuth login disabled")
        app.config["OAUTH_ENABLED"] = False
        return

    app.config["OAUTH_ENABLED"] = True
    oauth.init_app(app)
    oauth.register(
        name="google",
        client_id=client_id,
        client_secret=client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={
            "scope": _SCOPES,
            "code_challenge_method": "S256",
        },
    )


def _derive_user_key(issuer: str, sub: str) -> str:
    return hashlib.sha256(f"{issuer}|{sub}".encode()).hexdigest()


# ---- Token persistence via keyring (best-effort) ----

def _store_token(user_key: str, token: dict) -> None:
    try:
        import keyring
        keyring.set_password("LapForge", f"oauth:{user_key}", json.dumps(token))
    except Exception:
        log.warning("Could not store OAuth token in keyring", exc_info=True)


def get_stored_token(user_key: str) -> dict | None:
    try:
        import keyring
        raw = keyring.get_password("LapForge", f"oauth:{user_key}")
        if raw:
            return json.loads(raw)
    except Exception:
        log.debug("Could not read OAuth token from keyring", exc_info=True)
    return None


def clear_stored_token(user_key: str) -> None:
    try:
        import keyring
        keyring.delete_password("LapForge", f"oauth:{user_key}")
    except Exception:
        pass


# ---- Blueprint routes ----

@auth_bp.route("/login")
def login():
    if not oauth.google:
        return redirect(url_for("settings"))
    redirect_uri = url_for("auth.callback", _external=True)
    return oauth.google.authorize_redirect(
        redirect_uri,
        access_type="offline",
        prompt="consent",
    )


@auth_bp.route("/callback")
def callback():
    if not oauth.google:
        return redirect(url_for("index"))

    token = oauth.google.authorize_access_token()
    userinfo: dict = token.get("userinfo", {})

    if not userinfo.get("sub"):
        log.error("No 'sub' claim in ID token")
        return redirect(url_for("index"))

    issuer = userinfo.get("iss", "https://accounts.google.com")
    sub = userinfo["sub"]
    user_key = _derive_user_key(issuer, sub)

    session["user_key"] = user_key
    session["user_email"] = userinfo.get("email", "")
    session["user_name"] = userinfo.get("name", "")
    session["user_picture"] = userinfo.get("picture", "")
    session.permanent = True

    has_refresh = bool(token.get("refresh_token"))
    log.info("OAuth callback: got refresh_token=%s, token keys=%s", has_refresh, list(token.keys()))
    if has_refresh:
        _store_token(user_key, {
            "access_token": token.get("access_token"),
            "refresh_token": token.get("refresh_token"),
            "token_type": token.get("token_type", "Bearer"),
            "expires_at": token.get("expires_at"),
        })
    else:
        log.warning("No refresh_token in OAuth response — sync will not work until re-auth")

    from LapForge.config import AppConfig
    cfg = AppConfig()
    cfg.set_profile(user_key, {
        "email": userinfo.get("email", ""),
        "name": userinfo.get("name", ""),
        "picture": userinfo.get("picture", ""),
    })

    return redirect(url_for("index"))


@auth_bp.route("/logout")
def logout():
    user_key = session.pop("user_key", None)
    session.pop("user_email", None)
    session.pop("user_name", None)
    session.pop("user_picture", None)
    if user_key:
        clear_stored_token(user_key)
    return redirect(url_for("index"))


# ---- Helpers for other modules ----

def get_current_user() -> dict[str, str] | None:
    """Return current signed-in user info from Flask session, or None."""
    user_key = session.get("user_key")
    if not user_key:
        return None
    return {
        "user_key": user_key,
        "email": session.get("user_email", ""),
        "name": session.get("user_name", ""),
        "picture": session.get("user_picture", ""),
    }
