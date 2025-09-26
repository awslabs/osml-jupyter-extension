from osgeo import gdal, gdalconst
gdal.UseExceptions()

from aws.osml.gdal import load_gdal_dataset, GDALImageFormats, GDALCompressionOptions, RangeAdjustmentType
from aws.osml.image_processing import GDALTileFactory
from aws.osml.features import STRFeature2DSpatialIndex, ImagedFeaturePropertyAccessor
from math import ceil, log

import base64
import geojson
import shapely
import os

def get_standard_overviews(width: int, height: int, preview_size: int):
    min_side = min(width, height)
    num_overviews = ceil(log(min_side / preview_size) / log(2))
    if num_overviews > 0:
        result = []
        for i in range(1, num_overviews + 1):
            result.append(2**i)
        return result
    return []

image_tile_factory_cache = {}
def get_image_tile_factory(dataset):
    if dataset not in image_tile_factory_cache.keys():
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
        image_tile_factory_cache[dataset] = viz_tile_factory
    return image_tile_factory_cache.get(dataset)

overlay_tile_factory_cache = {}
def get_overlay_tile_factory(image_name, overlay_name):
    key = f"{image_name}:{overlay_name}"
    if key not in overlay_tile_factory_cache.keys():
        with open(overlay_name,"r") as geojson_file:
            fc = geojson.load(geojson_file)
        
        # This workaround ensures all features have the imageGeometry property
        accessor = ImagedFeaturePropertyAccessor()
        for f in fc['features']:
            geom = accessor.find_image_geometry(f)
            accessor.set_image_geometry(f, geom)
                
        tile_index = STRFeature2DSpatialIndex(fc, use_image_geometries=True)
        overlay_tile_factory_cache[key] = tile_index    
    return overlay_tile_factory_cache.get(key)
        
def get_image_tile(dataset, zoom, row, col):
    tile_factory = get_image_tile_factory(dataset)
    print(base64.b64encode(tile_factory.create_encoded_tile([int(col)*512, int(row)*512, 512, 512])).decode('utf-8'))

def create_recv(comm):
    def _recv(msg):
        # Use msg['content']['data'] for the data in the message
        # print(msg['content']['data'])
        type = msg['content']['data']['type']
        
        if type == 'IMAGE_LOAD_REQUEST':
            dataset = msg['content']['data']['dataset']
            tile_factory = get_image_tile_factory(dataset)
            status = "FAILED"
            if tile_factory is not None:
                status = "SUCCESS"
            comm.send({
                'type': "IMAGE_LOAD_RESPONSE",
                'dataset': dataset,
                'status': status
            })
        elif type == 'IMAGE_TILE_REQUEST':
            dataset = msg['content']['data']['dataset']
            zoom = msg['content']['data']['zoom']
            row = msg['content']['data']['row']
            col = msg['content']['data']['col']
            max_native_zoom = 12
            scale = 2**(max_native_zoom - zoom)
            scaled_tile_size = 512*scale
            tile_factory = get_image_tile_factory(dataset)
            if tile_factory is not None:
                comm.send({
                    'type': "IMAGE_TILE_RESPONSE",
                    'img': base64.b64encode(tile_factory.create_encoded_tile([
                    int(col)*scaled_tile_size, 
                    int(row)*scaled_tile_size, 
                    scaled_tile_size, 
                    scaled_tile_size], [512, 512])).decode('utf-8')
                })
        elif type == 'OVERLAY_TILE_REQUEST':
            image_name = msg['content']['data']['imageName']
            overlay_name = msg['content']['data']['overlayName']
            zoom = msg['content']['data']['zoom']
            row = msg['content']['data']['row']
            col = msg['content']['data']['col']
            tile_factory = get_overlay_tile_factory(image_name, overlay_name)
            if tile_factory is not None:
                comm.send({
                    'type': "OVERLAY_TILE_RESPONSE",
                    'features': tile_factory.find_intersects(shapely.box(int(col)*512, int(row)*512, (int(col)+1)*512, (int(row)+1)*512))
                })
    return _recv    

osml_comm = None
def osml_comm_target_func(comm, msg):
    # comm is the kernel Comm instance
    # msg is the comm_open message

    osml_comm = comm
    
    # Register handler for later messages
    comm.on_msg(create_recv(comm))

    # Send data to the frontend
    comm.send({'type': "KERNEL_COMM_SETUP_COMPLETE"})

get_ipython().kernel.comm_manager.register_target('osml_comm_target', osml_comm_target_func)

"osml-jupyter-extension:JupyterImageLayer:KERNEL_SETUP_COMPLETE"
