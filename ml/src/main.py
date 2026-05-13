from fastapi import FastAPI
from .routes import router

app = FastAPI(title="Pokemon Battle ML Service")
app.include_router(router)
