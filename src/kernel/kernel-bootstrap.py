# Copyright Amazon.com, Inc. or its affiliates.

# Static bootstrap logic for the OSML Jupyter Extension kernel.
#
# This file is HAND-MAINTAINED and checked into source control. It contains
# only logic — no embedded wheel data. The wheel payload and its identity
# (_WHEEL_B64 / _WHEEL_SHA256 / _VERSION) are provided by the generated
# kernel-payload.generated.py, which the frontend concatenates *before* this
# file when injecting the setup code into the kernel (see kernelSetupCode.ts).
# When exercised standalone (e.g. in unit tests), those three names must be
# defined in the global namespace before the entrypoint block runs.
#
# Responsibilities:
#   1. Detect whether the installed aws.osml.jupyter matches the embedded wheel
#      by comparing a recorded content hash, and (re)install it if not.
#   2. Emit structured JSON progress messages over stdout (iopub) so the
#      frontend can surface install progress in JupyterLab notifications.
#
# get_ipython() is provided by the IPython kernel at runtime (not imported).

import base64, tempfile, subprocess, sys, os, json, importlib

# Recorded next to the installed package to track which wheel hash is installed.
# The version string alone is NOT a reliable cache key: during development the
# code changes without the version bumping, so we key on the wheel's content
# hash instead (see _inspect_installation / _record_installation).
_MARKER_NAME = ".osml_wheel_sha256"


def _emit(stage, status, message, percent=None):
    """Emit a structured progress message over stdout for the frontend to parse."""
    print(
        json.dumps({
            "source": "osml",
            "stage": stage,
            "status": status,
            "message": message,
            "percent": percent,
        }),
        flush=True,
    )


def _marker_path(osml_jupyter):
    """Path to the install-hash marker next to the installed package."""
    return os.path.join(os.path.dirname(osml_jupyter.__file__), _MARKER_NAME)


def _inspect_installation():
    """Return ``(importable, marker_matches)`` for the installed aws.osml.jupyter.

    ``importable``     — True if ``import aws.osml.jupyter`` succeeds.
    ``marker_matches`` — True if the recorded install hash equals ``_WHEEL_SHA256``.

    A missing/unreadable marker counts as a mismatch, so an install performed by
    some other means (without our marker) is treated as stale and refreshed.
    """
    try:
        import aws.osml.jupyter as osml_jupyter
    except Exception:
        return False, False

    try:
        with open(_marker_path(osml_jupyter)) as f:
            return True, f.read().strip() == _WHEEL_SHA256
    except OSError:
        return True, False


def _record_installation():
    """Record ``_WHEEL_SHA256`` next to the freshly installed package.

    Drops any cached ``aws.*`` imports and invalidates the import caches so the
    just-installed package is located rather than a stale partial import.
    Failure to write the marker is non-fatal: the only consequence is a
    redundant reinstall on the next kernel start.
    """
    importlib.invalidate_caches()
    for name in [n for n in sys.modules if n == "aws" or n.startswith("aws.")]:
        del sys.modules[name]
    try:
        import aws.osml.jupyter as osml_jupyter
    except Exception:
        return
    try:
        with open(_marker_path(osml_jupyter), "w") as f:
            f.write(_WHEEL_SHA256)
    except OSError:
        pass


def _ensure_installed():
    """Install the embedded wheel unless the matching hash is already installed.

    - Matching hash already recorded -> no-op.
    - Package importable but hash differs (dev rebuild at the same version) ->
      ``pip install --force-reinstall --no-deps`` to overwrite stale code fast
      without re-resolving already-satisfied dependencies.
    - Package not importable (fresh environment) -> full ``pip install`` so the
      runtime dependencies are resolved.
    """
    importable, marker_matches = _inspect_installation()
    if importable and marker_matches:
        return

    _emit("pip_install", "progress", "Installing kernel dependencies...", percent=None)

    whl_path = os.path.join(
        tempfile.gettempdir(), f"osml_jupyter-{_VERSION}-py3-none-any.whl"
    )

    try:
        _emit("pip_install", "progress", "Decoding kernel package...", percent=10)
        with open(whl_path, "wb") as f:
            f.write(base64.b64decode(_WHEEL_B64))

        _emit(
            "pip_install", "progress", "Installing osml-jupyter and dependencies...", percent=30
        )
        pip_args = [sys.executable, "-m", "pip", "install", "--quiet"]
        if importable:
            # Stale code at the same version: pip would treat the same-version
            # wheel as already satisfied and no-op, so force the overwrite.
            # Dependencies are already present, so skip re-resolving them.
            pip_args += ["--force-reinstall", "--no-deps"]
        pip_args.append(whl_path)

        result = subprocess.run(
            pip_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        if result.returncode != 0:
            raise subprocess.CalledProcessError(
                result.returncode,
                result.args,
                output=result.stdout,
            )

        # Record the installed hash so the next start can short-circuit.
        _record_installation()

        _emit("pip_install", "progress", "Cleaning up...", percent=90)
        if os.path.exists(whl_path):
            os.unlink(whl_path)

    except KeyboardInterrupt:
        _emit("pip_install", "error", "Installation cancelled")
        if os.path.exists(whl_path):
            os.unlink(whl_path)
        raise

    except subprocess.CalledProcessError as e:
        pip_output = e.output if isinstance(e.output, str) else (e.output.decode("utf-8", errors="replace") if e.output else "")
        error_msg = f"pip install failed: {pip_output.strip()[:200]}" if pip_output.strip() else "pip install failed"
        _emit("pip_install", "error", error_msg)
        if os.path.exists(whl_path):
            os.unlink(whl_path)
        raise

    except Exception as e:
        _emit("pip_install", "error", f"Installation failed: {e}")
        if os.path.exists(whl_path):
            os.unlink(whl_path)
        raise


# === bootstrap entrypoint (executed at kernel startup) ===
# Unit tests load only the logic above by splitting the source on this marker;
# keep the marker comment intact and all executable top-level code below it.
try:
    _ensure_installed()
    _emit("pip_install", "progress", "Starting kernel...", percent=95)
    from aws.osml.jupyter import initialize
    initialize(get_ipython())
except KeyboardInterrupt:
    _emit("initialize", "error", "Kernel setup cancelled by user")
    raise
except Exception as _bootstrap_err:
    _emit("initialize", "error", f"Kernel setup failed: {_bootstrap_err}")
    raise
else:
    _emit("initialize", "complete", "Kernel ready")
