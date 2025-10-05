// parking_api.js
import { DGIS_KEY } from "./config.js";

/**
 * Основная функция для поиска парковки и построения маршрута
 */
export async function parkingRoute(origin, destination, walkTime = 900) {
    try {
        console.log('Starting parking route search...', { origin, destination });

        // 1. Находим область вокруг точки назначения
        console.log('Step 1: Finding walkable area...');
        const multipolygon = await findArea(destination.lat, destination.lon, walkTime);

        if (!multipolygon) {
            return { ok: false, error: "polygon_not_found" };
        }

        // 2. Извлекаем полигон из мультиполигона
        console.log('Step 2: Extracting polygon...');
        const polygon = extractPolygon(multipolygon);

        if (!polygon) {
            return { ok: false, error: "polygon_extraction_failed" };
        }

        // 3. Ищем парковки внутри полигона
        console.log('Step 3: Finding parking spots...');
        const parkingSpots = await findPointsInsidePolygon(polygon);

        if (!parkingSpots || parkingSpots.length === 0) {
            return { ok: false, error: "no_parking_found" };
        }

        // 4. Сортируем парковки по близости к точке назначения
        console.log('Step 4: Sorting parking spots...');
        const sortedParkings = await rateClosest(destination.lat, destination.lon, parkingSpots);

        if (sortedParkings.length === 0) {
            return { ok: false, error: "no_rated_parking" };
        }

        // 5. Строим маршруты по дорогам
        console.log('Step 5: Building routes with roads...');
        const bestParking = sortedParkings[0];

        // Маршрут на автомобиле от origin до парковки
        const drivingRoute = await buildRoute(origin.lon, origin.lat, bestParking.lon, bestParking.lat, 'car');
        // Маршрут пешком от парковки до destination
        const walkingRoute = await buildRoute(bestParking.lon, bestParking.lat, destination.lon, destination.lat, 'pedestrian');

        return {
            ok: true,
            parking: {
                lat: bestParking.lat,
                lon: bestParking.lon
            },
            drivingRoute: drivingRoute,
            walkingRoute: walkingRoute,
            message: "Маршрут с парковкой построен успешно"
        };

    } catch (error) {
        console.error('Error in parkingRoute:', error);
        return {
            ok: false,
            error: error.message || "unknown_error"
        };
    }
}

/**
 * Строит маршрут по дорогам между двумя точками - ИСПРАВЛЕННАЯ ВЕРСИЯ
 */
