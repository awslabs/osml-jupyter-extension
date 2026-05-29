"""
Unit tests for Image Processors
"""

import base64
from pathlib import Path
from unittest.mock import MagicMock, call

import numpy as np
import pytest

from aws.osml.jupyter.processors.image import (
    ImageLoadProcessor,
    ImageMetadataProcessor,
    ImageStatisticsProcessor,
    ImageTileProcessor,
    ImageUnloadProcessor,
)

OSML_KERNEL_IMAGE_PATH = (
    Path(__file__).parent.parent.parent / "src" / "kernel" / "aws" / "osml" / "jupyter" / "processors" / "image.py"
)


class MockBandStatistics:
    def __init__(self, band_idx=0):
        self.min = float(band_idx * 10)
        self.max = float(band_idx * 10 + 255)
        self.mean = float(band_idx * 10 + 127)
        self.stddev = 50.0
        self.count = 262144
        self.histogram = None
        self.bin_edges = None


class MockBandStatisticsWithHistogram:
    def __init__(self):
        self.min = 0.0
        self.max = 255.0
        self.mean = 128.0
        self.stddev = 50.0
        self.count = 262144
        self.histogram = np.array([10, 20, 30, 40, 50])
        self.bin_edges = np.array([0.0, 51.0, 102.0, 153.0, 204.0, 255.0])


class MockImageStatistics:
    def __init__(self, num_bands=3, with_histogram=False):
        self.sample_rate = 0.1
        if with_histogram:
            self.bands = [MockBandStatisticsWithHistogram() for _ in range(num_bands)]
        else:
            self.bands = [MockBandStatistics(i) for i in range(num_bands)]


class MockPyramid:
    def __init__(self, num_bands=3, with_histogram=False, num_levels=1):
        self._num_bands = num_bands
        self._with_histogram = with_histogram
        self.num_levels = num_levels

    def compute_statistics(self, num_bins=0):
        return MockImageStatistics(self._num_bands, with_histogram=(num_bins > 0))


class MockChipFactory:
    def __init__(self, return_none=False):
        self._return_none = return_none

    def create_chip(self, src_window, output_size=None):
        if self._return_none:
            return None
        return b'\x89PNG\r\n\x1a\n' + b'\x00' * 100


class MockAsset:
    def __init__(self, metadata=None):
        self.num_columns = 1024
        self.num_rows = 768
        self.metadata = metadata if metadata is not None else {"IREP": "MONO", "ICAT": "SAR"}


class MockImageSession:
    def __init__(self, width=1024, height=768, chip_factory=None, pyramid=None,
                 sensor_model=None, asset=None, native_num_levels=None):
        self.width = width
        self.height = height
        self.chip_factory = chip_factory or MockChipFactory()
        self.pyramid = pyramid or MockPyramid()
        self.native_num_levels = native_num_levels if native_num_levels is not None else self.pyramid.num_levels
        self.sensor_model = sensor_model
        self.asset = asset or MockAsset()
        self.asset._num_bands = self.pyramid._num_bands
        self.reader = MagicMock()
        self.display = MagicMock()


class MockCacheManager:
    def __init__(self):
        self.image_sessions = {}
        self.metadata_cache = {}
        self.statistics_cache = {}
        self._load_image_session = None

    def get_image_session(self, dataset):
        return self.image_sessions.get(dataset)

    def load_image(self, dataset):
        if self._load_image_session:
            session = self._load_image_session
            self.image_sessions[dataset] = session
            return session
        raise RuntimeError(f"Failed to load image dataset '{dataset}'")

    def _compute_statistics_adaptive(self, asset, num_bins=0):
        num_bands = asset._num_bands if hasattr(asset, '_num_bands') else 3
        return MockImageStatistics(num_bands, with_histogram=(num_bins > 0))

    def unload_image(self, dataset):
        return self.image_sessions.pop(dataset, None) is not None


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


