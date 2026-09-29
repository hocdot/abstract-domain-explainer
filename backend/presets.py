'''Hand-picked toy networks, plus a random generator.'''
import random
from typing import Literal

from .netspec import Dense, InputBox, Network

PRESETS = [
    {
        'key': 'three-relu-cases',
        'name': 'Three ReLU cases',
        'description': 'One hidden layer where a neuron is always on, one is always off, '
                       'and one could be either. A good first example.',
        'network': Network(input_dim=2, layers=[
            Dense(weight=[[1, 1], [-1, -1], [1, -1]], bias=[1, -0.5, 0]),
            Dense(weight=[[1, 1, 1], [1, 0, -1]], bias=[0, 0], activation='none'),
        ]),
        'input': InputBox(lower=[0, 0], upper=[1, 1]),
    },
    {
        'key': 'deeppoly-example',
        'name': 'DeepPoly paper example',
        'description': 'The 2-2-2-2 running example from Singh et al., "An Abstract Domain '
                       'for Certifying Neural Networks" (POPL 2019).',
        'network': Network(input_dim=2, layers=[
            Dense(weight=[[1, 1], [1, -1]], bias=[0, 0]),
            Dense(weight=[[1, 1], [1, -1]], bias=[0, 0]),
            Dense(weight=[[1, 1], [0, 1]], bias=[1, 0], activation='none'),
        ]),
        'input': InputBox(lower=[-1, -1], upper=[1, 1]),
    },
]


def random_network(sizes: list[int], style: Literal['integer', 'decimal'], seed: int) -> Network:
    '''``sizes = [input, hidden..., output]``; ReLU on every layer but the last.'''
    rng = random.Random(seed)

    def draw(scale: float) -> float:
        if style == 'integer':
            return float(rng.choice([-2, -1, -1, 0, 1, 1, 2]) if scale == 1 else rng.choice([-1, 0, 0, 1]))
        return round(rng.gauss(0, scale), 1)

    layers = []
    for k, (n_in, n_out) in enumerate(zip(sizes, sizes[1:])):
        last = k == len(sizes) - 2
        layers.append(Dense(
            weight=[[draw(1) for _ in range(n_in)] for _ in range(n_out)],
            bias=[draw(0.5) for _ in range(n_out)],
            activation='none' if last else 'relu',
        ))
    return Network(input_dim=sizes[0], layers=layers)
