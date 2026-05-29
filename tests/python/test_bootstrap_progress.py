# Copyright Amazon.com, Inc. or its affiliates.

"""
Tests for the kernel bootstrap script's progress messaging.

Validates that:
- _emit() produces correctly structured JSON messages
- _ensure_installed() emits the expected sequence of progress messages
- KeyboardInterrupt is handled gracefully with an error message
- Failed pip install emits an error message
"""

import json
import os
import sys
import tempfile
import types
from io import StringIO
from unittest.mock import patch, MagicMock

import pytest


BOOTSTRAP_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "src", "kernel", "kernel-bootstrap.py"
)

# The bootstrap file now contains only logic; the payload names (_WHEEL_B64 /
# _WHEEL_SHA256 / _VERSION) are supplied at runtime by the generated payload
# file, concatenated before it. Tests inject a stub payload to stand in for it.
_ENTRYPOINT_MARKER = "# === bootstrap entrypoint (executed at kernel startup) ==="

_STUB_PAYLOAD = (
    '_VERSION = "9.9.9"\n'
    '_WHEEL_SHA256 = "stub-sha256-deadbeef"\n'
    '_WHEEL_B64 = "c3R1Yg=="\n'  # base64("stub"); real decode is patched in tests
)


def load_bootstrap_module():
    """Load the bootstrap LOGIC as a module for testing.

    Mirrors runtime composition (payload names defined first, bootstrap logic
    after) but strips the top-level entrypoint block so importing the module
    doesn't call _ensure_installed()/get_ipython(). The entrypoint block is
    covered separately below.
    """
    with open(BOOTSTRAP_PATH) as f:
        source = f.read()

    logic_only = source.split(_ENTRYPOINT_MARKER)[0]
    module = types.ModuleType("kernel_bootstrap")
    module.__dict__["get_ipython"] = MagicMock()
    exec(_STUB_PAYLOAD + logic_only, module.__dict__)
    return module


@pytest.fixture
def bootstrap():
    """Load the bootstrap module fresh for each test."""
    return load_bootstrap_module()


class TestEmit:
    """Tests for the _emit() helper function."""

    def test_emit_produces_valid_json(self, bootstrap, capsys):
        bootstrap._emit("pip_install", "progress", "Working...", percent=50)
        output = capsys.readouterr().out.strip()
        parsed = json.loads(output)
        assert parsed == {
            "source": "osml",
            "stage": "pip_install",
            "status": "progress",
            "message": "Working...",
            "percent": 50,
        }

    def test_emit_with_null_percent(self, bootstrap, capsys):
        bootstrap._emit("pip_install", "progress", "Downloading...", percent=None)
        output = capsys.readouterr().out.strip()
        parsed = json.loads(output)
        assert parsed["percent"] is None

    def test_emit_complete_status(self, bootstrap, capsys):
        bootstrap._emit("pip_install", "complete", "Installation complete")
        output = capsys.readouterr().out.strip()
        parsed = json.loads(output)
        assert parsed["status"] == "complete"
        assert parsed["source"] == "osml"

    def test_emit_error_status(self, bootstrap, capsys):
        bootstrap._emit("pip_install", "error", "pip install failed: network error")
        output = capsys.readouterr().out.strip()
        parsed = json.loads(output)
        assert parsed["status"] == "error"
        assert "network error" in parsed["message"]

    def test_emit_default_percent_is_none(self, bootstrap, capsys):
        bootstrap._emit("pip_install", "progress", "msg")
        output = capsys.readouterr().out.strip()
        parsed = json.loads(output)
        assert parsed["percent"] is None


def _patch_inspect(bootstrap, importable, marker_matches):
    """Patch _inspect_installation() to report the given install state.

    The bootstrap keys reinstall decisions on ``(importable, marker_matches)``
    from the content-hash marker, so tests stub that directly rather than faking
    module imports and marker files.
    """
    return patch.object(
        bootstrap, "_inspect_installation", return_value=(importable, marker_matches)
    )


def _patch_record(bootstrap):
    """Patch _record_installation() to a no-op (it re-imports + writes a file)."""
    return patch.object(bootstrap, "_record_installation")


def _patch_matching(bootstrap):
    """Installed and hash matches — the no-op case."""
    return _patch_inspect(bootstrap, importable=True, marker_matches=True)


def _patch_stale(bootstrap):
    """Importable but hash differs — the dev-rebuild force-reinstall case."""
    return _patch_inspect(bootstrap, importable=True, marker_matches=False)


def _patch_not_installed(bootstrap):
    """Not importable — the fresh-environment full-install case."""
    return _patch_inspect(bootstrap, importable=False, marker_matches=False)


def _successful_pip():
    """Patch subprocess.run to report a successful (returncode 0) pip install."""
    result = MagicMock()
    result.returncode = 0
    result.stdout = ""
    return patch("subprocess.run", return_value=result)


