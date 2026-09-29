'''Interval (box) domain in center/radius form.

Trimmed copy of ``abstraction/perturbation/interval.py`` from
``constrained-abstraction``: only the ops a fully-connected ReLU network needs.
'''
import torch
import torch.nn.functional as F


class PerturbInterval:

    def __init__(self, center: torch.Tensor, radii: torch.Tensor):
        assert radii.shape == center.shape
        assert bool((radii >= 0).all()), 'radii must be non-negative'
        self.center = center
        self.radii = radii

    def __repr__(self) -> str:
        return f'PerturbInterval(center={self.center}, radii={self.radii})'

    @classmethod
    def from_bounds(cls, lower: torch.Tensor, upper: torch.Tensor) -> 'PerturbInterval':
        return cls(0.5 * (lower + upper), 0.5 * (upper - lower))

    @property
    def shape(self) -> torch.Size:
        return self.center.shape

    @property
    def lower(self) -> torch.Tensor:
        return self.center - self.radii

    @property
    def upper(self) -> torch.Tensor:
        return self.center + self.radii

    def concretize(self) -> tuple[torch.Tensor, torch.Tensor]:
        return self.lower, self.upper

    def linear(self, weight: torch.Tensor, bias: torch.Tensor | None = None) -> 'PerturbInterval':
        # weight: (out, in). The center moves like a normal input; the radius
        # can only grow, so it is pushed through |W|.
        center = self.center @ weight.T
        radii = self.radii @ weight.abs().T
        if bias is not None:
            center = center + bias
        return type(self)(center, radii)

    def relu(self) -> 'PerturbInterval':
        # ReLU is monotone, so applying it to both endpoints is exact.
        return self.from_bounds(F.relu(self.lower), F.relu(self.upper))
