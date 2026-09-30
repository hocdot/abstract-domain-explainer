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


class LinBound(BaseModel):
    '''sum_i coeffs[i] * x_i + const, a linear function of the inputs.'''
    coeffs: list[float]
    const: float


class LinearBounds(BaseModel):
    lower: LinBound
    upper: LinBound


class Line(BaseModel):
    slope: float
    bias: float


class Relaxation(BaseModel):
    '''lower.slope * z + lower.bias <= h <= upper.slope * z + upper.bias'''
    lower: Line
    upper: Line


class Stage(BaseModel):
    index: int
    kind: Literal['input', 'affine', 'relu']
    layer: int              # 0 for the input, k for the k-th dense layer
    letter: str             # symbol letter: x, z, h, y
    sup: int | None         # layer superscript, e.g. z^(1); None for x and y
    size: int
    bounds: list[Bounds]
    # min/max actually reached on sampled inputs: an inner estimate of the true range
    sampled: list[Bounds] = []
    # linear bounds over the inputs, for domains that have them (DeepPoly, CROWN, ...)
    linear: list[LinearBounds] = []
    # ReLU stages only: per-neuron linear bounds in terms of the pre-activation
    relax: list[Relaxation] = []


class Step(BaseModel):
    kind: str               # 'input' | 'output' | '<domain>.<what>'
    stage: int              # stage this step fills in
    neuron: int | None      # None when the step covers the whole stage
    detail: dict[str, Any]


class Check(BaseModel):
    '''An independent test of the bounds, so anyone can audit the domain.'''
    label: str              # e.g. 'Sound on sampled inputs'
    detail: str             # e.g. '4,000 inputs, all inside their bounds'
    ok: bool


class Trace(BaseModel):
    domain: str
    stages: list[Stage]
    steps: list[Step]
    checks: list[Check]


class DomainInfo(BaseModel):
    key: str
    name: str
    short: str
    summary: str
