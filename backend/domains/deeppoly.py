'''DeepPoly / CROWN, traced neuron by neuron.

For every weighted-sum neuron we record the full back-substitution of its lower
and upper bound: the starting expression, then one entry per substituted layer
(which ReLU line or weighted-sum definition replaced each term, and the
simplified result), then how the box is plugged in. Every stage also gets its
linear bounds over the inputs (``Stage.linear``). IBP's interval is included
for comparison.
'''
import torch

from ..core import PerturbInterval
from ..core.deeppoly import LinExpr, back_substitute, relu_relaxation
from ..netspec import InputBox, Network
from ..schema import Line, LinBound, LinearBounds, Relaxation, Step, Trace
from .base import Domain, register, stage_layout, to_bounds
from .ibp import _relu_status

EPS = 1e-12


def _lin(e: LinExpr) -> LinBound:
    return LinBound(coeffs=e.coeffs.tolist(), const=e.const)


def _explain(chain: list[LinExpr], ops: list, side: str, box: tuple[torch.Tensor, torch.Tensor], value: float) -> dict:
    '''Turn a back-substitution chain into steps a reader can follow.'''
    steps = [{'op': 'start', 'stage': chain[0].stage, 'coeffs': chain[0].coeffs.tolist(), 'const': chain[0].const}]
    for prev, cur in zip(chain, chain[1:]):
        if not (prev.coeffs.abs() >= EPS).any():
            break                           # already a constant: nothing left to substitute
        t = prev.stage                      # the stage being substituted away
        op = ops[t]
        uses = []
        for i, c in enumerate(prev.coeffs.tolist()):
            if abs(c) < EPS:
                continue
            if op[0] == 'relu':
                # everything needed to explain this term without looking elsewhere:
                # the ReLU's input interval, both of its lines, and which one is used
                _, r, zl, zu = op
                pl, pu = float(zl[i]), float(zu[i])
                uses.append({
                    'neuron': i, 'coef': c,
                    'line': 'lower' if (c >= 0) == (side == 'lower') else 'upper',
                    'pre': {'lower': pl, 'upper': pu},
                    'status': _relu_status(pl, pu),
                    'lower': {'slope': float(r.lower_slope[i]), 'bias': float(r.lower_bias[i])},
                    'upper': {'slope': float(r.upper_slope[i]), 'bias': float(r.upper_bias[i])},
                })
            else:
                _, W, b = op
                uses.append({'neuron': i, 'coef': c, 'weights': W[i].tolist(), 'bias': float(b[i])})
        steps.append({
            'op': 'relax' if op[0] == 'relu' else 'expand',
            'replaced': t, 'stage': cur.stage, 'uses': uses,
            'coeffs': cur.coeffs.tolist(), 'const': cur.const,
        })

    last = chain[len(steps) - 1]
    l, u = box
    terms = []
    for i, c in enumerate(last.coeffs.tolist()):
        if abs(c) < EPS:
            continue
        pick = 'lower' if (c >= 0) == (side == 'lower') else 'upper'
        terms.append({'input': i, 'coef': c, 'pick': pick, 'value': float(l[i] if pick == 'lower' else u[i])})
    return {'steps': steps, 'box': {'terms': terms, 'const': last.const}, 'value': value}


