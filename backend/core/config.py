from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    DATABASE_SYSTEM_URL: str = ""
    REDIS_URL: str = "redis://redis:6379/0"
    SECRET_KEY: str
    ALLOWED_ORIGINS: str = "http://localhost:8080"
    UPLOAD_DIR: str = "/var/www/uploads"
    MAX_UPLOAD_SIZE_MB: int = 50
    JWT_EXPIRE_MINUTES: int = 480
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    CESIUM_ION_TOKEN: str = ""
    DEFAULT_STORAGE_LIMIT_MB: int = 1024  # 1GB default per user

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
