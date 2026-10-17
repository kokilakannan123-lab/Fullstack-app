
from fastapi import FastAPI

app = FastAPI(
    title="Fullstack Application",
    description="""
    ## React Frontend

    Backend response: Hello from FastAPI backend!

    ## Upload File

    Open the Fullstack Application webpage at:
    http://140.245.237.16:8000/
    """
)
