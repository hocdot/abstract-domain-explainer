'''HTTP API. Run with ``uvicorn backend.app:app --reload``.'''
import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from .domains import REGISTRY
from .netspec import MAX_LAYERS, MAX_WIDTH, InputBox, Network
from .presets import PRESETS, random_network
from .schema import DomainInfo, Trace

app = FastAPI(title='Abstract Domain Playground API')

# The Vite dev server proxies /api, so CORS only matters once the frontend is
# hosted elsewhere (e.g. GitHub Pages): set ALLOWED_ORIGINS=https://you.github.io
origins = [o for o in os.environ.get('ALLOWED_ORIGINS', '').split(',') if o]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['*'], allow_headers=['*'])


class AnalyzeRequest(BaseModel):
    domain: str = 'ibp'
    network: Network
    input: InputBox

    @model_validator(mode='after')
    def _check_input(self) -> 'AnalyzeRequest':
        if len(self.input.lower) != self.network.input_dim:
            raise ValueError(f'input box has {len(self.input.lower)} dimensions, '
                             f'network expects {self.network.input_dim}')
        return self


class RandomRequest(BaseModel):
    sizes: list[int] = Field(min_length=2, max_length=MAX_LAYERS + 1)
    style: Literal['integer', 'decimal'] = 'integer'
    seed: int = 0

    @model_validator(mode='after')
    def _check_sizes(self) -> 'RandomRequest':
        if any(not 1 <= s <= MAX_WIDTH for s in self.sizes):
            raise ValueError(f'layer sizes must be between 1 and {MAX_WIDTH}')
        return self


@app.get('/api/health')
def health() -> dict:
    return {'ok': True}


@app.get('/api/domains')
def domains() -> list[DomainInfo]:
    return [d.info() for d in REGISTRY.values()]


@app.get('/api/presets')
def presets() -> list[dict]:
    return [{**p, 'network': p['network'].model_dump(), 'input': p['input'].model_dump()}
            for p in PRESETS]


@app.post('/api/random')
def random(req: RandomRequest) -> Network:
    return random_network(req.sizes, req.style, req.seed)


@app.post('/api/analyze')
def analyze(req: AnalyzeRequest) -> Trace:
    domain = REGISTRY.get(req.domain)
    if domain is None:
        raise HTTPException(400, f'unknown domain {req.domain!r}; available: {sorted(REGISTRY)}')
    return domain.run(req.network, req.input)
