'''Domain-agnostic trace returned to the frontend.

A trace has two parts:

* ``stages``: every value the network computes (input, each pre-activation,
  each post-activation), with the bounds the domain proved for each neuron.
* ``steps``: an ordered story of how those bounds were obtained. Each step has
  a ``kind`` (e.g. ``ibp.affine``) and a free-form ``detail`` payload; the
  frontend picks an explanation renderer by ``kind``. A new domain adds new
  step kinds without touching existing ones.
'''
from typing import Any, Literal

from pydantic import BaseModel


class Bounds(BaseModel):
    lower: float
    upper: float


class Stage(BaseModel):
    index: int
    kind: Literal['input', 'affine', 'relu']
    layer: int              # 0 for the input, k for the k-th dense layer
    letter: str             # symbol letter: x, z, h, y
    sup: int | None         # layer superscript, e.g. z^(1); None for x and y
    size: int
    bounds: list[Bounds]


class Step(BaseModel):
    kind: str               # 'input' | 'output' | '<domain>.<what>'
    stage: int              # stage this step fills in
    neuron: int | None      # None when the step covers the whole stage
    detail: dict[str, Any]


class Check(BaseModel):
    '''Independent re-derivation of the bounds, so anyone can audit the domain.'''
    description: str
    max_abs_diff: float
    ok: bool


class Trace(BaseModel):
    domain: str
    stages: list[Stage]
    steps: list[Step]
    check: Check


class DomainInfo(BaseModel):
    key: str
    name: str
    short: str
    summary: str