class TestEnsureInstalled:
    """Tests for the _ensure_installed() function."""

    def test_already_installed_matching_hash(self, bootstrap, capsys):
        """When the installed hash matches the embedded wheel, no-op silently."""
        with _patch_matching(bootstrap):
            bootstrap._ensure_installed()

        # _ensure_installed returns without emitting anything; the top-level
        # bootstrap block (not exercised here) is what emits "Kernel ready".
        output = capsys.readouterr().out.strip()
        assert output == ""

    def test_hash_mismatch_triggers_install(self, bootstrap, capsys):
        """When the installed hash differs, proceed with install and surface pip failure."""
        failed = MagicMock()
        failed.returncode = 1
        failed.stdout = "boom"

        with _patch_stale(bootstrap):
            with patch("base64.b64decode", return_value=b"fake wheel data"):
                with patch("subprocess.run", return_value=failed):
                    with pytest.raises(Exception):
                        bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        statuses = [l["status"] for l in lines]
        assert "progress" in statuses
        assert "error" in statuses

    def test_stale_install_uses_force_reinstall(self, bootstrap):
        """A hash mismatch on an importable package force-reinstalls without deps."""
        with _patch_stale(bootstrap):
            with _successful_pip() as run_mock:
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        args = run_mock.call_args[0][0]
        assert "--force-reinstall" in args
        assert "--no-deps" in args

    def test_fresh_install_full_resolve(self, bootstrap):
        """A not-importable package installs WITH dependency resolution."""
        with _patch_not_installed(bootstrap):
            with _successful_pip() as run_mock:
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        args = run_mock.call_args[0][0]
        assert "--force-reinstall" not in args
        assert "--no-deps" not in args

    def test_successful_install_records_hash(self, bootstrap):
        """After a successful install, the wheel hash is recorded for next start."""
        with _patch_stale(bootstrap):
            with _successful_pip():
                with _patch_record(bootstrap) as record_mock:
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        record_mock.assert_called_once()

    def test_import_error_triggers_install(self, bootstrap, capsys):
        """When aws.osml.jupyter is not importable, proceed with install."""
        failed = MagicMock()
        failed.returncode = 1
        failed.stdout = "boom"

        with _patch_not_installed(bootstrap):
            with patch("base64.b64decode", return_value=b"fake wheel data"):
                with patch("subprocess.run", return_value=failed):
                    with pytest.raises(Exception):
                        bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        statuses = [l["status"] for l in lines]
        assert "progress" in statuses

    def test_successful_install_emits_progress_sequence(self, bootstrap, capsys):
        """A successful install emits progress messages in order."""
        # Make import fail so install is attempted
        with _patch_not_installed(bootstrap):
            with _successful_pip():
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]

        assert len(lines) >= 4
        assert lines[0]["status"] == "progress"
        assert lines[0]["percent"] is None

        assert lines[1]["status"] == "progress"
        assert lines[1]["percent"] == 10

        assert lines[2]["status"] == "progress"
        assert lines[2]["percent"] == 30

        # Final message emitted by _ensure_installed is the "Cleaning up..." step;
        # it does not emit "complete" (that is the top-level block's job).
        assert lines[-1]["status"] == "progress"
        assert lines[-1]["percent"] == 90

    def test_keyboard_interrupt_emits_error(self, bootstrap, capsys):
        """KeyboardInterrupt during install emits an error message."""
        with _patch_not_installed(bootstrap):
            with patch(
                "base64.b64decode", side_effect=KeyboardInterrupt()
            ):
                with pytest.raises(KeyboardInterrupt):
                    bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        error_lines = [l for l in lines if l["status"] == "error"]
        assert len(error_lines) == 1
        assert "cancelled" in error_lines[0]["message"].lower()

    def test_pip_failure_emits_error_with_stderr(self, bootstrap, capsys):
        """Failed pip install emits an error with the captured pip output."""
        failed = MagicMock()
        failed.returncode = 1
        failed.stdout = "Could not find version"

        with _patch_not_installed(bootstrap):
            with patch("base64.b64decode", return_value=b"fake wheel data"):
                with patch("subprocess.run", return_value=failed):
                    with pytest.raises(Exception):
                        bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        error_lines = [l for l in lines if l["status"] == "error"]
        assert len(error_lines) == 1
        assert "Could not find version" in error_lines[0]["message"]

    def test_wheel_file_cleaned_up_on_success(self, bootstrap):
        """The temporary wheel file is removed after successful install."""
        whl_path = os.path.join(
            tempfile.gettempdir(),
            f"osml_jupyter-{bootstrap._VERSION}-py3-none-any.whl",
        )

        with _patch_not_installed(bootstrap):
            with _successful_pip():
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        bootstrap._ensure_installed()

        assert not os.path.exists(whl_path)

    def test_wheel_file_cleaned_up_on_error(self, bootstrap):
        """The temporary wheel file is removed even when install fails."""
        failed = MagicMock()
        failed.returncode = 1
        failed.stdout = "fail"

        whl_path = os.path.join(
            tempfile.gettempdir(),
            f"osml_jupyter-{bootstrap._VERSION}-py3-none-any.whl",
        )

        with _patch_not_installed(bootstrap):
            with patch("base64.b64decode", return_value=b"fake wheel data"):
                with patch("subprocess.run", return_value=failed):
                    with pytest.raises(Exception):
                        bootstrap._ensure_installed()

        assert not os.path.exists(whl_path)

    def test_all_messages_have_source_osml(self, bootstrap, capsys):
        """Every emitted message has source='osml' for frontend filtering."""
        with _patch_not_installed(bootstrap):
            with _successful_pip():
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        for line in lines:
            assert line["source"] == "osml"

    def test_all_messages_have_stage_pip_install(self, bootstrap, capsys):
        """Every emitted message has stage='pip_install'."""
        with _patch_not_installed(bootstrap):
            with _successful_pip():
                with _patch_record(bootstrap):
                    with patch("base64.b64decode", return_value=b"fake wheel data"):
                        with patch("os.path.exists", return_value=False):
                            bootstrap._ensure_installed()

        output = capsys.readouterr().out
        lines = [json.loads(l) for l in output.strip().split("\n") if l.strip()]
        for line in lines:
            assert line["stage"] == "pip_install"
