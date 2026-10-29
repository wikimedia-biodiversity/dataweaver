.PHONY: dev test test-fast port screenshots

dev:            ## run locally on http://localhost:5000 (needs .env, see .env.example)
	set -a; . ./.env; set +a; flask --app app run --debug

test:           ## everything, including the headless-browser tests
	python -m pytest -q

test-fast:      ## backend and page tests only
	python -m pytest -q tests/test_backend.py tests/test_pages.py

port:           ## regenerate static/js/dataweaver.js: make port SRC=path/to/CommonsDataWeaver.js
	python tools/port_userscript.py $(SRC)

screenshots:    ## regenerate docs/img/*.png from sample data
	python tools/screenshots.py
