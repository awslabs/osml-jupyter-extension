"""
Unit tests for Pyramid Build Processor
"""

import os
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from aws.osml.jupyter.processors.pyramid import (
    PyramidBuildProcessor,
    _build_cog_path,
    _build_rset_paths,
    _determine_format,
)

OSML_KERNEL_PYRAMID_PATH = (
    Path(__file__).parent.parent.parent / "src" / "kernel" / "aws" / "osml" / "jupyter" / "processors" / "pyramid.py"
)


class MockComm:
    def __init__(self):
        self.messages = []
        self._done = threading.Event()

    def send(self, data):
        self.messages.append(data)
        if data.get('status') in ('SUCCESS', 'ERROR'):
            self._done.set()

    def wait_for_result(self, timeout=5):
        self._done.wait(timeout)

    @property
    def last_message(self):
        return self.messages[-1] if self.messages else None

    @property
    def progress_messages(self):
        return [m for m in self.messages if m.get('status') == 'PROGRESS']


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


class MockCacheManager:
    def __init__(self):
        self.image_sessions = {}


class MockSource:
    def __init__(self):
        self.num_columns = 1024
        self.num_rows = 1024
        self.num_bands = 1
        self.pixel_value_type = "uint8"
        self.num_pixels_per_block_horizontal = 256
        self.num_pixels_per_block_vertical = 256


class MockReader:
    def __init__(self, source=None):
        self._source = source or MockSource()

    def get_asset(self, key):
        return self._source

    def close(self):
        pass


class MockWriter:
    def __init__(self):
        self.assets = []
        self.closed = False

    def add_asset(self, key, provider, title, description, roles):
        self.assets.append((key, provider, title, description, roles))

    def close(self):
        self.closed = True


class MockPyramidBuilder:
    def __init__(self, source, resample_func=None, progress=None):
        self.source = source
        self.resample_func = resample_func
        self.progress = progress
        self._levels = [source, MagicMock(), MagicMock(), MagicMock()]

    def build(self):
        return self._levels

    def build_and_write(self, writer, base_key="image:0"):
        if self.progress:
            self.progress(1, 2, 1)
            self.progress(2, 2, 1)
        for i in range(1, len(self._levels)):
            key = f"{base_key}:overview:{i}"
            writer.add_asset(key, self._levels[i], "", "", ["overview"])


class TestFormatDetection:

    def test_nitf_extensions(self):
        assert _determine_format('/path/to/file.ntf') == 'nitf'
        assert _determine_format('/path/to/file.nitf') == 'nitf'
        assert _determine_format('/path/to/FILE.NTF') == 'nitf'
        assert _determine_format('/path/to/FILE.NITF') == 'nitf'

    def test_tiff_extensions(self):
        assert _determine_format('/path/to/file.tif') == 'geotiff'
        assert _determine_format('/path/to/file.tiff') == 'geotiff'
        assert _determine_format('/path/to/FILE.TIF') == 'geotiff'
        assert _determine_format('/path/to/FILE.TIFF') == 'geotiff'

    def test_unsupported_extension(self):
        with pytest.raises(ValueError, match="Unsupported format"):
            _determine_format('/path/to/file.jpg')

    def test_no_extension(self):
        with pytest.raises(ValueError, match="Unsupported format"):
            _determine_format('/path/to/noext')


class TestPathGeneration:

    def test_rset_paths(self):
        paths = _build_rset_paths('/data/image.ntf', 3)
        assert paths == [
            '/data/image.ntf',
            '/data/image.ntf.r1',
            '/data/image.ntf.r2',
            '/data/image.ntf.r3',
        ]

    def test_cog_path(self):
        assert _build_cog_path('/data/image.tif') == '/data/image_cog.tif'
        assert _build_cog_path('/data/image.tiff') == '/data/image_cog.tiff'


