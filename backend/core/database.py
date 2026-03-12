from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from core.config import settings

# Data database (stories, slides, layers, media, markers)
engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# System database (users, basemaps, symbologies)
engine_system = create_async_engine(
    settings.DATABASE_SYSTEM_URL or settings.DATABASE_URL,
    echo=False, pool_size=5, max_overflow=10,
)
AsyncSessionSystem = async_sessionmaker(engine_system, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    """Data database session (stories, slides, layers, media)."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_system_db() -> AsyncSession:
    """System database session (users, basemaps, symbologies)."""
    async with AsyncSessionSystem() as session:
        try:
            yield session
        finally:
            await session.close()
