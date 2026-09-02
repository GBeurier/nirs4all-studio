PYTHON ?= python3
DIST_DIR ?= dist
NIRS4ALL_METHODS_ROOT ?= $(if $(wildcard nirs4all-methods),$(abspath nirs4all-methods),$(abspath ../nirs4all-methods))
NIRS4ALL_METHODS_R_PATH ?= $(NIRS4ALL_METHODS_ROOT)/bindings/r/n4m
NIRS4ALL_METHODS_LIB_DIR ?= $(NIRS4ALL_METHODS_ROOT)/build/dev-release/cpp/src
NIRS4ALL_METHODS_GENERATED_DIR ?= $(NIRS4ALL_METHODS_ROOT)/build/dev-release/generated
NIRS4ALL_METHODS_JS_DIST ?= $(abspath $(NIRS4ALL_METHODS_ROOT)/bindings/js/dist)
NIRS4ALL_METHODS_MATLAB_PATH ?= $(NIRS4ALL_METHODS_ROOT)/bindings/matlab
R_PARITY_LIB ?= $(abspath .r-parity-lib)
WORKSPACE_ROOT ?= $(abspath ..)
E2E_ARTIFACTS_DIR ?= /tmp/nirs4all-core-e2e
E2E_SCENARIOS ?= e2e-r-dataset-io-pipeline-save e2e-multimodal-python-r-wasm-roundtrip e2e-multisource-branching-stacking-replay e2e-cluster-dag-rights-client-core

.PHONY: test test-v1-surfaces test-cross-language-e2e test-e2e-entrypoints test-rust test-rust-parity test-python test-python-v1-surfaces test-python-parity check-wasm-methods-artifact test-wasm test-wasm-parity-strict test-wasm-v1-surfaces test-wasm-v1-surfaces-if-available test-r test-r-if-available test-r-v1-surfaces test-r-v1-surfaces-if-available test-r-fixtures test-r-parity test-matlab-parity test-matlab-parity-if-available check-r build build-python build-npm build-r build-matlab package-rust clean

test: test-rust test-python test-wasm

test-v1-surfaces: test-rust test-python-v1-surfaces test-wasm-v1-surfaces test-r-v1-surfaces-if-available test-matlab-parity-if-available

