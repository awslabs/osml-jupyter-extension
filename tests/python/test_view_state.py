"""
Tests for ViewStateStore and the inbound state-stream processors
(VIEW_STATE_UPDATE / CLICK_EVENT).
"""

from unittest.mock import MagicMock

import pytest
from fixtures.mock_comm import MockComm

from aws.osml.jupyter.core import OSMLKernelLogger
from aws.osml.jupyter.main import _build_registry
from aws.osml.jupyter.processors.view_state import (
    ClickEventProcessor,
    ViewStateUpdateProcessor,
)
from aws.osml.jupyter.view_state import ViewStateStore


@pytest.fixture
def store():
    return ViewStateStore()


@pytest.fixture
def logger():
    return OSMLKernelLogger()


@pytest.fixture
def mock_comm():
    return MockComm()


class TestViewStateStore:
    """Unit tests for the raw image-space store (no sensor-model math)."""

    def test_initial_state_is_empty(self, store):
        assert store.current_image is None
        assert store.view_bounds is None
        assert store.last_click is None

    def test_update_view_stores_raw_bounds(self, store):
        store.update_view({
            'imageName': 'img.tiff',
            'minx': 1.0,
            'miny': 2.0,
            'maxx': 3.0,
            'maxy': 4.0,
            'zoom': 5.0,
        })

        assert store.current_image == 'img.tiff'
        assert store.view_bounds == {
            'minx': 1.0,
            'miny': 2.0,
            'maxx': 3.0,
            'maxy': 4.0,
            'zoom': 5.0,
        }

    def test_update_click_stores_raw_image_coords(self, store):
        store.update_click({
            'imageName': 'img.tiff',
            'x': 10.0,
            'y': 20.0,
            'feature': {'id': 'f1'},
            'layerId': 'layer-a',
        })

        assert store.current_image == 'img.tiff'
        assert store.last_click == {
            'x': 10.0,
            'y': 20.0,
            'feature': {'id': 'f1'},
            'layer_id': 'layer-a',
        }

    def test_update_click_without_feature(self, store):
        store.update_click({'imageName': 'img.tiff', 'x': 1.0, 'y': 2.0})

        assert store.last_click['feature'] is None
        assert store.last_click['layer_id'] is None

    def test_changing_image_clears_stale_click(self, store):
        store.update_click({'imageName': 'a.tiff', 'x': 1.0, 'y': 2.0})
        assert store.last_click is not None

        store.update_view({
            'imageName': 'b.tiff',
            'minx': 0, 'miny': 0, 'maxx': 1, 'maxy': 1, 'zoom': 0,
        })

        assert store.current_image == 'b.tiff'
        assert store.last_click is None

    def test_writes_perform_no_sensor_model_math(self, store):
        # Writes store raw image coordinates verbatim; world enrichment is
        # lazy on the viewer (Design 4e). The store must not reach for any
        # cache/session/sensor-model collaborator — it has none injected.
        assert not hasattr(store, 'cache_manager')
        assert not hasattr(store, 'sensor_model')

        store.update_view({
            'imageName': 'img.tiff',
            'minx': 0.5, 'miny': 1.5, 'maxx': 2.5, 'maxy': 3.5, 'zoom': 4,
        })
        store.update_click({'imageName': 'img.tiff', 'x': 1.25, 'y': 2.75})

        # Values are stored exactly as received — no radians/degrees or
        # projection transform applied.
        assert store.view_bounds['minx'] == 0.5
        assert store.last_click['x'] == 1.25
        assert store.last_click['y'] == 2.75


class TestViewStateUpdateProcessor:
    """VIEW_STATE_UPDATE processor: updates store, never replies."""

    def test_valid_payload_updates_store(self, store, logger, mock_comm):
        processor = ViewStateUpdateProcessor(store, logger)
        processor.process({
            'type': 'VIEW_STATE_UPDATE',
            'imageName': 'img.tiff',
            'minx': 1, 'miny': 2, 'maxx': 3, 'maxy': 4, 'zoom': 5,
        }, mock_comm)

        assert store.view_bounds['maxx'] == 3
        # Fire-and-forget: no response sent.
        assert mock_comm.message_count() == 0

    def test_malformed_payload_dropped_without_crash(self, store, logger, mock_comm):
        processor = ViewStateUpdateProcessor(store, logger)
        # Missing maxx/maxy/zoom.
        processor.process({
            'type': 'VIEW_STATE_UPDATE',
            'imageName': 'img.tiff',
            'minx': 1, 'miny': 2,
        }, mock_comm)

        assert store.view_bounds is None
        assert mock_comm.message_count() == 0


class TestClickEventProcessor:
    """CLICK_EVENT processor: updates store, never replies."""

    def test_valid_payload_updates_store(self, store, logger, mock_comm):
        processor = ClickEventProcessor(store, logger)
        processor.process({
            'type': 'CLICK_EVENT',
            'imageName': 'img.tiff',
            'x': 7, 'y': 8,
        }, mock_comm)

        assert store.last_click['x'] == 7
        assert store.last_click['y'] == 8
        assert mock_comm.message_count() == 0

    def test_malformed_payload_dropped_without_crash(self, store, logger, mock_comm):
        processor = ClickEventProcessor(store, logger)
        processor.process({'type': 'CLICK_EVENT', 'imageName': 'img.tiff'}, mock_comm)

        assert store.last_click is None
        assert mock_comm.message_count() == 0


class TestRegistryWiring:
    """The inbound types are routed through the shared registry to the store."""

    def test_registry_routes_to_shared_store(self, mock_comm):
        cache_manager = MagicMock()
        logger = OSMLKernelLogger()
        shared_store = ViewStateStore()
        registry = _build_registry(cache_manager, logger, shared_store)

        assert 'VIEW_STATE_UPDATE' in registry.get_registered_message_types()
        assert 'CLICK_EVENT' in registry.get_registered_message_types()

        registry.handle('VIEW_STATE_UPDATE', {
            'type': 'VIEW_STATE_UPDATE',
            'imageName': 'img.tiff',
            'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 10, 'zoom': 2,
        }, mock_comm)
        registry.handle('CLICK_EVENT', {
            'type': 'CLICK_EVENT',
            'imageName': 'img.tiff',
            'x': 5, 'y': 6,
        }, mock_comm)

        assert shared_store.view_bounds['maxx'] == 10
        assert shared_store.last_click['x'] == 5
        # No responses emitted for fire-and-forget messages.
        assert mock_comm.message_count() == 0