class TestPyramidBuildProcessor:

    def test_missing_dataset_field(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = PyramidBuildProcessor(cache, logger)
        processor.process({}, comm)

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_file_not_found(self):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        processor = PyramidBuildProcessor(cache, logger)
        processor.process({'dataset': '/nonexistent/file.ntf'}, comm)
        comm.wait_for_result()

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'ERROR'
        assert 'not found' in msg['error'].lower() or 'File not found' in msg['error']

    def test_successful_nitf_build(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.ntf"
        source_file.write_bytes(b"fake ntf content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        assert msg['outputPath'] == f"{source_file}.r1"
        assert msg['dataset'] == str(source_file)

    def test_successful_tiff_build(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.tif"
        source_file.write_bytes(b"fake tif content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'SUCCESS'
        expected_output = str(tmp_path / "test_cog.tif")
        assert msg['outputPath'] == expected_output

    def test_unsupported_format_error(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.jpg"
        source_file.write_bytes(b"fake jpg content")

        processor = PyramidBuildProcessor(cache, logger)
        processor.process({'dataset': str(source_file)}, comm)
        comm.wait_for_result()

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'ERROR'
        assert 'Unsupported format' in msg['error']

    def test_io_error_during_build(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.ntf"
        source_file.write_bytes(b"fake ntf content")

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io:
            mock_io.open.side_effect = IOError("Permission denied")

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        msg = comm.last_message
        assert msg['type'] == 'PYRAMID_BUILD_RESPONSE'
        assert msg['status'] == 'ERROR'

    def test_uses_sips_rrds_resample(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.ntf"
        source_file.write_bytes(b"fake ntf content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        builder_calls = []

        class TrackingPyramidBuilder(MockPyramidBuilder):
            def __init__(self, source, resample_func=None, progress=None):
                builder_calls.append(resample_func)
                super().__init__(source, resample_func, progress)

        import aws.osml.jupyter.processors.pyramid as pyramid_mod

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', TrackingPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        assert len(builder_calls) == 1
        assert builder_calls[0] is pyramid_mod.sips_rrds_resample

    def test_progress_messages_sent(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.ntf"
        source_file.write_bytes(b"fake ntf content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        progress = comm.progress_messages
        assert len(progress) >= 1
        assert progress[0]['status'] == 'PROGRESS'
        assert 'percent' in progress[0]
        assert 'level' in progress[0]


class TestNitfWriterIntegration:

    def test_writer_receives_overview_assets(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.ntf"
        source_file.write_bytes(b"fake ntf content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        assert mock_writer.closed
        assert len(mock_writer.assets) == 3
        assert mock_writer.assets[0][0] == "image:0:overview:1"
        assert mock_writer.assets[0][4] == ["overview"]
        assert mock_writer.assets[1][0] == "image:0:overview:2"
        assert mock_writer.assets[2][0] == "image:0:overview:3"

    def test_nitf_writer_uses_temp_base(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "image.ntf"
        source_file.write_bytes(b"fake ntf content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        open_calls = []

        def track_open(*args, **kwargs):
            open_calls.append(args)
            if args[1] == "r":
                return mock_reader
            return mock_writer

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = track_open

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        write_call = open_calls[1]
        assert write_call[0][0] != str(source_file)
        assert write_call[0][0].endswith('.ntf')
        assert f"{source_file}.r1" in write_call[0]
        assert write_call[1] == "w"
        assert write_call[2] == "nitf"

    def test_cog_writer_receives_base_asset(self, tmp_path):
        cache = MockCacheManager()
        comm = MockComm()
        logger = MockLogger()

        source_file = tmp_path / "test.tif"
        source_file.write_bytes(b"fake tif content")

        mock_source = MockSource()
        mock_reader = MockReader(mock_source)
        mock_writer = MockWriter()

        with patch('aws.osml.jupyter.processors.pyramid.IO') as mock_io, \
             patch('aws.osml.jupyter.processors.pyramid.PyramidBuilder', MockPyramidBuilder):
            mock_io.open.side_effect = [mock_reader, mock_writer]

            processor = PyramidBuildProcessor(cache, logger)
            processor.process({'dataset': str(source_file)}, comm)
            comm.wait_for_result()

        assert mock_writer.closed
        assert mock_writer.assets[0][0] == "image:0"
        assert mock_writer.assets[0][4] == ["data"]
        assert mock_writer.assets[1][0] == "image:0:overview:1"
