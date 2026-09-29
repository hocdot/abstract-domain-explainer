# BoundLab

An interactive, step-by-step explainer of abstract domains for neural network
verification. Small toy networks, with every bound traced from input to output.

## Run locally

```console
make setup   # once: Python 3.12 venv + npm install
make dev     # API on :8000, site on http://localhost:5173
make test    # backend tests
```

## Layout

```
backend/
  core/          abstract-domain engines (math only), trimmed from constrained-abstraction
  domains/       one Domain per abstract domain; turns an engine run into a trace
  schema.py      the trace format shared by every domain
  netspec.py     JSON network + input box
  presets.py     example networks
  app.py         FastAPI routes: /api/domains, /api/presets, /api/random, /api/analyze
frontend/src/
  components/    diagram, stepper, controls, plots
  explain/       one explanation view per step kind (input, output, ibp.affine, ibp.relu)
```

## Adding a domain

1. Put the math in `backend/core/<domain>.py`.
2. Write a `Domain` subclass in `backend/domains/<domain>.py` that returns a `Trace`
   with its own step kinds (e.g. `crown.relax`, `crown.backsub`), and import it in
   `backend/domains/__init__.py`.
3. Add a view for each new step kind in `frontend/src/explain/<domain>.tsx` and
   register it in `frontend/src/explain/index.ts`.

The diagram, stepper, and controls need no changes: they only read `stages` and `steps`.

## Deploying (later)

The frontend is a static site (GitHub Pages works). The backend needs a Python host
(e.g. Hugging Face Spaces, Render, Fly.io). Build the frontend with
`VITE_API_BASE=https://your-api BASE_PATH=/repo-name/ npm run build`, and start the
API with `ALLOWED_ORIGINS=https://you.github.io`.
