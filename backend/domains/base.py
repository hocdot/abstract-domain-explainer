'''Domain interface, registry, and the stage layout every domain shares.'''
from abc import ABC, abstractmethod

from ..netspec import InputBox, Network
from ..schema import Bounds, DomainInfo, Stage, Trace

REGISTRY: dict[str, 'Domain'] = {}


class Domain(ABC):
    key: str
    name: str
    short: str
    summary: str

    @abstractmethod
    def analyze(self, net: Network, box: InputBox) -> Trace:
        ...

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
