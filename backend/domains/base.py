'''Domain interface, registry, and the stage layout every domain shares.'''
import itertools
from abc import ABC, abstractmethod

import torch

from ..netspec import DTYPE, InputBox, Network
from ..schema import Bounds, DomainInfo, Stage, Trace

N_SAMPLES = 4000
N_SHOWN = 100

REGISTRY: dict[str, 'Domain'] = {}


class Domain(ABC):
    key: str
    name: str
    short: str
    summary: str

    @abstractmethod
    def analyze(self, net: Network, box: InputBox) -> Trace:
        ...

    def run(self, net: Network, box: InputBox) -> Trace:
        '''``analyze``, then record the range each neuron reaches on sampled inputs.'''
        trace = self.analyze(net, box)
        attach_samples(trace, net, box)
        return trace

    def info(self) -> DomainInfo:
        return DomainInfo(key=self.key, name=self.name, short=self.short, summary=self.summary)


def register(cls: type[Domain]) -> type[Domain]:
    REGISTRY[cls.key] = cls()
    return cls


def stage_layout(net: Network) -> list[Stage]:
    '''Stages with empty bounds: x, then z^(k) and h^(k) per dense layer.
    The very last stage is named y.'''
    stages = [Stage(index=0, kind='input', layer=0, letter='x', sup=None,
                    size=net.input_dim, bounds=[])]
    for k, layer in enumerate(net.layers, start=1):
        stages.append(Stage(index=len(stages), kind='affine', layer=k, letter='z', sup=k,
                            size=layer.out_dim, bounds=[]))
        if layer.activation == 'relu':
            stages.append(Stage(index=len(stages), kind='relu', layer=k, letter='h', sup=k,
                                size=layer.out_dim, bounds=[]))
    stages[-1].letter, stages[-1].sup = 'y', None
    return stages


def to_bounds(lower, upper) -> list[Bounds]:
    return [Bounds(lower=float(l), upper=float(u)) for l, u in zip(lower, upper)]


def attach_samples(trace: Trace, net: Network, box: InputBox, n: int = N_SAMPLES, seed: int = 0) -> None:
    '''Run the real network on inputs spread over the box (plus its corners) and store the
    range each neuron actually reaches: an inner estimate of its true range, drawn
    inside the interval bars to show how loose a bound is.'''
    lower, upper = box.tensors()
    # quasi-Monte Carlo (scrambled Sobol): spreads the points evenly over the box instead of
    # the clumps and gaps of plain random sampling, so even the first 100 cover it well
    sobol = torch.quasirandom.SobolEngine(len(lower), scramble=True, seed=seed)
    xs = lower + (upper - lower) * sobol.draw(n, dtype=DTYPE)
    if len(lower) <= 10:
        corners = torch.tensor(list(itertools.product(*zip(box.lower, box.upper))), dtype=DTYPE)
        xs = torch.cat([xs, corners])
    values = net.forward_stages(xs)
    for stage, vals in zip(trace.stages, values):
        stage.sampled = to_bounds(vals.min(dim=0).values, vals.max(dim=0).values)
    # a few of the random inputs and their outputs, for the picture on the input step
    k = min(N_SHOWN, n)
    if trace.steps and trace.steps[0].kind == 'input':
        trace.steps[0].detail['samples'] = {'inputs': xs[:k].tolist(), 'outputs': values[-1][:k].tolist()}
