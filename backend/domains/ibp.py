'''Interval Bound Propagation, traced neuron by neuron.

The bounds come from the engine (``core.PerturbInterval``, center/radius form).
The explanation re-derives each neuron with the textbook endpoint rule

    lower(z_j) = b_j + sum_i  w_ji * (lower(x_i) if w_ji >= 0 else upper(x_i))
    upper(z_j) = b_j + sum_i  w_ji * (upper(x_i) if w_ji >= 0 else lower(x_i))

and a ``Check`` reports how far the two derivations are apart.
'''
import torch

from ..core import PerturbInterval
from ..netspec import InputBox, Network
from ..schema import Check, Step, Trace
from .base import Domain, register, stage_layout, to_bounds


def _affine_detail(W: torch.Tensor, b: torch.Tensor, j: int,
                   prev: PerturbInterval, out: PerturbInterval) -> dict:
    terms = []
    for i, w in enumerate(W[j].tolist()):
        l, u = float(prev.lower[i]), float(prev.upper[i])
        lo_pick, hi_pick = ('lower', 'upper') if w >= 0 else ('upper', 'lower')
        lo_val, hi_val = (l, u) if w >= 0 else (u, l)
        terms.append({
            'source': i, 'weight': w,
            'lower_pick': lo_pick, 'lower_value': lo_val, 'lower_contrib': w * lo_val,
            'upper_pick': hi_pick, 'upper_value': hi_val, 'upper_contrib': w * hi_val,
        })
    bias = float(b[j])
    return {
        'bias': bias,
        'terms': terms,
        'textbook': {
            'lower': bias + sum(t['lower_contrib'] for t in terms),
            'upper': bias + sum(t['upper_contrib'] for t in terms),
        },
        # the engine's own view of the same neuron
        'center': float(out.center[j]),
        'radius': float(out.radii[j]),
    }


def _relu_status(l: float, u: float) -> str:
    if l >= 0:
        return 'active'
    if u <= 0:
        return 'inactive'
    return 'unstable'


@register
class IBP(Domain):
    key = 'ibp'
    name = 'Interval Bound Propagation'
    short = 'IBP'
    summary = 'Push a box through the network one layer at a time, bounding every neuron by an interval.'

    def analyze(self, net: Network, box: InputBox) -> Trace:
        stages = stage_layout(net)
        lower, upper = box.tensors()
        value = PerturbInterval.from_bounds(lower, upper)
        stages[0].bounds = to_bounds(value.lower, value.upper)
        steps = [Step(kind='input', stage=0, neuron=None, detail={})]

        worst = 0.0
        s = 1
        for layer in net.layers:
            W, b = layer.tensors()
            prev, value = value, value.linear(W, b)
            z = s
            stages[z].bounds = to_bounds(value.lower, value.upper)
            s += 1
            relu = layer.activation == 'relu'
            if relu:
                pre, value = value, value.relu()
                stages[s].bounds = to_bounds(value.lower, value.upper)
                s += 1

            # layer by layer: every weighted sum of the layer, then every ReLU
            for j in range(layer.out_dim):
                detail = _affine_detail(W, b, j, prev, pre if relu else value)
                worst = max(worst,
                            abs(detail['textbook']['lower'] - detail['center'] + detail['radius']),
                            abs(detail['textbook']['upper'] - detail['center'] - detail['radius']))
                steps.append(Step(kind='ibp.affine', stage=z, neuron=j, detail=detail))
            if relu:
                for j in range(layer.out_dim):
                    l, u = float(pre.lower[j]), float(pre.upper[j])
                    steps.append(Step(kind='ibp.relu', stage=z + 1, neuron=j, detail={
                        'pre': {'lower': l, 'upper': u},
                        'status': _relu_status(l, u),
                    }))

        steps.append(Step(kind='output', stage=len(stages) - 1, neuron=None, detail={}))
        check = Check(
            label='Engine matches the textbook rule',
            detail=f'center/radius vs. endpoint rule, max difference {worst:.1e}',
            ok=worst <= 1e-9,
        )
        return Trace(domain=self.key, stages=stages, steps=steps, checks=[check])