async function buildRoute(startLon, startLat, stopLon, stopLat, mode = 'car') {
    const headers = {
        "Content-Type": "application/json",
    };

    const url = `https://routing.api.2gis.com/routing/7.0.0/global?key=${DGIS_KEY}`;

    const jsonData = {
        'points': [
            {
                'lon': startLon,
                'lat': startLat,
            },
            {
                'lon': stopLon,
                'lat': stopLat,
            }
        ],
        'transport': mode === 'car' ? 'car' : 'pedestrian',
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(jsonData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log(`Routing API response (${mode}):`, data);

        // Извлекаем геометрию из WKT формата
        const routeInfo = extractRouteGeometryFromWKT(data);

        if (!routeInfo.coordinates || routeInfo.coordinates.length === 0) {
            console.warn('No route geometry found, using straight line');
            // Fallback - возвращаем прямую линию
            return {
                coordinates: [[startLon, startLat], [stopLon, stopLat]],
                distance: calculateDistance(startLat, startLon, stopLat, stopLon),
                duration: calculateDuration(startLat, startLon, stopLat, stopLon, mode),
                mode: mode,
                isFallback: true
            };
        }

        console.log(`Extracted ${routeInfo.coordinates.length} points for ${mode} route`);

        return {
            coordinates: routeInfo.coordinates,
            distance: routeInfo.distance || calculateDistance(startLat, startLon, stopLat, stopLon),
            duration: routeInfo.duration || calculateDuration(startLat, startLon, stopLat, stopLon, mode),
            mode: mode,
            isFallback: false
        };

    } catch (error) {
        console.error('Error in buildRoute:', error);
        throw error;
    }
}

/**
 * Извлекает геометрию маршрута из WKT формата - НОВАЯ ФУНКЦИЯ
 */
function extractRouteGeometryFromWKT(apiResponse) {
    if (!apiResponse || !apiResponse.result || !Array.isArray(apiResponse.result)) {
        return { coordinates: [], distance: 0, duration: 0 };
    }

    console.log('Extracting geometry from WKT format...');

    const allCoordinates = [];
    let totalDistance = 0;
    let totalDuration = 0;

    // Берем первый маршрут из результата
    const route = apiResponse.result[0];

    if (route.total_distance) totalDistance = route.total_distance;
    if (route.total_duration) totalDuration = route.total_duration;

    // Собираем все сегменты геометрии из maneuvers
    if (route.maneuvers && Array.isArray(route.maneuvers)) {
        for (const maneuver of route.maneuvers) {
            if (maneuver.outcoming_path && maneuver.outcoming_path.geometry) {
                for (const geometrySegment of maneuver.outcoming_path.geometry) {
                    if (geometrySegment.selection) {
                        const segmentCoords = parseWKTLineString(geometrySegment.selection);
                        allCoordinates.push(...segmentCoords);
                    }
                }
            }
        }
    }

    // Убираем дубликаты и сохраняем порядок
    const uniqueCoordinates = [];
    const seen = new Set();

    for (const coord of allCoordinates) {
        const key = `${coord[0]},${coord[1]}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueCoordinates.push(coord);
        }
    }

    console.log(`Parsed ${uniqueCoordinates.length} unique coordinates from WKT`);

    return {
        coordinates: uniqueCoordinates,
        distance: totalDistance,
        duration: totalDuration
    };
}

/**
 * Парсит WKT LineString в массив координат [lon, lat]
 */
function parseWKTLineString(wktString) {
    if (!wktString || !wktString.startsWith('LINESTRING(')) {
        return [];
    }

    try {
        // Извлекаем координаты из LINESTRING(lon lat, lon lat, ...)
        const coordsString = wktString.replace('LINESTRING(', '').replace(')', '');
        const coordPairs = coordsString.split(',');

        const coordinates = [];
        for (const pair of coordPairs) {
            const [lon, lat] = pair.trim().split(' ').map(Number);
            if (!isNaN(lon) && !isNaN(lat)) {
                coordinates.push([lon, lat]);
            }
        }

        return coordinates;
    } catch (error) {
        console.error('Error parsing WKT:', error);
        return [];
    }
}

/**
 * Вычисляет примерное расстояние между точками (в метрах)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // радиус Земли в метрах
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Вычисляет примерное время маршрута (в секундах)
 */
function calculateDuration(lat1, lon1, lat2, lon2, mode) {
    const distance = calculateDistance(lat1, lon1, lat2, lon2);
    const speed = mode === 'car' ? 50 / 3.6 : 5 / 3.6; // 50 км/ч для авто, 5 км/ч для пешехода
    return distance / speed;
}

// Остальные функции (findArea, extractPolygon, findPointsInsidePolygon, rateClosest)
// остаются без изменений из предыдущего рабочего кода

/**
 * Находит область которая достижима от точки за указанное время
 */
async function findArea(latitude, longitude, ttf) {
    const headers = {
        'Content-Type': 'application/json',
    };

    const url = `https://routing.api.2gis.com/isochrone/2.0.0?key=${DGIS_KEY}`;

    const jsonData = {
        'start': {
            'lat': latitude,
            'lon': longitude,
        },
        'durations': [ttf],
        'reverse': false,
        'transport': 'walking',
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(jsonData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Isochrone error response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return JSON.stringify(data.isochrones);

    } catch (error) {
        console.error('Error in findArea:', error);
        throw error;
    }
}

/**
 * Достаем полигон из мультиполигона
 */
function extractPolygon(multipolygon) {
    if (!multipolygon || typeof multipolygon !== 'string') {
        return null;
    }

    const pattern = /MULTIPOLYGON\(\(\(.*?\)\)\)/;
    const match = multipolygon.match(pattern);

    if (match) {
        let result = match[0];
        result = result.slice(5);
        result = result.replace("(((", "((");
        result = result.replace(")))", "))");
        return result;
    }
    return null;
}

/**
 * Находит парковки внутри полигона
 */
async function findPointsInsidePolygon(polygon) {
    if (!polygon) {
        throw new Error('Polygon is required');
    }

    const params = new URLSearchParams({
        'q': "Бесплатная парковка",
        'fields': "items.point",
        'polygon': polygon,
        'key': DGIS_KEY,
    });

    try {
        const response = await fetch(`https://catalog.api.2gis.com/3.0/items?${params}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const coordinates = [];

        if (data.result && data.result.items) {
            for (const item of data.result.items) {
                coordinates.push({
                    lat: item.point.lat,
                    lon: item.point.lon
                });
            }
        }

        return coordinates;
    } catch (error) {
        console.error('Error in findPointsInsidePolygon:', error);
        throw error;
    }
}

/**
 * Сортирует координаты по близости
 */
async function rateClosest(lat, lon, places) {
    if (!places || places.length === 0) {
        return [];
    }

    const limitedPlaces = places.slice(0, 10);
    const points = [{ lat: lat, lon: lon }];
    limitedPlaces.forEach(place => points.push(place));

    const headers = {
        'Content-Type': 'application/json',
    };

    const url = `https://routing.api.2gis.com/get_dist_matrix?key=${DGIS_KEY}&version=2.0`;

    const targets = [];
    for (let i = 1; i <= limitedPlaces.length; i++) {
        targets.push(i);
    }

    const jsonData = {
        'points': points,
        'transport': 'walking',
        'sources': [0],
        'targets': targets,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(jsonData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const dists = [];

        if (data.routes) {
            for (const route of data.routes) {
                dists.push({
                    [route.target_id]: route.distance
                });
            }
        }

        dists.sort((a, b) => {
            const aVal = Object.values(a)[0];
            const bVal = Object.values(b)[0];
            return aVal - bVal;
        });

        const merged = [];
        for (const dist of dists) {
            const targetId = Object.keys(dist)[0];
            merged.push(limitedPlaces[parseInt(targetId) - 1]);
        }

        return merged;
    } catch (error) {
        console.error('Error in rateClosest:', error);
        return limitedPlaces;
    }
}