@register
class DeepPoly(Domain):
    key = 'deeppoly'
    name = 'DeepPoly / CROWN'
    short = 'DeepPoly / CROWN'
    summary = 'Keep a linear lower and upper bound for every neuron, and substitute them back to the inputs.'

    def analyze(self, net: Network, box: InputBox) -> Trace:
        stages = stage_layout(net)
        l0, u0 = box.tensors()
        n_in = len(l0)
        stages[0].bounds = to_bounds(l0, u0)
        eye = torch.eye(n_in, dtype=l0.dtype)
        stages[0].linear = [LinearBounds(lower=LinBound(coeffs=eye[i].tolist(), const=0.0),
                                         upper=LinBound(coeffs=eye[i].tolist(), const=0.0)) for i in range(n_in)]
        steps = [Step(kind='input', stage=0, neuron=None, detail={})]

        ops: list = [None]           # ops[t]: how stage t depends on stage t-1
        ibp = PerturbInterval.from_bounds(l0, u0)

        s = 1
        for layer in net.layers:
            W, b = layer.tensors()
            ibp_z = ibp.linear(W, b)
            ops.append(('affine', W, b))
            z = s
            details, lo, hi, linear = [], [], [], []
            for j in range(layer.out_dim):
                low_chain, low = back_substitute(ops, z, W[j], float(b[j]), 'lower', (l0, u0))
                up_chain, up = back_substitute(ops, z, W[j], float(b[j]), 'upper', (l0, u0))
                lo.append(low)
                hi.append(up)
                linear.append(LinearBounds(lower=_lin(low_chain[-1]), upper=_lin(up_chain[-1])))
                details.append({
                    'lower': _explain(low_chain, ops, 'lower', (l0, u0), low),
                    'upper': _explain(up_chain, ops, 'upper', (l0, u0), up),
                    'ibp': {'lower': float(ibp_z.lower[j]), 'upper': float(ibp_z.upper[j])},
                })
            zl, zu = torch.tensor(lo, dtype=W.dtype), torch.tensor(hi, dtype=W.dtype)
            stages[z].bounds = to_bounds(zl, zu)
            stages[z].linear = linear
            s += 1

            relu = layer.activation == 'relu'
            if relu:
                r = relu_relaxation(zl, zu)
                ops.append(('relu', r, zl, zu))
                stages[s].bounds = to_bounds(zl.clamp_min(0), zu.clamp_min(0))
                stages[s].relax = [Relaxation(
                    lower=Line(slope=float(r.lower_slope[j]), bias=float(r.lower_bias[j])),
                    upper=Line(slope=float(r.upper_slope[j]), bias=float(r.upper_bias[j])),
                ) for j in range(layer.out_dim)]
                # linear bounds of h over the inputs: back-substitute h_j on its own,
                # starting from h_j itself (so the first substitution is its own line)
                h_linear, h_walks = [], []
                for j in range(layer.out_dim):
                    e = torch.zeros(layer.out_dim, dtype=W.dtype)
                    e[j] = 1
                    hl, hl_val = back_substitute(ops, s + 1, e, 0.0, 'lower', (l0, u0))
                    hu, hu_val = back_substitute(ops, s + 1, e, 0.0, 'upper', (l0, u0))
                    h_linear.append(LinearBounds(lower=_lin(hl[-1]), upper=_lin(hu[-1])))
                    h_walks.append({
                        'lower': _explain(hl, ops, 'lower', (l0, u0), hl_val),
                        'upper': _explain(hu, ops, 'upper', (l0, u0), hu_val),
                    })
                stages[s].linear = h_linear
                ibp_z = ibp_z.relu()
                s += 1
            ibp = ibp_z

            # layer by layer: every weighted sum of the layer, then every ReLU
            for j in range(layer.out_dim):
                steps.append(Step(kind='deeppoly.affine', stage=z, neuron=j, detail=details[j]))
            if relu:
                for j in range(layer.out_dim):
                    l, u = float(zl[j]), float(zu[j])
                    steps.append(Step(kind='deeppoly.relu', stage=z + 1, neuron=j, detail={
                        'pre': {'lower': l, 'upper': u},
                        'status': _relu_status(l, u),
                        'relax': {
                            'lower': {'slope': float(r.lower_slope[j]), 'bias': float(r.lower_bias[j])},
                            'upper': {'slope': float(r.upper_slope[j]), 'bias': float(r.upper_bias[j])},
                        },
                        **h_walks[j],   # 'lower' / 'upper': back-substitution of h_j to the inputs
                    }))

        out = stages[-1]
        steps.append(Step(kind='output', stage=out.index, neuron=None, detail={
            'ibp': [{'lower': float(l), 'upper': float(u)} for l, u in zip(ibp.lower, ibp.upper)],
        }))
        return Trace(domain=self.key, stages=stages, steps=steps, checks=[])
