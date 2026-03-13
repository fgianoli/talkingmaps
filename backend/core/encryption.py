"""
TalkingMaps – API Key Encryption
Uses Fernet (AES-128-CBC + HMAC-SHA256) for symmetric encryption.
Keys are derived from the application's SECRET_KEY via PBKDF2.
"""
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
from core.config import settings

_SALT = b"talkingmaps-api-keys-v1"  # Fixed salt, combined with SECRET_KEY

def _get_fernet() -> Fernet:
    """Derive a Fernet key from the application SECRET_KEY."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=480000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode()))
    return Fernet(key)

def encrypt_api_key(plaintext: str) -> str:
    """Encrypt an API key. Returns a base64-encoded encrypted string."""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()

def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt an API key. Returns the plaintext string."""
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except Exception:
        return ""
