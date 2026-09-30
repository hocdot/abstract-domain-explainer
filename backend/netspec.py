'''JSON description of a toy fully-connected network and its input box.'''
from typing import Literal

import torch
from pydantic import BaseModel, Field, model_validator

# Keep the playground toy-sized (and a public server cheap to run).
MAX_WIDTH = 8
MAX_LAYERS = 6

DTYPE = torch.float64


class Dense(BaseModel):
    '''``activation(W x + b)`` with ``W`` of shape (out, in).'''
    weight: list[list[float]]
    bias: list[float]
    activation: Literal['relu', 'none'] = 'relu'

    @property
    def in_dim(self) -> int:
        return len(self.weight[0])

    @property
    def out_dim(self) -> int:
        return len(self.weight)

    @model_validator(mode='after')
    def _check_shape(self) -> 'Dense':
        if not self.weight or not self.weight[0]:
            raise ValueError('weight must be a non-empty (out, in) matrix')
        if any(len(row) != self.in_dim for row in self.weight):
            raise ValueError('weight rows must all have the same length')
        if len(self.bias) != self.out_dim:
            raise ValueError(f'bias has {len(self.bias)} entries, expected {self.out_dim}')
        if self.out_dim > MAX_WIDTH or self.in_dim > MAX_WIDTH:
            raise ValueError(f'layers are limited to {MAX_WIDTH} neurons')
        return self

    def tensors(self) -> tuple[torch.Tensor, torch.Tensor]:
        return torch.tensor(self.weight, dtype=DTYPE), torch.tensor(self.bias, dtype=DTYPE)


class Network(BaseModel):
    input_dim: int = Field(ge=1, le=MAX_WIDTH)
    layers: list[Dense] = Field(min_length=1, max_length=MAX_LAYERS)

    @model_validator(mode='after')
    def _check_chain(self) -> 'Network':
        dim = self.input_dim
        for k, layer in enumerate(self.layers, start=1):
            if layer.in_dim != dim:
                raise ValueError(f'layer {k} expects {layer.in_dim} inputs but receives {dim}')
            dim = layer.out_dim
        return self

    @property
    def output_dim(self) -> int:
        return self.layers[-1].out_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        '''Concrete forward pass, used for sampling and tests.'''
        return self.forward_stages(x)[-1]

    def forward_stages(self, x: torch.Tensor) -> list[torch.Tensor]:
        '''Concrete value of every stage (x, z1, h1, z2, ...), same order as the trace.'''
        out = [x]
        for layer in self.layers:
            W, b = layer.tensors()
            x = x @ W.T + b
            out.append(x)
            if layer.activation == 'relu':
                x = torch.relu(x)
                out.append(x)
        return out


class InputBox(BaseModel):
    lower: list[float]
    upper: list[float]

    @model_validator(mode='after')
    def _check_box(self) -> 'InputBox':
        if len(self.lower) != len(self.upper):
            raise ValueError('lower and upper must have the same length')
        if any(l > u for l, u in zip(self.lower, self.upper)):
            raise ValueError('every lower bound must be <= its upper bound')
        return self

    def tensors(self) -> tuple[torch.Tensor, torch.Tensor]:
        return torch.tensor(self.lower, dtype=DTYPE), torch.tensor(self.upper, dtype=DTYPE)
