// app.js — карта + UI, логика кликов/кнопок
import { DGIS_KEY } from "./config.js";
import {
  setPoint,
  clearAllPoints,
} from "./functions.js";
import { parkingRoute } from "./parking_api.js";

/**
 * Проверяем валидность API ключа
 */


/* ============= 1) Карта ============= */
const map = new mapgl.Map("container", {
  key: DGIS_KEY,
  center: [37.618423, 55.751244], // Москва — фолбэк
  zoom: 12,
});

/* ============= 2) UI ============= */
const originInput = document.getElementById("originInput");
const destInput   = document.getElementById("destInput");
const swapBtn     = document.getElementById("swapBtn");
const clearBtn    = document.getElementById("clearBtn");
const locateBtn   = document.getElementById("locateBtn");
const compassBtn  = document.getElementById("compassBtn");

const buildRouteBtn = document.getElementById("buildRouteBtn");
const routeInfo     = document.getElementById("routeInfo");


// Объект ссылок на инпуты — передаём в утилиты
const inputs = { originInput, destInput };

/* ============= 3) Состояние точек ============= */
const state = {
  origin: { marker: null, coords: null }, // coords: [lon, lat]
  dest:   { marker: null, coords: null },
};

// какое поле активно — туда ставим точку по клику
let activeField = originInput;
[originInput, destInput].forEach((el) =>
  el.addEventListener("focus", () => (activeField = el))
);

/* ============= 4) Клик по карте -> поставить точку ============= */
map.on("click", (ev) => {
  const [lon, lat] = ev.lngLat; // массив [lon, lat]
  const kind = activeField === destInput ? "dest" : "origin";
  setPoint(kind, [lon, lat], state, map, inputs);
  state.parkingCircle?.destroy();
  state.routeLine1?.destroy();
  state.routeLine2?.destroy();
});

/* ============= 5) Кнопки ============= */
// Поменять местами точки
swapBtn.addEventListener("click", () => {
  const o = state.origin.coords;
  const d = state.dest.coords;

  // Поменять значения в инпутах визуально
  const tmp = originInput.value;
  originInput.value = destInput.value;
  destInput.value = tmp;


  if (o && d) {
    setPoint("origin", d, state, map, inputs);
    setPoint("dest", o, state, map, inputs);
  } else if (o && !d) {
    setPoint("dest", o, state, map, inputs);
    // очистим origin
    if (state.origin.marker) { try { state.origin.marker.destroy(); } catch {} }
    state.origin.marker = null;
    state.origin.coords = null;
    originInput.value = "";
  } else if (!o && d) {
    setPoint("origin", d, state, map, inputs);
    // очистим dest
    if (state.dest.marker) { try { state.dest.marker.destroy(); } catch {} }
    state.dest.marker = null;
    state.dest.coords = null;
    destInput.value = "";
  }
});

// Очистить обе точки
clearBtn.addEventListener("click", () => {
  clearAllPoints(state, inputs);
  clearRouteElements(state); //!!!!!!!!!!!!!!!!!!!!!!
});

// Геолокация -> как "Отправление"
locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const coords = [pos.coords.longitude, pos.coords.latitude];
    map.setCenter(coords);
    map.setZoom(14);
    setPoint("origin", coords, state, map, inputs);
    originInput.focus();
  });
});

// Компас — выровнять «на север»
compassBtn.addEventListener("click", () => {
  try {
    map.setRotation(0, { animate: true });
    if (typeof map.setPitch === "function") map.setPitch(0, { animate: true });
  } catch {
    try { map.setRotation(0); } catch {}
    try { map.setPitch(0); } catch {}
  }
});

