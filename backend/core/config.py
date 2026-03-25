from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    DATABASE_SYSTEM_URL: str = ""
    REDIS_URL: str = "redis://redis:6379/0"
    SECRET_KEY: str
    ALLOWED_ORIGINS: str = "http://localhost:8080"
    UPLOAD_DIR: str = "/var/www/uploads"
    MAX_UPLOAD_SIZE_MB: int = 50
    JWT_EXPIRE_MINUTES: int = 120  # 2 hours (was 8h - reduced for security)
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_TENANT_ID: str = "common"
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    CESIUM_ION_TOKEN: str = ""
    DEFAULT_STORAGE_LIMIT_MB: int = 1024  # 1GB default per user

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()

# Startup security checks
_INSECURE_SECRETS = {"changeme", "changeme-generate-a-random-secret-key", "secret", ""}
if settings.SECRET_KEY.lower().replace("-", "").replace("_", "") in {"changeme", "changemegeneratearandomsecretkey", "secret", ""}:
    import warnings
    warnings.warn(
        "\n⚠️  SECURITY WARNING: SECRET_KEY is set to a default/insecure value!\n"
        "   Generate a strong key: python -c \"import secrets; print(secrets.token_hex(32))\"\n",
        stacklevel=1,
    )
if settings.ADMIN_PASSWORD in ("admin", "password", "changeme", "123456"):
    import warnings
    warnings.warn(
        "\n⚠️  SECURITY WARNING: ADMIN_PASSWORD is set to a weak default value!\n"
        "   Change it in your .env file before deploying to production.\n",
        stacklevel=1,
    )
