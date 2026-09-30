# Abstract Domain Explainer

An interactive, step-by-step explainer of abstract domains for neural network
verification. Small toy networks, with every bound traced from input to output.

Everything runs in the browser, so the site is fully static and deploys to GitHub Pages.

## Run locally

Needs Node 22.18 or newer (the tests run TypeScript directly).

```console
make setup     # once: npm install
make dev       # http://localhost:5173, hot reload while editing
make test      # engine tests
make preview   # the exact GitHub Pages build, on http://localhost:4173/abstract-domain-explainer/
```

## Layout

```
frontend/src/
  engine/
    core/        abstract-domain math (interval, deeppoly), trimmed from constrained-abstraction
    domains/     one Domain per abstract domain; turns an engine run into a trace
    netspec.ts   network + input box validation, forward pass
    presets.ts   example networks and the random generator
    sampling.ts  seeded PRNG and Sobol points for the sampled ranges
    index.ts     the registry and the calls the UI makes (via src/api.ts)
  components/    diagram, stepper, controls, plots
  explain/       one explanation view per step kind (input, output, ibp.*, deeppoly.*)
frontend/tests/  engine tests
```

## Adding a domain

1. Put the math in `frontend/src/engine/core/<domain>.ts`.
2. Write a `Domain` in `frontend/src/engine/domains/<domain>.ts` that returns a `Trace`
   with its own step kinds (e.g. `crown.relax`, `crown.backsub`), and add it to
   `REGISTRY` in `frontend/src/engine/index.ts`.
3. Add a view for each new step kind in `frontend/src/explain/<domain>.tsx` and
   register it in `frontend/src/explain/index.ts`.

The diagram, stepper, and controls need no changes: they only read `stages` and `steps`.

## Deploying

`.github/workflows/pages.yml` tests, builds, and publishes the site on every push to
`githubio`. In the repository's Settings → Pages, set **Source** to **GitHub Actions**
once. The site is then served at `https://<user>.github.io/abstract-domain-explainer/`.
