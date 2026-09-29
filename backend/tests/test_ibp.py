import torch
from fastapi.testclient import TestClient

from backend.app import app
from backend.domains import REGISTRY
from backend.netspec import DTYPE, InputBox
from backend.presets import PRESETS, random_network

ibp = REGISTRY['ibp']


def preset(key):
    return next(p for p in PRESETS if p['key'] == key)


def test_deeppoly_example_by_hand():
    p = preset('deeppoly-example')
    trace = ibp.analyze(p['network'], p['input'])
    got = [[(b.lower, b.upper) for b in s.bounds] for s in trace.stages]
    assert got == [
        [(-1, 1), (-1, 1)],   # x
        [(-2, 2), (-2, 2)],   # z1
        [(0, 2), (0, 2)],     # h1
        [(0, 4), (-2, 2)],    # z2
        [(0, 4), (0, 2)],     # h2
        [(1, 7), (0, 2)],     # y
    ]
    assert trace.check.ok


def test_relu_statuses():
    p = preset('three-relu-cases')
    trace = ibp.analyze(p['network'], p['input'])
    statuses = [s.detail['status'] for s in trace.steps if s.kind == 'ibp.relu']
    assert statuses == ['active', 'inactive', 'unstable']


def test_step_order_covers_every_neuron():
    p = preset('deeppoly-example')
    trace = ibp.analyze(p['network'], p['input'])
    assert trace.steps[0].kind == 'input' and trace.steps[-1].kind == 'output'
    covered = [(s.stage, s.neuron) for s in trace.steps[1:-1]]
    # neuron by neuron within a layer: z1, h1, z2, h2, ...
    assert covered == [(1, 0), (2, 0), (1, 1), (2, 1), (3, 0), (4, 0), (3, 1), (4, 1), (5, 0), (5, 1)]


def test_sound_on_random_networks():
    for seed in range(20):
        net = random_network([2, 3, 3, 2], 'decimal', seed)
        box_l, box_u = torch.tensor([-1.0, 0.0], dtype=DTYPE), torch.tensor([0.5, 2.0], dtype=DTYPE)
        trace = ibp.analyze(net, InputBox(lower=box_l.tolist(), upper=box_u.tolist()))
        assert trace.check.ok
        xs = box_l + (box_u - box_l) * torch.rand(2000, 2, dtype=DTYPE)
        ys = net.forward(xs)
        out = trace.stages[-1].bounds
        for j, b in enumerate(out):
            assert b.lower - 1e-9 <= ys[:, j].min() and ys[:, j].max() <= b.upper + 1e-9


def test_api_roundtrip():
    client = TestClient(app)
    assert [d['key'] for d in client.get('/api/domains').json()] == ['ibp']
    presets = client.get('/api/presets').json()
    body = {'domain': 'ibp', 'network': presets[0]['network'], 'input': presets[0]['input']}
    r = client.post('/api/analyze', json=body)
    assert r.status_code == 200 and r.json()['check']['ok']

    net = client.post('/api/random', json={'sizes': [2, 2, 2, 2], 'seed': 3}).json()
    assert [len(l['weight']) for l in net['layers']] == [2, 2, 2]

    bad = {**body, 'input': {'lower': [0], 'upper': [1]}}
    assert client.post('/api/analyze', json=bad).status_code == 422
    assert client.post('/api/analyze', json={**body, 'domain': 'nope'}).status_code == 400
