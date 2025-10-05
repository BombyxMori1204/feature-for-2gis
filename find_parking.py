import json
import requests
import re

# from "config.js" import DGIS_KEY
# API_KEY = "b7303a8b-1d9a-4a04-8a8c-16f6386977f6"
API_KEY = "7ae4c441-8a0a-42a4-b0a6-e88b9c23c6b5"


# Находит область которая достижима от (latitude;longitude) за ttf
# Возвращает мультиполигон
def find_area(latitiude, longitude, ttf):
    headers = {
        'Content-Type': 'application/json',
    }
    params = {
        'key': API_KEY,
    }
    json_data = {
        'start': {
            'lat': latitiude,
            'lon': longitude,
        },
        'durations': ttf,
        'reverse': False,
        'transport': 'walking',
    }
    response = requests.post('https://routing.api.2gis.com/isochrone/2.0.0',
                             params=params, headers=headers, json=json_data)

    return str(json.loads(response.text)["isochrones"])


# Достаем полигон из мультиполигона
def extract_polygon(multipolygon):
    pattern = r"MULTIPOLYGON\(\(\(.*?\)\)\)"
    match = re.search(pattern, multipolygon)

    if match:
        res = match.group(0)
        res = res[5:]
        res = res.replace("(((", "((")
        res = res.replace(")))", "))")
        return res
    else:
        return None


# Находит значения внутри полигона
# Возвращает список из координат
def find_points_inside_polygon(polygon):
    params = {
        'q': "Бесплатная парковка",
        'fields': "items.point",
        'polygon': polygon,
        'key': API_KEY,
    }
    response = requests.get(
        'https://catalog.api.2gis.com/3.0/items', params=params)

    data = (json.loads(response.text)["result"])
    coordinates = []
    for item in data["items"]:
        coordinates.append(
            {'lat': item['point']['lat'], 'lon': item['point']['lon']})

    return coordinates


# Соортерует координаты
# Возвращает отсортированный список координат
def rate_closest(lat, lon, places):
    places.insert(0, {'lat': lat, 'lon': lon})
    headers = {
        'Content-Type': 'application/json',
    }
    params = {
        'key': API_KEY,
        'version': '2.0',
    }

    targets = []
    for i in range(len(places)):
        targets.append(i + 1)

    json_data = {
        'points': places,
        'transport': 'walking',
        'sources': [
            0,
        ],
        'targets': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    }

    response = requests.post('https://routing.api.2gis.com/get_dist_matrix',
                             params=params, headers=headers, json=json_data)

    dists = []
    data = json.loads(response.text)["routes"]
    for item in data:
        dists.append({item['target_id']: item['distance']})

    dists = sorted(dists, key=lambda x: list(x.values())[0])

    merged = []
    for item in dists:
        merged.append(places[list(item.keys())[0]])

    return merged


def build_route(start_lat, start_lon, stop_lat, stop_lon, is_driving):
    headers = {
        "Content-Type": "application/json",
    }
    params = {
        "key": API_KEY,
    }
    json_data = {
        'points': [
            {
                'type': 'stop' if is_driving else 'walking',
                'lon': str(start_lon),
                'lat': str(start_lat),
            },
            {
                'type': 'stop' if is_driving else 'walking',
                'lon': str(stop_lon),
                'lat': str(stop_lat),
            }
        ],
        'locale': 'ru',
        'transport': 'driving' if is_driving else 'walking',
        'route_mode': 'fastest',
    }

    return requests.post("http://routing.api.2gis.com/routing/7.0.0/global",
                         params=params, headers=headers, json=json_data).text


point_a_lat = 55.798650
point_a_lon = 37.536884
point_b_lat = 55.768147
point_b_lon = 37.663913

multipolygon = find_area(point_b_lat, point_b_lon, [900])
polygon = extract_polygon(multipolygon)
coords = find_points_inside_polygon(polygon)
coords = rate_closest(point_b_lat, point_b_lon, coords)

print(build_route(point_a_lat, point_a_lon,
      coords[0]['lat'], coords[0]['lon'], True))
print(build_route(coords[0]['lat'], coords[0]
      ['lon'], point_b_lat, point_b_lon, False))
