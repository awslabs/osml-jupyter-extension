"""
Unit tests for Overlay Processors
"""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from aws.osml.jupyter.processors.overlay import (
    OverlayLoadProcessor,
    OverlayTileProcessor,
    OverlayUnloadProcessor,
)

OSML_KERNEL_OVERLAY_PATH = (
    Path(__file__).parent.parent.parent / "src" / "kernel" / "aws" / "osml" / "jupyter" / "processors" / "overlay.py"
)


class MockSpatialIndex:
    def __init__(self, features=None):
        self._features = features or []

    def find_intersects(self, bbox):
        return self._features


class MockCacheManager:
    def __init__(self):
        self.overlay_indices = {}
        self.image_sessions = {}
        self._load_overlay_result = None
        self._load_overlay_error = None

    def get_overlay_index(self, key):
        return self.overlay_indices.get(key)

    def load_overlay(self, image_name, overlay_name):
        if self._load_overlay_error:
            raise self._load_overlay_error
        if self._load_overlay_result is not None:
            key = f"{image_name}:{overlay_name}"
            self.overlay_indices[key] = self._load_overlay_result
            return self._load_overlay_result
        return None

    def unload_overlay(self, image_name, overlay_name):
        key = f"{image_name}:{overlay_name}"
        return self.overlay_indices.pop(key, None) is not None


class MockComm:
    def __init__(self):
        self.messages = []

    def send(self, data):
        self.messages.append(data)

    @property
    def last_message(self):
        return self.messages[-1] if self.messages else None


class MockLogger:
    def __init__(self):
        self.logs = []
        self.error_mappings = {
            "FileNotFoundError": "Image file not found",
            "PermissionError": "Insufficient permissions to access file",
            "MemoryError": "Insufficient memory to process request",
            "ValueError": "Invalid request parameters",
            "KeyError": "Missing required field in request",
            "RuntimeError": "Processing failed due to runtime error",
        }

    def info(self, msg):
        self.logs.append(('info', msg))

    def debug(self, msg):
        self.logs.append(('debug', msg))

    def warning(self, msg):
        self.logs.append(('warning', msg))

    def error(self, msg):
        self.logs.append(('error', msg))

    def log_error_detailed(self, operation, error, data=None):
        self.logs.append(('error_detailed', operation, str(error)))

    def get_user_friendly_message(self, error):
        error_type = type(error).__name__
        friendly_msg = self.error_mappings.get(error_type, "Processing failed")
        return f"{friendly_msg}: {str(error)}"


class TestOverlayTileProcessor:

    def test_successful_tile_from_cache(self):
        features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [10, 20]}}]
        index = MockSpatialIndex(features)
        cache = MockCacheManager()
        cache.overlay_indices["/img.ntf:/overlay.geojson"] = index
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayTileProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
            'zoom': 0, 'row': 0, 'col': 0
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_TILE_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['features'] == features

    def test_loads_overlay_when_not_cached(self):
        features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [5, 5]}}]
        index = MockSpatialIndex(features)
        cache = MockCacheManager()
        cache._load_overlay_result = index
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayTileProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
            'zoom': 0, 'row': 0, 'col': 0
        }, comm)

        msg = comm.last_message
        assert msg['status'] == 'SUCCESS'
        assert msg['features'] == features

    def test_error_when_overlay_cannot_load(self):
        cache = MockCacheManager()
        cache._load_overlay_result = None
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayTileProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/missing.geojson',
            'zoom': 0, 'row': 0, 'col': 0
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_TILE_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_empty_features(self):
        index = MockSpatialIndex(features=[])
        cache = MockCacheManager()
        cache.overlay_indices["/img.ntf:/overlay.geojson"] = index
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayTileProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
            'zoom': 0, 'row': 0, 'col': 0
        }, comm)

        msg = comm.last_message
        assert msg['status'] == 'SUCCESS'
        assert msg['features'] == []

    def test_missing_required_fields(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayTileProcessor(cache, logger)
        processor.process({'imageName': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['status'] == 'ERROR'


class TestOverlayLoadProcessor:

    def test_successful_load(self):
        index = MockSpatialIndex()
        cache = MockCacheManager()
        cache._load_overlay_result = index
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayLoadProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_LOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['imageName'] == '/img.ntf'
        assert msg['overlayName'] == '/overlay.geojson'

    def test_load_failure(self):
        cache = MockCacheManager()
        cache._load_overlay_error = RuntimeError("No sensor model")
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayLoadProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_LOAD_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_missing_required_fields(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayLoadProcessor(cache, logger)
        processor.process({'imageName': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['status'] == 'ERROR'


class TestOverlayUnloadProcessor:

    def test_successful_unload(self):
        index = MockSpatialIndex()
        cache = MockCacheManager()
        cache.overlay_indices["/img.ntf:/overlay.geojson"] = index
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayUnloadProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/overlay.geojson',
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_UNLOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['unloaded'] is True
        assert msg['result'] == 'SUCCESS'

    def test_unload_not_found(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayUnloadProcessor(cache, logger)
        processor.process({
            'imageName': '/img.ntf',
            'overlayName': '/missing.geojson',
        }, comm)

        msg = comm.last_message
        assert msg['type'] == 'OVERLAY_UNLOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['unloaded'] is False
        assert msg['result'] == 'NOT_FOUND'

    def test_missing_required_fields(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = OverlayUnloadProcessor(cache, logger)
        processor.process({}, comm)

        msg = comm.last_message
        assert msg['status'] == 'ERROR'


class TestNoGDALReferences:
    """Verify no GDAL/osgeo imports remain in the overlay processors file"""

    def test_no_gdal_in_source(self):
        content = OSML_KERNEL_OVERLAY_PATH.read_text()
        assert 'from osgeo' not in content
        assert 'import gdal' not in content
        assert 'GDALTileFactory' not in content
        assert 'load_gdal_dataset' not in content

    def test_uses_overlay_index_api(self):
        content = OSML_KERNEL_OVERLAY_PATH.read_text()
        assert 'get_overlay_index' in content
        assert 'load_overlay' in content
        assert 'unload_overlay' in content

    def test_no_factory_references(self):
        content = OSML_KERNEL_OVERLAY_PATH.read_text()
        assert 'get_overlay_factory' not in content
        assert 'tile_factory' not in content
