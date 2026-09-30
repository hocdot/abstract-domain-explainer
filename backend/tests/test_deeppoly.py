import torch

from backend.domains import REGISTRY
from backend.netspec import DTYPE, InputBox
from backend.presets import PRESETS, random_network

dp = REGISTRY['deeppoly']
ibp = REGISTRY['ibp']


def preset(key):
    return next(p for p in PRESETS if p['key'] == key)


def bounds(trace, stage):
    return [(round(b.lower, 9), round(b.upper, 9)) for b in trace.stages[stage].bounds]


def test_deeppoly_paper_example():
    # Singh et al. 2019, Fig. 2: x11 in [1, 5.5], x12 in [0, 2]
    p = preset('deeppoly-example')
    trace = dp.run(p['network'], p['input'])
    assert bounds(trace, 3) == [(0, 3), (-2, 2)]       # z2 (IBP gives [0,4], [-2,2])
    assert bounds(trace, 5) == [(1, 5.5), (0, 2)]      # y  (IBP gives [1,7], [0,2])
    assert all(c.ok for c in trace.checks)


def test_first_layer_matches_ibp():
    p = preset('three-relu-cases')
    a, b = dp.run(p['network'], p['input']), ibp.run(p['network'], p['input'])
    assert bounds(a, 1) == bounds(b, 1)


def test_backsub_steps_end_at_inputs_and_evaluate_to_bound():
    p = preset('deeppoly-example')
    trace = dp.run(p['network'], p['input'])
    for step in trace.steps:
        if step.kind not in ('deeppoly.affine', 'deeppoly.relu'):
            continue
        for side in ('lower', 'upper'):
            d = step.detail[side]
            first = step.stage - 1 if step.kind == 'deeppoly.affine' else step.stage  # h starts from itself
            stages = [e['stage'] for e in d['steps']]
            # the walk reaches the inputs, or stops early once the bound is a constant
            assert stages == list(range(first, -1, -1))[:len(stages)]
            constant = not any(abs(c) > 1e-12 for c in d['steps'][-1]['coeffs'])
            assert stages[-1] == 0 or constant
            assert all(any(abs(c) > 1e-12 for c in e['coeffs']) for e in d['steps'][:-1])
            assert [e['op'] for e in d['steps'][1:]] == [
                'relax' if trace.stages[e['replaced']].kind == 'relu' else 'expand' for e in d['steps'][1:]]
            box = d['box']
            value = box['const'] + sum(t['coef'] * t['value'] for t in box['terms'])
            assert abs(value - d['value']) < 1e-9
            lin = getattr(trace.stages[step.stage].linear[step.neuron], side)
            if stages[-1] == 0:
                assert lin.coeffs == d['steps'][-1]['coeffs']
            else:
                assert not any(abs(c) > 1e-12 for c in lin.coeffs) and abs(lin.const - d['steps'][-1]['const']) < 1e-9


def test_linear_bounds_over_inputs_paper_example():
    # y1 <= x1 + 0.5 x2 + 4 (Singh et al. 2019, Sec. 2)
    p = preset('deeppoly-example')
    trace = dp.run(p['network'], p['input'])
    y1 = trace.stages[-1].linear[0]
    assert (y1.upper.coeffs, y1.upper.const) == ([1.0, 0.5], 4.0)
    assert (y1.lower.coeffs, y1.lower.const) == ([0.0, 0.0], 1.0)


def test_linear_bounds_hold_on_samples():
    for seed in range(10):
        net = random_network([2, 3, 3, 2], 'decimal', seed)
        box = InputBox(lower=[-1.0, 0.0], upper=[0.5, 2.0])
        trace = dp.run(net, box)
        l, u = torch.tensor(box.lower, dtype=DTYPE), torch.tensor(box.upper, dtype=DTYPE)
        xs = l + (u - l) * torch.rand(2000, 2, dtype=DTYPE, generator=torch.Generator().manual_seed(seed))
        for stage, vals in zip(trace.stages, net.forward_stages(xs)):
            for j, lb in enumerate(stage.linear):
                lower = xs @ torch.tensor(lb.lower.coeffs, dtype=DTYPE) + lb.lower.const
                upper = xs @ torch.tensor(lb.upper.coeffs, dtype=DTYPE) + lb.upper.const
                assert (lower <= vals[:, j] + 1e-9).all() and (vals[:, j] <= upper + 1e-9).all()


def test_sound_on_random_networks():
    for seed in range(30):
        net = random_network([2, 3, 3, 2], 'decimal', seed)
        box = InputBox(lower=[-1.0, 0.0], upper=[0.5, 2.0])
        trace = dp.run(net, box)
        assert all(c.ok for c in trace.checks), (seed, trace.checks)
        l, u = torch.tensor(box.lower, dtype=DTYPE), torch.tensor(box.upper, dtype=DTYPE)
        xs = l + (u - l) * torch.rand(3000, 2, dtype=DTYPE, generator=torch.Generator().manual_seed(seed))
        for stage, vals in zip(trace.stages, net.forward_stages(xs)):
            for j, b in enumerate(stage.bounds):
                assert b.lower - 1e-9 <= vals[:, j].min() and vals[:, j].max() <= b.upper + 1e-9
