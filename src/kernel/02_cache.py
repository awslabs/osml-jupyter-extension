# Copyright Amazon.com, Inc. or its affiliates.

# Cache management: AdvancedCacheManager and caching logic

import time
from osgeo import gdal, gdalconst
gdal.UseExceptions()

from aws.osml.gdal import load_gdal_dataset, GDALImageFormats, GDALCompressionOptions, RangeAdjustmentType
from aws.osml.image_processing import GDALTileFactory
from aws.osml.features import STRFeature2DSpatialIndex, ImagedFeaturePropertyAccessor

import geojson
import shapely
from math import ceil, log, radians

def get_standard_overviews(width: int, height: int, preview_size: int):
    """Calculate standard overview levels for an image"""
    min_side = min(width, height)
    num_overviews = ceil(log(min_side / preview_size) / log(2))
    if num_overviews > 0:
        result = []
        for i in range(1, num_overviews + 1):
            result.append(2**i)
        return result
    return []

class AdvancedCacheManager:
    """Centralized cache management with lifecycle support"""
    
    def __init__(self):
        self.image_factories = {}
        self.overlay_factories = {}
        self.metadata_cache = {}
        self.statistics_cache = {}
        self.endpoint_cache = {}
        self.model_results_cache = {}  # Key: "dataset:endpoint:zoom:row:col"
        self.cache_stats = {'hits': 0, 'misses': 0}
    
    def get_image_factory(self, dataset):
        """Get image factory from cache"""
        if dataset in self.image_factories:
            self.cache_stats['hits'] += 1
            return self.image_factories[dataset]
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def set_image_factory(self, dataset, factory):
        """Store image factory in cache"""
        self.image_factories[dataset] = factory
    
    def get_overlay_factory(self, key):
        """Get overlay factory from cache"""
        if key in self.overlay_factories:
            self.cache_stats['hits'] += 1
            return self.overlay_factories[key]
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def set_overlay_factory(self, key, factory):
        """Store overlay factory in cache"""
        self.overlay_factories[key] = factory
    
    def load_image(self, dataset):
        """Load and cache image factory with proper error handling"""
        if dataset in self.image_factories:
            return self.image_factories[dataset]
        
        try:
            ds, sensor_model = load_gdal_dataset(dataset)
            band = ds.GetRasterBand(1)
            overview_count = band.GetOverviewCount()
            if overview_count == 0:
                overviews = get_standard_overviews(ds.RasterXSize, ds.RasterYSize, 1024)
                ds.BuildOverviews("CUBIC", overviews)
            viz_tile_factory = GDALTileFactory(ds,
                                               sensor_model,
                                               GDALImageFormats.PNG,
                                               GDALCompressionOptions.NONE,
                                               output_type=gdalconst.GDT_Byte,
                                               range_adjustment=RangeAdjustmentType.DRA)
            self.image_factories[dataset] = viz_tile_factory
            return viz_tile_factory
        except Exception as e:
            raise RuntimeError(f"Failed to load image dataset '{dataset}': {str(e)}")
    
    def unload_image(self, dataset):
        """Explicit cleanup with resource disposal"""
        if dataset in self.image_factories:
            # Note: In future versions, we might want to call cleanup methods on the factory
            del self.image_factories[dataset]
            return True
        return False
    
    def load_overlay(self, image_name, overlay_name):
        """Load and cache overlay factory with proper error handling"""
        key = f"{image_name}:{overlay_name}"
        if key in self.overlay_factories:
            return self.overlay_factories[key]
        
        try:
            with open(overlay_name, "r") as geojson_file:
                fc = geojson.load(geojson_file)
            
            # Get sensor model and image dimensions for coordinate conversion
            image_factory = self.get_image_factory(image_name)
            if image_factory is None:
                # Try to load the image if it's not in cache
                image_factory = self.load_image(image_name)
                if image_factory is None:
                    raise ValueError(f"Failed to load image for coordinate conversion: {image_name}")
            
            sensor_model = image_factory.sensor_model
            if sensor_model is None:
                raise ValueError(f"No sensor model available for dataset: {image_name}")
            
            # Get image dimensions for bounds checking
            ds = image_factory.raster_dataset
            image_width = ds.RasterXSize
            image_height = ds.RasterYSize
            
            # Process each feature to handle different coordinate systems
            features_to_keep = []
            accessor = ImagedFeaturePropertyAccessor()
            
            for f in fc['features']:
                try:
                    # Check if feature already has imageGeometry (existing behavior)
                    existing_geom = accessor.find_image_geometry(f)
                    if existing_geom is not None:
                        # Feature already has image coordinates, keep as-is
                        accessor.set_image_geometry(f, existing_geom)
                        features_to_keep.append(f)
                        continue
                    
                    # Project feature from world coordinates to image coordinates
                    feature_intersects = self._project_feature_to_image(f, sensor_model, image_width, image_height)
                    if feature_intersects:
                        features_to_keep.append(f)

                    # If feature doesn't intersect image bounds, skip it
                    
                except Exception as e:
                    # Log error but continue processing other features
                    print(f"Warning: Failed to process feature in overlay '{overlay_name}': {str(e)}")
                    continue
            
            # Update feature collection with only the valid features
            fc['features'] = features_to_keep
            
            tile_index = STRFeature2DSpatialIndex(fc, use_image_geometries=True)
            self.overlay_factories[key] = tile_index
            return tile_index
        except Exception as e:
            raise RuntimeError(f"Failed to load overlay '{overlay_name}': {str(e)}")
    
    def unload_overlay(self, image_name, overlay_name):
        """Explicit cleanup of overlay resources"""
        key = f"{image_name}:{overlay_name}"
        if key in self.overlay_factories:
            del self.overlay_factories[key]
            return True
        return False
    
    def get_model_results(self, dataset, endpoint, zoom, row, col):
        """Get cached model results with access tracking"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        if key in self.model_results_cache:
            self.cache_stats['hits'] += 1
            cache_entry = self.model_results_cache[key]
            
            # Update access statistics for LRU
            if isinstance(cache_entry, dict) and 'features' in cache_entry:
                cache_entry['access_count'] = cache_entry.get('access_count', 0) + 1
                cache_entry['last_access'] = time.time()
                return cache_entry['features']
            else:
                # Handle old cache format
                return cache_entry
        else:
            self.cache_stats['misses'] += 1
            return None
    
    def cache_model_results(self, dataset, endpoint, zoom, row, col, features):
        """Cache model inference results with memory management"""
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        
        # Implement LRU-style cache with size limit
        max_cache_size = 1000  # Maximum number of cached model results
        if len(self.model_results_cache) >= max_cache_size:
            # Remove oldest entries (simple FIFO for now, could be enhanced to true LRU)
            keys_to_remove = list(self.model_results_cache.keys())[:100]  # Remove oldest 100 entries
            for old_key in keys_to_remove:
                del self.model_results_cache[old_key]
        
        self.model_results_cache[key] = {
            'features': features,
            'timestamp': time.time(),
            'access_count': 1
        }
    
    def clear_model_cache_for_dataset(self, dataset):
        """Clear all model results for a specific dataset"""
        keys_to_remove = []
        for key in self.model_results_cache.keys():
            if key.startswith(f"{dataset}:"):
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.model_results_cache[key]
    
    def get_cache_info(self):
        """Get cache information and statistics"""
        return {
            'image_count': len(self.image_factories),
            'overlay_count': len(self.overlay_factories),
            'metadata_count': len(self.metadata_cache),
            'statistics_count': len(self.statistics_cache),
            'endpoint_count': len(self.endpoint_cache),
            'model_results_count': len(self.model_results_cache),
            'cache_stats': self.cache_stats.copy()
        }
    
    def _project_feature_to_image(self, feature, sensor_model, image_width, image_height):
        """
        Project a GeoJSON feature from world coordinates to image coordinates.
        Updates the feature in place and returns whether it intersects the image bounds.
        
        Args:
            feature: GeoJSON feature with world coordinates
            sensor_model: Sensor model for coordinate transformation  
            image_width: Image width in pixels
            image_height: Image height in pixels
            
        Returns:
            True if feature intersects with image bounds, False otherwise
        """
        feature_intersects_image = False
        
        # Create image bounds box for intersection testing
        image_box = shapely.box(0, 0, image_width, image_height)
        
        # Ensure properties exist
        if 'properties' not in feature:
            feature['properties'] = {}
        
        # Handle bbox attribute (direct feature attribute, not in properties)
        bbox = feature.get('bbox')
        if bbox is not None:
            image_bbox = self._convert_bbox_to_image_bbox(bbox, sensor_model)
            if image_bbox is not None:
                feature['properties']['imageBBox'] = image_bbox
                if shapely.intersects(shapely.box(image_bbox[0],
                                                  image_bbox[1],
                                                  image_bbox[2],
                                                  image_bbox[3]), image_box):
                    feature_intersects_image = True
        
        # Handle geometry property
        geometry = feature.get('geometry')
        if geometry is not None and geometry.get('coordinates'):
            image_geometry = self._convert_geometry_to_image_geometry(geometry, sensor_model)
            if image_geometry is not None:
                # Need to convert the shapely geometry to a pure dictionary for serialization
                feature['properties']['imageGeometry'] = shapely.geometry.mapping(image_geometry)
                # Check if geometry intersects with image bounds
                if shapely.intersects(image_geometry, image_box):
                    feature_intersects_image = True
        
        return feature_intersects_image
    
    def _convert_bbox_to_image_bbox(self, bbox, sensor_model):
        """Convert a bounding box from world coordinates (lat/lon) to image coordinates (pixels)"""
        from aws.osml.photogrammetry import GeodeticWorldCoordinate
        
        try:
            if len(bbox) < 4:
                return None
            
            # bbox format: [min_lon, min_lat, max_lon, max_lat] or [min_lon, min_lat, min_elev, max_lon, max_lat, max_elev]
            min_lon = bbox[0]
            min_lat = bbox[1]
            max_lon = bbox[2] if len(bbox) == 4 else bbox[3] if len(bbox) >= 5 else bbox[2]
            max_lat = bbox[3] if len(bbox) == 4 else bbox[4] if len(bbox) >= 5 else bbox[3]
            
            corners = [
                (min_lon, min_lat),
                (min_lon, max_lat),
                (max_lon, max_lat),
                (max_lon, min_lat)
            ]

            # Convert these corners, which are in decimal degrees latitude/longitude 
            # to GeodeticWorldCoordinates which use radians.
            # We eventually need to use an elevation model to assign the elevation
            # dimension to each corner. For now default to 0.0
            world_corners = [GeodeticWorldCoordinate([radians(c[0]), radians(c[1]), 0.0]) for c in corners]

            # Project all of the world corners into the image
            image_corners = [sensor_model.world_to_image(wc) for wc in world_corners]

            # The projected bbox is unlikely to be an actual bbox in the image so we need
            # to compute new min/max boundaries for the projection in image coordinates.
            minx = float(image_corners[0].x)
            miny = float(image_corners[0].y)
            maxx = minx
            maxy = miny
            for ic in image_corners[1:]:
                minx = min(minx, float(ic.x))
                miny = min(miny, float(ic.y))
                maxx = max(maxx, float(ic.x))
                maxy = max(maxy, float(ic.y))

            return [minx, miny, maxx, maxy]
        except Exception as e:
            print(f"Warning: Failed to convert bbox: {str(e)}")
            return None
    
    def _convert_geometry_to_image_geometry(self, geojson_geometry, sensor_model):
        """Convert GeoJSON geometry from world coordinates (lat/lon) to image coordinates (pixels)"""
        from aws.osml.photogrammetry import GeodeticWorldCoordinate
        
        if geojson_geometry is None:
            return None

        # Handle various collections of geometries
        if isinstance(geojson_geometry, dict) and geojson_geometry.get('type') == 'GeometryCollection':
            # Recursively convert all geometries in the collection
            converted_geometries = []
            for geometry in geojson_geometry.get('geometries', []):
                converted_geom = self._convert_geometry_to_image_geometry(geometry, sensor_model)
                if converted_geom is not None:
                    converted_geometries.append(converted_geom)
            
            if converted_geometries:
                return shapely.GeometryCollection(converted_geometries)
            return None
        
        elif geojson_geometry.get('type', '').startswith('Multi'):
            # Handle Multi* geometry types by recursively processing each sub-geometry
            geom_type = geojson_geometry.get('type')
            coordinates = geojson_geometry.get('coordinates', [])
            
            if geom_type == 'MultiPoint':
                points = []
                for coord in coordinates:
                    try:
                        image_coord = sensor_model.world_to_image(
                            GeodeticWorldCoordinate([radians(coord[0]),
                                                   radians(coord[1]),
                                                   coord[2] if len(coord) > 2 else 0.0])
                        )
                        points.append(shapely.Point(image_coord.x, image_coord.y))
                    except Exception as e:
                        print(f"Warning: Failed to convert MultiPoint coordinate {coord}: {str(e)}")
                        continue
                return shapely.MultiPoint(points) if points else None
                
            elif geom_type == 'MultiLineString':
                linestrings = []
                for line_coords in coordinates:
                    converted_coords = []
                    for coord in line_coords:
                        try:
                            image_coord = sensor_model.world_to_image(
                                GeodeticWorldCoordinate([radians(coord[0]),
                                                       radians(coord[1]),
                                                       coord[2] if len(coord) > 2 else 0.0])
                            )
                            converted_coords.append((image_coord.x, image_coord.y))
                        except Exception as e:
                            print(f"Warning: Failed to convert MultiLineString coordinate {coord}: {str(e)}")
                            continue
                    
                    if len(converted_coords) >= 2:  # LineString needs at least 2 points
                        linestrings.append(shapely.LineString(converted_coords))
                return shapely.MultiLineString(linestrings) if linestrings else None
                
            elif geom_type == 'MultiPolygon':
                polygons = []
                for polygon_coords in coordinates:
                    converted_rings = []
                    for ring in polygon_coords:
                        converted_ring = []
                        for coord in ring:
                            try:
                                image_coord = sensor_model.world_to_image(
                                    GeodeticWorldCoordinate([radians(coord[0]),
                                                           radians(coord[1]),
                                                           coord[2] if len(coord) > 2 else 0.0])
                                )
                                converted_ring.append((image_coord.x, image_coord.y))
                            except Exception as e:
                                print(f"Warning: Failed to convert MultiPolygon coordinate {coord}: {str(e)}")
                                continue
                        
                        if len(converted_ring) >= 4:  # Polygon ring needs at least 4 points (including closure)
                            converted_rings.append(converted_ring)
                    
                    if converted_rings:
                        # First ring is exterior, rest are holes
                        exterior = converted_rings[0]
                        holes = converted_rings[1:] if len(converted_rings) > 1 else None
                        polygons.append(shapely.Polygon(exterior, holes))
                return shapely.MultiPolygon(polygons) if polygons else None
            
            else:
                print(f"Warning: Unknown Multi geometry type: {geom_type}")
                return None
            
        geom_type = geojson_geometry.get('type')
        coordinates = geojson_geometry.get('coordinates')

        if not coordinates:
            return None

        if geom_type == 'Point':
            # Single coordinate pair
            try:
                elevation = coordinates[2] if len(coordinates) > 2 else 0.0
                image_coord = sensor_model.world_to_image(
                    GeodeticWorldCoordinate([radians(coordinates[0]),
                                           radians(coordinates[1]),
                                           elevation])
                )
                return shapely.Point(image_coord.x, image_coord.y)
            except Exception as e:
                print(f"Warning: Failed to convert Point geometry: {str(e)}")
                return None
                
        elif geom_type == 'LineString':
            # Handle LineString geometries by converting each coordinate
            converted_coords = []
            for coord in coordinates:
                try:
                    elevation = coord[2] if len(coord) > 2 else 0.0
                    image_coord = sensor_model.world_to_image(
                        GeodeticWorldCoordinate([radians(coord[0]),
                                               radians(coord[1]),
                                               elevation])
                    )
                    converted_coords.append((image_coord.x, image_coord.y))
                except Exception as e:
                    print(f"Warning: Failed to convert LineString coordinate {coord}: {str(e)}")
                    continue
            
            # LineString needs at least 2 points
            if len(converted_coords) >= 2:
                return shapely.LineString(converted_coords)
            else:
                print("Warning: LineString has insufficient valid coordinates after conversion")
                return None
                
        elif geom_type == 'Polygon':
            # Handle Polygon geometries which have an outer boundary and optional holes
            converted_rings = []
            
            for ring in coordinates:
                converted_ring = []
                for coord in ring:
                    try:
                        elevation = coord[2] if len(coord) > 2 else 0.0
                        image_coord = sensor_model.world_to_image(
                            GeodeticWorldCoordinate([radians(coord[0]),
                                                   radians(coord[1]),
                                                   elevation])
                        )
                        converted_ring.append((image_coord.x, image_coord.y))
                    except Exception as e:
                        print(f"Warning: Failed to convert Polygon coordinate {coord}: {str(e)}")
                        continue
                
                # Polygon ring needs at least 4 points (including the closing point)
                if len(converted_ring) >= 4:
                    converted_rings.append(converted_ring)
                else:
                    print(f"Warning: Polygon ring has insufficient valid coordinates after conversion")
            
            if converted_rings:
                # First ring is the exterior boundary, subsequent rings are holes
                exterior = converted_rings[0]
                holes = converted_rings[1:] if len(converted_rings) > 1 else None
                return shapely.Polygon(exterior, holes)
            else:
                print("Warning: Polygon has no valid rings after conversion")
                return None

        # Log exception for unknown geometry type
        print(f"Error: Unknown geometry type '{geom_type}' encountered during coordinate conversion")
        return None

    def clear_all_caches(self):
        """Clear all caches"""
        self.image_factories.clear()
        self.overlay_factories.clear()
        self.metadata_cache.clear()
        self.statistics_cache.clear()
        self.endpoint_cache.clear()
        self.model_results_cache.clear()
        self.cache_stats = {'hits': 0, 'misses': 0}
