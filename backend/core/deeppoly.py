'''DeepPoly / CROWN: linear relaxations + back-substitution.

Every neuron keeps a linear lower and upper bound in terms of the stage right
before it:

* affine  z = W h + b          (exact, lower = upper)
* ReLU    a_l z + c_l <= h <= a_u z + c_u   (element-wise relaxation)

To bound a neuron, start from its expression over the previous stage and
substitute backward until only the inputs remain, then evaluate it on the box.
With full back-substitution and the adaptive lower slope below, DeepPoly
(Singh et al., 2019) and CROWN (Zhang et al., 2018) give the same bounds.
'''
from dataclasses import dataclass

import torch


@dataclass
class Relaxation:
    '''Per-neuron linear bounds of ReLU(z) valid on z in [l, u].'''
    lower_slope: torch.Tensor
    lower_bias: torch.Tensor
    upper_slope: torch.Tensor
    upper_bias: torch.Tensor


@dataclass
class LinExpr:
    '''sum_i coeffs[i] * (neuron i of `stage`) + const'''
    stage: int
    coeffs: torch.Tensor
    const: float


def relu_relaxation(lower: torch.Tensor, upper: torch.Tensor) -> Relaxation:
    active = lower >= 0
    unstable = (lower < 0) & (upper > 0)
    # upper: identity if active, 0 if inactive, the chord (l,0)-(u,u) if unstable
    chord = torch.where(unstable, upper / (upper - lower).clamp_min(1e-12), torch.zeros_like(upper))
    upper_slope = torch.where(active, torch.ones_like(upper), chord)
    upper_bias = torch.where(unstable, -lower * chord, torch.zeros_like(upper))
    # lower: h >= lambda * z with lambda in {0, 1}; pick the one with the smaller
    # relaxation area (lambda = 1 when u > -l)
    lam = torch.where(unstable, (upper > -lower).to(upper.dtype), torch.zeros_like(upper))
    lower_slope = torch.where(active, torch.ones_like(upper), lam)
    return Relaxation(lower_slope, torch.zeros_like(upper), upper_slope, upper_bias)


def back_substitute(ops: list, start: int, coeffs: torch.Tensor, const: float,
                    side: str, box: tuple[torch.Tensor, torch.Tensor]) -> tuple[list[LinExpr], float]:
    '''Bound ``coeffs @ stage[start - 1] + const`` from below (side='lower') or above.

    ``ops[t]`` says how stage t depends on stage t-1: ``('affine', W, b)`` or
    ``('relu', Relaxation)``. Returns the expression after each substitution
    (first: over stage start-1, last: over the input) and its value on the box.
    '''
    chain = [LinExpr(start - 1, coeffs, const)]
    for t in range(start - 1, 0, -1):
        op = ops[t]
        if op[0] == 'affine':
            _, W, b = op
            const = const + float(coeffs @ b)
            coeffs = coeffs @ W
        else:
            r: Relaxation = op[1]
            # a positive coefficient wants the lower relaxation for a lower
            # bound (and the upper one for an upper bound); negative flips it
            use_lower = (coeffs >= 0) if side == 'lower' else (coeffs < 0)
            slope = torch.where(use_lower, r.lower_slope, r.upper_slope)
            bias = torch.where(use_lower, r.lower_bias, r.upper_bias)
            const = const + float(coeffs @ bias)
            coeffs = coeffs * slope
        chain.append(LinExpr(t - 1, coeffs, const))

    l, u = box
    pick = (coeffs >= 0) if side == 'lower' else (coeffs < 0)
    value = const + float(coeffs @ torch.where(pick, l, u))
    return chain, value
