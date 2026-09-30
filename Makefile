.PHONY: setup dev test build preview

setup:            ## install JS deps
	cd frontend && npm install

dev:              ## site on http://localhost:5173 (hot reload)
	cd frontend && npm run dev

test:             ## engine tests (Node's built-in runner)
	cd frontend && npm test

build:            ## static site in frontend/dist
	cd frontend && npm run build

preview:          ## the exact GitHub Pages build, on http://localhost:4173/abstract-domain-explainer/
	cd frontend && npm run preview:pages