class TestImageLoadProcessor:

    def test_successful_load(self):
        session = MockImageSession(width=2048, height=1024)
        cache = MockCacheManager()
        cache._load_image_session = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageLoadProcessor(cache, logger)
        processor.process({'dataset': '/path/to/image.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_LOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['width'] == 2048
        assert msg['height'] == 1024
        assert msg['dataset'] == '/path/to/image.ntf'
        assert msg['numLevels'] == 1

    def test_successful_load_with_native_overviews(self):
        pyramid = MockPyramid(num_levels=5)
        session = MockImageSession(width=4096, height=4096, pyramid=pyramid)
        cache = MockCacheManager()
        cache._load_image_session = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageLoadProcessor(cache, logger)
        processor.process({'dataset': '/path/to/cog.tif'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_LOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['numLevels'] == 5

    def test_missing_dataset_field(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = ImageLoadProcessor(cache, logger)
        processor.process({}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_LOAD_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_load_failure(self):
        cache = MockCacheManager()
        cache._load_image_session = None
        comm = MockComm()
        logger = MockLogger()

        processor = ImageLoadProcessor(cache, logger)
        processor.process({'dataset': '/nonexistent.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_LOAD_RESPONSE'
        assert msg['status'] == 'ERROR'


class TestImageTileProcessor:

    def test_successful_tile(self):
        session = MockImageSession()
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf', 'zoom': 0, 'row': 0, 'col': 0}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_TILE_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert 'img' in msg
        decoded = base64.b64decode(msg['img'])
        assert decoded[:4] == b'\x89PNG'

    def test_tile_at_zoom_level(self):
        """Tile request at zoom=-1 should double the source window"""
        calls = []

        class TrackingChipFactory:
            def create_chip(self, src_window, output_size=None):
                calls.append((src_window.x, src_window.y, src_window.width, src_window.height))
                return b'\x89PNG\r\n\x1a\n' + b'\x00' * 10

        session = MockImageSession(width=4096, height=4096, chip_factory=TrackingChipFactory())
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf', 'zoom': -1, 'row': 1, 'col': 2}, comm)

        # zoom=-1 => scale=2, scaled_tile_size=1024
        # src_x = 2 * 1024 = 2048, src_y = 1 * 1024 = 1024
        assert calls[0] == (2048, 1024, 1024, 1024)

    def test_tile_zoom_positive(self):
        """Tile request at zoom=1 should halve the source window"""
        calls = []

        class TrackingChipFactory:
            def create_chip(self, src_window, output_size=None):
                calls.append((src_window.x, src_window.y, src_window.width, src_window.height))
                return b'\x89PNG\r\n\x1a\n' + b'\x00' * 10

        session = MockImageSession(chip_factory=TrackingChipFactory())
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf', 'zoom': 1, 'row': 0, 'col': 1}, comm)

        # zoom=1 => scale=0.5, scaled_tile_size=256
        # src_x = 1 * 256 = 256, src_y = 0 * 256 = 0
        assert calls[0] == (256, 0, 256, 256)

    def test_image_not_loaded(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/missing.ntf', 'zoom': 0, 'row': 0, 'col': 0}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_TILE_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_chip_returns_none(self):
        """When chip_factory returns None, send empty img"""
        session = MockImageSession(chip_factory=MockChipFactory(return_none=True))
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf', 'zoom': 0, 'row': 0, 'col': 0}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_TILE_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['img'] == ''

    def test_missing_required_fields(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = ImageTileProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['status'] == 'ERROR'


class TestImageMetadataProcessor:

    def test_extracts_metadata_from_session(self):
        asset = MockAsset(metadata={"IREP": "MONO", "ICAT": "SAR", "TGTID": "AB1234"})
        session = MockImageSession(asset=asset)
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageMetadataProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_METADATA_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['metadata']['IREP'] == 'MONO'
        assert msg['metadata']['TGTID'] == 'AB1234'

    def test_uses_cache_on_second_call(self):
        asset = MockAsset(metadata={"key": "value"})
        session = MockImageSession(asset=asset)
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageMetadataProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)
        processor.process({'dataset': '/img.ntf'}, comm)

        assert len(comm.messages) == 2
        assert comm.messages[0]['metadata'] == comm.messages[1]['metadata']
        assert '/img.ntf' in cache.metadata_cache

    def test_empty_metadata(self):
        class EmptyMetadataAsset:
            def __init__(self):
                self.num_columns = 512
                self.num_rows = 512
                self.metadata = None

        session = MockImageSession(asset=EmptyMetadataAsset())
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageMetadataProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['metadata'] == {}

    def test_auto_loads_image(self):
        session = MockImageSession(asset=MockAsset(metadata={"auto": "loaded"}))
        cache = MockCacheManager()
        cache._load_image_session = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageMetadataProcessor(cache, logger)
        processor.process({'dataset': '/new.ntf'}, comm)

        msg = comm.last_message
        assert msg['status'] == 'SUCCESS'
        assert msg['metadata']['auto'] == 'loaded'


class TestImageStatisticsProcessor:

    def test_basic_statistics(self):
        session = MockImageSession(pyramid=MockPyramid(num_bands=3))
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageStatisticsProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_STATISTICS_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        stats = msg['statistics']
        assert stats['band_count'] == 3
        assert 'sample_rate' in stats
        assert len(stats['bands']) == 3

        band0 = stats['bands'][0]
        assert 'min' in band0
        assert 'max' in band0
        assert 'mean' in band0
        assert 'std' in band0
        assert 'count' in band0
        assert band0['band_number'] == 1

    def test_statistics_with_histogram(self):
        session = MockImageSession(pyramid=MockPyramid(num_bands=1, with_histogram=True))
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageStatisticsProcessor(cache, logger)
        processor.process({
            'dataset': '/img.ntf',
            'compute_histogram': True,
            'histogram_bins': 5,
        }, comm)

        msg = comm.last_message
        stats = msg['statistics']
        band0 = stats['bands'][0]
        assert 'histogram' in band0
        hist = band0['histogram']
        assert hist['bins'] == 5
        assert isinstance(hist['counts'], list)
        assert isinstance(hist['bin_edges'], list)

    def test_statistics_cached(self):
        session = MockImageSession(pyramid=MockPyramid(num_bands=1))
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageStatisticsProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)
        processor.process({'dataset': '/img.ntf'}, comm)

        assert len(comm.messages) == 2
        assert comm.messages[0]['statistics'] == comm.messages[1]['statistics']

    def test_auto_loads_image(self):
        session = MockImageSession(pyramid=MockPyramid(num_bands=2))
        cache = MockCacheManager()
        cache._load_image_session = session
        comm = MockComm()
        logger = MockLogger()

        processor = ImageStatisticsProcessor(cache, logger)
        processor.process({'dataset': '/new.ntf'}, comm)

        msg = comm.last_message
        assert msg['status'] == 'SUCCESS'
        assert msg['statistics']['band_count'] == 2


class TestImageUnloadProcessor:

    def test_successful_unload(self):
        session = MockImageSession()
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = session
        cache.metadata_cache['/img.ntf'] = {"some": "data"}
        cache.statistics_cache['/img.ntf:False:256'] = {"stats": "data"}
        comm = MockComm()
        logger = MockLogger()

        processor = ImageUnloadProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['unloaded'] is True
        assert msg['result'] == 'SUCCESS'
        assert '/img.ntf' not in cache.metadata_cache
        assert '/img.ntf:False:256' not in cache.statistics_cache

    def test_unload_not_found(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = ImageUnloadProcessor(cache, logger)
        processor.process({'dataset': '/missing.ntf'}, comm)

        msg = comm.last_message
        assert msg['type'] == 'IMAGE_UNLOAD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['unloaded'] is False
        assert msg['result'] == 'NOT_FOUND'

    def test_clears_all_statistics_variants(self):
        cache = MockCacheManager()
        cache.image_sessions['/img.ntf'] = MockImageSession()
        cache.statistics_cache['/img.ntf:False:256'] = {}
        cache.statistics_cache['/img.ntf:True:128'] = {}
        cache.statistics_cache['/other.ntf:False:256'] = {}
        comm = MockComm()
        logger = MockLogger()

        processor = ImageUnloadProcessor(cache, logger)
        processor.process({'dataset': '/img.ntf'}, comm)

        assert '/img.ntf:False:256' not in cache.statistics_cache
        assert '/img.ntf:True:128' not in cache.statistics_cache
        assert '/other.ntf:False:256' in cache.statistics_cache


class TestNoGDALReferences:
    """Verify no GDAL/osgeo imports remain in the processors file"""

    def test_no_gdal_in_source(self):
        content = OSML_KERNEL_IMAGE_PATH.read_text()
        assert 'from osgeo' not in content
        assert 'import gdal' not in content
        assert 'GDALTileFactory' not in content
        assert 'GDALImageFormats' not in content
        assert 'GDALCompressionOptions' not in content
        assert 'RangeAdjustmentType' not in content
        assert 'load_gdal_dataset' not in content
        assert 'xml.etree' not in content

    def test_uses_chip_factory_api(self):
        content = OSML_KERNEL_IMAGE_PATH.read_text()
        assert 'chip_factory.create_chip' in content
        assert 'PixelWindow' in content
        assert 'ImageSize' in content

    def test_uses_session_api(self):
        content = OSML_KERNEL_IMAGE_PATH.read_text()
        assert 'get_image_session' in content
        assert 'session.pyramid.compute_statistics' in content
        assert 'session.asset.metadata' in content
