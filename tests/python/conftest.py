"""
Pytest configuration and shared fixtures for OSML Jupyter Extension tests
"""

import pytest
import sys
from pathlib import Path
from fixtures.mock_comm import MockComm, MockKernel, MockCommManager


@pytest.fixture(scope="session")
def test_data_dir():
    """Fixture providing the test data directory path"""
    return Path("tests/python/fixtures")


@pytest.fixture
def mock_comm():
    """Fixture providing a fresh mock comm channel for each test"""
    return MockComm()


@pytest.fixture
def mock_kernel():
    """Fixture providing a fresh mock kernel for each test"""
    return MockKernel()


@pytest.fixture
def sample_tiff_path(test_data_dir):
    """Fixture providing path to sample single-band TIFF"""
    return test_data_dir / "sample_1band_512x512.tiff"


@pytest.fixture
def sample_rgb_tiff_path(test_data_dir):
    """Fixture providing path to sample RGB TIFF"""
    return test_data_dir / "sample_3band_256x256.tiff"


@pytest.fixture
def sample_geojson_path(test_data_dir):
    """Fixture providing path to sample GeoJSON"""
    return test_data_dir / "sample_overlay.geojson"


@pytest.fixture
def kernel_setup_file():
    """Fixture providing path to concatenated kernel setup file"""
    return Path("lib/kernel/kernel-setup.py")


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Session-scoped fixture to set up test environment"""
    # Ensure test data directory exists
    test_dir = Path("tests/python/fixtures")
    test_dir.mkdir(parents=True, exist_ok=True)
    
    # Create empty test files if they don't exist (for CI environments)
    test_files = [
        "sample_1band_512x512.tiff",
        "sample_3band_256x256.tiff", 
        "sample_overlay.geojson"
    ]
    
    for filename in test_files:
        test_file = test_dir / filename
        if not test_file.exists():
            test_file.touch()
    
    yield
    
    # Cleanup if needed


class IPythonMockManager:
    """Context manager for mocking IPython modules during tests"""
    
    def __init__(self):
        self.original_modules = {}
        self.mocked_modules = [
            'IPython',
            'IPython.core',
            'IPython.core.getipython'
        ]
    
    def __enter__(self):
        # Store original modules
        for module_name in self.mocked_modules:
            if module_name in sys.modules:
                self.original_modules[module_name] = sys.modules[module_name]
        
        # Create mock modules
        sys.modules['IPython'] = type(sys)('IPython')
        sys.modules['IPython.core'] = type(sys)('IPython.core')
        
        # Create a mock getipython function
        mock_kernel = MockKernel()
        sys.modules['IPython.core'].getipython = lambda: mock_kernel
        
        return mock_kernel
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        # Restore original modules
        for module_name, original_module in self.original_modules.items():
            sys.modules[module_name] = original_module
        
        # Remove mocked modules that weren't originally present
        for module_name in self.mocked_modules:
            if module_name not in self.original_modules and module_name in sys.modules:
                del sys.modules[module_name]


@pytest.fixture
def ipython_mock():
    """Fixture providing IPython module mocking context manager"""
    return IPythonMockManager()


# Markers for test categorization
pytest_plugins = []


def pytest_configure(config):
    """Configure pytest with custom markers"""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add markers based on test names"""
    for item in items:
        # Auto-mark integration tests
        if "integration" in item.name.lower() or "Integration" in item.cls.__name__ if item.cls else False:
            item.add_marker(pytest.mark.integration)
        
        # Auto-mark unit tests
        elif "unit" in item.name.lower() or any(keyword in item.name.lower() 
                                               for keyword in ["mock", "fixture", "response"]):
            item.add_marker(pytest.mark.unit)


def pytest_runtest_setup(item):
    """Setup hook for individual tests"""
    # Skip integration tests if build artifacts don't exist
    if item.get_closest_marker("integration"):
        kernel_file = Path("lib/kernel/kernel-setup.py")
        if not kernel_file.exists():
            pytest.skip("Integration tests require build artifacts - run 'jlpm build' first")