// В app.js обновите обработчик buildRouteBtn:
buildRouteBtn.addEventListener("click", async () => {
    const o = state.origin.coords;
    const d = state.dest.coords;
    if (!o || !d) {
        routeInfo.textContent = "Укажите обе точки (отправление и прибытие).";
        return;
    }

    routeInfo.textContent = "Ищем парковку и строим маршрут...";
    buildRouteBtn.disabled = true;

    try {
        const data = await parkingRoute(
            { lon: o[0], lat: o[1] },
            { lon: d[0], lat: d[1] },
            900
        );

        if (!data.ok) {
            routeInfo.textContent = `Ошибка: ${data.error || "не удалось найти парковку"}`;
            return;
        }

        // Очищаем предыдущие элементы
        clearRouteElements(state);

        // Отображаем парковку
        const p = [data.parking.lon, data.parking.lat];

        // Маркер парковки
        state.parkingCircle = new mapgl.CircleMarker(map, {
            coordinates: p,
            diameter: 20,
            color: "#3b82f6",
            strokeColor: "#ffffff",
            strokeWidth: 3,
        });

        // Отображаем маршруты
        let drivingCoords, walkingCoords;

        if (data.drivingRoute && data.drivingRoute.coordinates) {
            drivingCoords = data.drivingRoute.coordinates;
        } else {
            drivingCoords = [o, p]; // fallback
        }

        if (data.walkingRoute && data.walkingRoute.coordinates) {
            walkingCoords = data.walkingRoute.coordinates;
        } else {
            walkingCoords = [p, d]; // fallback
        }

        state.routeLine1 = new mapgl.Polyline(map, {
            coordinates: drivingCoords,
            color: "#0000ff",
            width: 6,
            opacity: 0.9
        });

        state.routeLine2 = new mapgl.Polyline(map, {
            coordinates: walkingCoords,
            color: "#22c55e",
            width: 4,
            opacity: 0.9
        });

        // Центрируем карту
        const allPoints = [o, p, d];
        if (typeof map.setBounds === "function") {
            map.setBounds(allPoints, {
                padding: { top: 50, bottom: 50, left: 350, right: 50 },
                animate: true
            });
        }

        // Показываем информацию
        let routeInfoText = "Маршрут построен. Парковка найдена.";
        if (data.drivingRoute && data.walkingRoute) {
            const driveTime = Math.round(data.drivingRoute.duration / 60);
            const walkTime = Math.round(data.walkingRoute.duration / 60);
            routeInfoText += ` Время: ${driveTime} мин. на авто + ${walkTime} мин. пешком`;
        }

        routeInfo.textContent = routeInfoText;

    } catch (e) {
        console.error(e);
        routeInfo.textContent = "Ошибка при построении маршрута";
    } finally {
        buildRouteBtn.disabled = false;
    }
});

// Добавьте тестирование структуры API
async function testRoutingStructure() {
    console.log('Testing Routing API structure...');
    const result = await testRoutingAPI();
    console.log('Routing API structure test:', result);
}

// Функция очистки
function clearRouteElements(state) {
    try { state.parkingCircle?.destroy?.(); } catch {}
    try { state.routeLine1?.destroy?.(); } catch {}
    try { state.routeLine2?.destroy?.(); } catch {}
    try { state.routeInfoLabel?.destroy?.(); } catch {}
}

// В конец app.js добавьте:
// Функция для тестирования API
async function testAPI() {
    console.log('Testing API endpoints...');
    const results = await testAllEndpoints();
    console.log('API Test Results:', results);

    // Показываем результаты в интерфейсе
    const errorEndpoints = results.filter(r => !r.ok || r.error);
    if (errorEndpoints.length > 0) {
        routeInfo.textContent = `Проблемы с API: ${errorEndpoints.map(e => e.endpoint).join(', ')}`;
    } else {
        routeInfo.textContent = 'Все API endpoints работают корректно';
    }
}

// Запускаем тест при загрузке
window.addEventListener('load', () => {
    setTimeout(testAPI, 1000); // Даем время на загрузку карты
});

// Делаем функцию глобальной для вызова из консоли
window.testRoutingStructure = testRoutingStructure;
window.testAllEndpoints = testAllEndpoints;
