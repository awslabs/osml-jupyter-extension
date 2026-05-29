#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates.
"""
Build the osml-jupyter wheel and write the generated payload data file.

The bootstrap is split into two files:
  - src/kernel/kernel-bootstrap.py           — hand-maintained LOGIC, checked in.
  - src/kernel/kernel-payload.generated.py   — generated DATA only, git-ignored.

This script produces only the data file. It contains three module-level
assignments (the base64 wheel, its sha256, and the version) and no logic, so
rebuilds churn a single blob rather than a whole script. At runtime the
frontend concatenates the payload *before* the bootstrap (see kernelSetupCode.ts)
so the bootstrap's logic can read _WHEEL_B64 / _WHEEL_SHA256 / _VERSION.

Steps:
  1. Read version from package.json
  2. Set OSML_KERNEL_VERSION env var (hatchling reads it for dynamic versioning)
  3. Build src/kernel/ into a wheel by invoking the PEP 517 backend
     (hatchling.build.build_wheel) directly — no build frontend needed
  4. Base64-encode the wheel and compute its sha256
  5. Write src/kernel/kernel-payload.generated.py with those values
  6. Clean up build artifacts (dist/, *.egg-info, *.dist-info)
"""

import base64
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
KERNEL_DIR = REPO_ROOT / "src" / "kernel"
PAYLOAD_OUTPUT = KERNEL_DIR / "kernel-payload.generated.py"
PACKAGE_JSON = REPO_ROOT / "package.json"

# Payload template — DATA ONLY. All bootstrap logic lives in the hand-maintained
# kernel-bootstrap.py. Keep this free of behavior so diffs stay to the blob.
_PAYLOAD_TEMPLATE = '''\
# Copyright Amazon.com, Inc. or its affiliates.

# Generated at build time by scripts/bundle-kernel.py — DO NOT EDIT.
# Data-only payload for the OSML Jupyter Extension kernel bootstrap: the
# base64-encoded wheel, its sha256 (used by kernel-bootstrap.py as the install
# cache key), and the wheel version. The bootstrap logic is concatenated after
# this file at injection time; see src/utils/kernelSetupCode.ts.

_VERSION = "{version}"
_WHEEL_SHA256 = "{wheel_sha256}"
_WHEEL_B64 = "{wheel_b64}"
'''


def _read_version() -> str:
    with open(PACKAGE_JSON) as f:
        return json.load(f)["version"]


def _build_wheel(version: str) -> Path:
    env = {**os.environ, "OSML_KERNEL_VERSION": version}

    dist_dir = KERNEL_DIR / "dist"
    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    dist_dir.mkdir(parents=True, exist_ok=True)

    # Invoke the PEP 517 build backend (hatchling) directly instead of a build
    # *frontend* (`python -m build` / `pip wheel`). When this script runs from
    # the jupyter-builder hook during `pip install .`, it executes inside pip's
    # isolated build env, which contains neither `build` nor `pip` — but it must
    # contain hatchling, since that is the declared build backend. The kernel's
    # own build-system.requires is just hatchling, so no extra build isolation is
    # needed here; calling the backend in a subprocess (cwd=KERNEL_DIR) keeps env
    # and working directory clean without perturbing the outer build's state.
    build_script = (
        "from hatchling.build import build_wheel; "
        "import sys; sys.stdout.write(build_wheel(sys.argv[1]))"
    )
    result = subprocess.run(
        [sys.executable, "-c", build_script, str(dist_dir)],
        cwd=str(KERNEL_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"wheel build failed (exit {result.returncode})")

    wheels = list(dist_dir.glob("*.whl"))
    if not wheels:
        raise RuntimeError(f"No wheel found in {dist_dir} after build")
    if len(wheels) > 1:
        raise RuntimeError(f"Multiple wheels found in {dist_dir}: {wheels}")
    return wheels[0]


def _cleanup() -> None:
    for pattern in [
        str(KERNEL_DIR / "dist"),
        str(KERNEL_DIR / "*.egg-info"),
        str(KERNEL_DIR / "*.dist-info"),
        str(KERNEL_DIR / "aws" / "**" / "*.egg-info"),
        str(KERNEL_DIR / "aws" / "**" / "*.dist-info"),
    ]:
        for path in glob.glob(pattern, recursive=True):
            p = Path(path)
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()


def main() -> None:
    version = _read_version()
    print(f"Building osml-jupyter wheel for version {version} ...")

    wheel_path = _build_wheel(version)
    wheel_bytes = wheel_path.read_bytes()
    wheel_b64 = base64.b64encode(wheel_bytes).decode("ascii")
    wheel_sha256 = hashlib.sha256(wheel_bytes).hexdigest()
    kb = len(wheel_bytes) / 1024
    kb_b64 = len(wheel_b64) / 1024
    print(f"  wheel: {wheel_path.name}  ({kb:.1f} KB raw, {kb_b64:.1f} KB base64)")
    print(f"  sha256: {wheel_sha256}")

    payload = _PAYLOAD_TEMPLATE.format(
        version=version, wheel_sha256=wheel_sha256, wheel_b64=wheel_b64
    )
    PAYLOAD_OUTPUT.write_text(payload, encoding="utf-8")
    print(f"  wrote {PAYLOAD_OUTPUT.relative_to(REPO_ROOT)}")

    _cleanup()
    print("  cleaned build artifacts")
    print("Done.")


if __name__ == "__main__":
    main()
