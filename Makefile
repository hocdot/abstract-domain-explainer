PY := .venv/bin/python

.PHONY: setup backend frontend dev test build

setup:            ## create the Python venv and install JS deps
	python3.12 -m venv .venv
	$(PY) -m pip install -r requirements-dev.txt
	cd frontend && npm install

backend:          ## API on http://127.0.0.1:8000 (auto-reload)
	$(PY) -m uvicorn backend.app:app --reload --port 8000

frontend:         ## site on http://localhost:5173 (proxies /api to the backend)
	cd frontend && npm run dev

dev:              ## run both; Ctrl-C stops both
	@trap 'kill 0' INT TERM; $(MAKE) backend & $(MAKE) frontend & wait

test:
	$(PY) -m pytest backend -q

build:            ## static site in frontend/dist
	cd frontend && npm run build