test-e2e-entrypoints:
	$(PYTHON) -m py_compile scripts/e2e/*.py

test-cross-language-e2e: test-e2e-entrypoints
	@test -f "$(WORKSPACE_ROOT)/nirs4all-ecosystem/scripts/n4a_e2e_scenarios.py" || { \
		printf '%s\n' "ERROR: nirs4all-ecosystem checkout is required at $(WORKSPACE_ROOT)/nirs4all-ecosystem"; \
		exit 2; \
	}
	@mkdir -p "$(E2E_ARTIFACTS_DIR)"
	@for scenario in $(E2E_SCENARIOS); do \
		printf '%s\n' "RUN $$scenario"; \
		PYTHONDONTWRITEBYTECODE=1 $(PYTHON) "$(WORKSPACE_ROOT)/nirs4all-ecosystem/scripts/n4a_e2e_scenarios.py" \
			--artifacts-dir "$(E2E_ARTIFACTS_DIR)" run "$$scenario" --execute; \
	done

test-rust:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace

test-rust-parity:
	NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 cargo test -p nirs4all rust_binding_execution_matches_full_python_nirs4all_oracle -- --nocapture

test-python:
	PYTHONPATH=bindings/python/src $(PYTHON) -m unittest discover -s bindings/python/tests

test-python-v1-surfaces:
	PYTHONPATH=bindings/python/src $(PYTHON) -m unittest -v \
		bindings/python/tests/test_release_topology.py \
		bindings/python/tests/test_facade.py \
		bindings/python/tests/test_pipeline_contract.py \
		bindings/python/tests/test_upstreams.py \
		bindings/python/tests/test_cross_language_surface.py \
		bindings/python/tests/test_capability_matrix.py

test-python-parity:
	PYTHONPATH=bindings/python/src$(if $(NIRS4ALL_METHODS_PYTHONPATH),:$(NIRS4ALL_METHODS_PYTHONPATH)) NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 $(PYTHON) -m unittest bindings/python/tests/test_execution_parity.py -v

check-wasm-methods-artifact:
	@missing=""; \
	for file in index.js n4m.js n4m.wasm; do \
		if [ ! -f "$(NIRS4ALL_METHODS_JS_DIST)/$$file" ]; then \
			missing="$${missing}$${missing:+, }$$file"; \
		fi; \
	done; \
	if [ -n "$$missing" ]; then \
		printf '%s\n' "ERROR: nirs4all-methods JS/WASM dist is incomplete: $(NIRS4ALL_METHODS_JS_DIST) (missing $$missing)"; \
		printf '%s\n' "Build/stage it in the methods checkout:"; \
		printf '%s\n' "  cd $(NIRS4ALL_METHODS_ROOT)"; \
		printf '%s\n' "  cmake --preset emscripten"; \
		printf '%s\n' "  cmake --build --preset emscripten --target n4m_wasm --parallel"; \
		printf '%s\n' "  cd bindings/js && npm ci && npm run build && npm run stage:wasm"; \
		printf '%s\n' "Or set NIRS4ALL_METHODS_JS_DIST=/path/to/nirs4all-methods/bindings/js/dist."; \
		exit 1; \
	fi

test-wasm:
	npm ci --prefix bindings/wasm
	npm test --prefix bindings/wasm

test-wasm-parity-strict: check-wasm-methods-artifact
	npm ci --prefix bindings/wasm
	NIRS4ALL_METHODS_JS_DIST="$(NIRS4ALL_METHODS_JS_DIST)" NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 npm test --prefix bindings/wasm

test-wasm-v1-surfaces:
	npm ci --prefix bindings/wasm
	npm run test:v1-surface --prefix bindings/wasm

test-wasm-v1-surfaces-if-available:
	@if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then \
		$(MAKE) test-wasm-v1-surfaces; \
	else \
		printf '%s\n' "SKIP/RISK: WASM V1 public surface not checked: node/npm is not installed"; \
	fi

test-r:
	R CMD check --no-manual bindings/r

test-r-if-available:
	@if command -v R >/dev/null 2>&1; then \
		$(MAKE) test-r; \
	else \
		printf '%s\n' "SKIP/RISK: R CMD check not run: R is not installed"; \
	fi

test-r-v1-surfaces:
	@set -eu; \
	tmp="$$(mktemp -d)"; \
	trap 'rm -rf "$$tmp"' EXIT; \
	R CMD INSTALL --library="$$tmp" bindings/r; \
	R_LIBS_USER="$$tmp:$${R_LIBS_USER:-}" Rscript bindings/r/tests/surface.R; \
	R_LIBS_USER="$$tmp:$${R_LIBS_USER:-}" Rscript bindings/r/tests/upstreams.R; \
	R_LIBS_USER="$$tmp:$${R_LIBS_USER:-}" Rscript bindings/r/tests/pipeline.R

test-r-v1-surfaces-if-available:
	@if command -v R >/dev/null 2>&1 && command -v Rscript >/dev/null 2>&1; then \
		$(MAKE) test-r-v1-surfaces; \
	else \
		printf '%s\n' "SKIP/RISK: R V1 public surface not checked: R/Rscript is not installed"; \
	fi

test-r-fixtures:
	diff -ru tests/parity/fixtures bindings/r/inst/extdata

test-r-parity: test-r-fixtures
	rm -rf $(R_PARITY_LIB)
	mkdir -p $(R_PARITY_LIB)
	@if [ ! -d "$(NIRS4ALL_METHODS_R_PATH)" ]; then \
		printf '%s\n' "ERROR: strict R parity requires nirs4all-methods R binding at $(NIRS4ALL_METHODS_R_PATH)"; \
		printf '%s\n' "Set NIRS4ALL_METHODS_ROOT or checkout the pinned nirs4all-methods ref next to this repo."; \
		exit 1; \
	fi
	@if [ ! -f "$(NIRS4ALL_METHODS_LIB_DIR)/libn4m.so" ] && [ ! -f "$(NIRS4ALL_METHODS_LIB_DIR)/libn4m.dylib" ]; then \
		printf '%s\n' "ERROR: strict R parity requires a dev-release libn4m in $(NIRS4ALL_METHODS_LIB_DIR)"; \
		printf '%s\n' "Build it with: cd $(NIRS4ALL_METHODS_ROOT) && cmake --preset dev-release && cmake --build --preset dev-release --target n4m_c --parallel"; \
		exit 1; \
	fi
	N4M_LIB_DIR="$(NIRS4ALL_METHODS_LIB_DIR)" \
	N4M_GENERATED_DIR="$(NIRS4ALL_METHODS_GENERATED_DIR)" \
	N4M_R_LINK_PREBUILT=1 \
	LD_LIBRARY_PATH="$(NIRS4ALL_METHODS_LIB_DIR):$${LD_LIBRARY_PATH}" \
	R_LIBS="$(R_PARITY_LIB):$${R_LIBS_USER:-}" R_LIBS_USER="$(R_PARITY_LIB):$${R_LIBS_USER:-}" \
	R CMD INSTALL --preclean --library="$(R_PARITY_LIB)" --no-multiarch --no-staged-install "$(NIRS4ALL_METHODS_R_PATH)"
	R_LIBS="$(R_PARITY_LIB):$${R_LIBS_USER:-}" R_LIBS_USER="$(R_PARITY_LIB):$${R_LIBS_USER:-}" R CMD INSTALL --library="$(R_PARITY_LIB)" bindings/r
	NIRS4ALL_CORE_PARITY_ORACLE=$(abspath tests/parity/expected/portable_python_oracle.json) \
	NIRS4ALL_CORE_PARITY_FIXTURES=$(abspath bindings/r/inst/extdata) \
	NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
	NIRS4ALL_CORE_R_PARITY_LIB="$(R_PARITY_LIB)" \
	LD_LIBRARY_PATH="$(NIRS4ALL_METHODS_LIB_DIR):$${LD_LIBRARY_PATH}" \
	R_LIBS="$(R_PARITY_LIB):$${R_LIBS_USER:-}" R_LIBS_USER="$(R_PARITY_LIB):$${R_LIBS_USER:-}" \
	Rscript --vanilla bindings/r/tests/parity.R

test-matlab-parity:
	NIRS4ALL_CORE_PARITY_ORACLE=$(abspath tests/parity/expected/portable_python_oracle.json) \
	NIRS4ALL_CORE_PARITY_FIXTURES=$(abspath tests/parity/fixtures) \
	NIRS4ALL_METHODS_MATLAB_PATH=$(NIRS4ALL_METHODS_MATLAB_PATH) \
	NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
	octave --quiet --eval "addpath('bindings/matlab/tests'); parity"

test-matlab-parity-if-available:
	@if command -v octave >/dev/null 2>&1; then \
		$(MAKE) test-matlab-parity; \
	else \
		printf '%s\n' "SKIP/RISK: MATLAB/Octave execution parity not checked: octave is not installed"; \
	fi

check-r: build-r
	R CMD check --no-manual $(DIST_DIR)/r/nirs4all_*.tar.gz

build: build-python build-npm build-r build-matlab package-rust

build-python:
	$(PYTHON) -m build bindings/python --outdir $(abspath $(DIST_DIR)/python)

build-npm:
	mkdir -p $(DIST_DIR)/npm
	npm pack ./bindings/wasm --pack-destination $(DIST_DIR)/npm

build-r:
	mkdir -p $(DIST_DIR)/r
	cd $(DIST_DIR)/r && R CMD build ../../bindings/r

build-matlab:
	scripts/build-matlab-package.sh $(DIST_DIR)/matlab

package-rust:
	cargo package -p nirs4all

clean:
	rm -rf $(DIST_DIR)
