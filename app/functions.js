// map-utils.js — функции и константы для работы с двумя CircleMarker и drag'ом

/* ==== Стили кружков ==== */
const ORIGIN_STYLE = {
  diameter: 18,
  color: "#30a46c",
  strokeWidth: 2,
  strokeColor: "#ffffff",
};

const DEST_STYLE = {
  diameter: 18,
  color: "#e54d2e",
  strokeWidth: 2,
  strokeColor: "#ffffff",
};

/* ==== Вспомогательные ==== */
function fmtCoords([lon, lat]) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
function getStyle(kind) {
  return kind === "origin" ? ORIGIN_STYLE : DEST_STYLE;
}
function destroyMarkerSafe(marker) {
  try { marker?.destroy?.(); } catch {}
}

/**
 * Создать новый CircleMarker.
 * @param {mapgl.Map} map
 * @param {[number, number]} coords [lon, lat]
 * @param {object} style CircleMarkerOptions subset
 * @returns {mapgl.CircleMarker}
 */
function createCircleMarker(map, coords, style) {
  return new mapgl.CircleMarker(map, {
    coordinates: coords,
    ...style,
  });
}

/**
 * Сделать маркер перетаскиваемым.
 * При перемещении:
 *  - обновляем координаты самого кружка;
 *  - обновляем state.{kind}.coords;
 *  - обновляем текст в соответствующем input.
 *
 * @param {"origin"|"dest"} kind
 * @param {{ marker: any, coords: [number, number] | null }} entry
 * @param {{ origin: any, dest: any }} state
 * @param {mapgl.Map} map
 * @param {{ originInput: HTMLInputElement, destInput: HTMLInputElement }} inputs
 */
function makeDraggable(kind, entry, state, map, inputs) {
  if (!entry?.marker) return;

  const onMouseDown = (ev) => {
    ev?.originalEvent?.preventDefault?.();
    ev?.originalEvent?.stopPropagation?.();


    let isDragging = true;

    // временно отключаем перетаскивание карты
    try { map.setOption && map.setOption('disableDragging', true); } catch {}

    const onMove = (e) => {
      const buttons = e?.originalEvent?.buttons ?? 0;
      const leftPressed = (buttons & 1) === 1;
      if (!isDragging || !leftPressed) return;

      const coords = e.lngLat; // [lon, lat]

      // Попробуем «живое» перемещение, иначе — пересоздаём кружок.
      if (typeof entry.marker.setCoordinates === "function") {
        entry.marker.setCoordinates(coords);
      } else {
        // Пересоздание на новых координатах
        destroyMarkerSafe(entry.marker);
        entry.marker = createCircleMarker(map, coords, getStyle(kind));
        // перевешиваем mousedown для будущих перетаскиваний
        entry.marker.on("mousedown", onMouseDown);
        entry.marker.on?.("touchstart", onTouchStart);
      }

      // Обновим состояние и инпут
      entry.coords = coords;

      if (kind === "origin") {
        inputs.originInput.value = fmtCoords(coords);
        state.origin.coords = coords;
      } else {
        inputs.destInput.value = fmtCoords(coords);
        state.dest.coords = coords;
      }
    };

    const onUp = () => {
      if (!isDragging) return;
      isDragging = false;
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mouseleave", onUp);
      try { map.setOption && map.setOption('disableDragging', false); } catch {}
    };

    // На время drag слушаем карту
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mouseleave", onUp);
    // если хотите — можно отключать drag карты, если API вашей версии это поддерживает
    // try { map.setOption && map.setOption('disableDragging', true); } catch {}
  };

  const onTouchStart = (ev) => {
    ev?.originalEvent?.preventDefault?.();
    onMouseDown(ev); // переиспользуем чуть выше
  };

  entry.marker.on("mousedown", onMouseDown);
  entry.marker.on?.("touchstart", onTouchStart);
}

/**
 * Поставить/заменить точку (origin|dest):
 *  - удалить старый кружок этого типа;
 *  - создать новый;
 *  - сохранить в state;
 *  - обновить соответствующее поле ввода;
 *  - сделать маркер перетаскиваемым.
 *
 * @param {"origin"|"dest"} kind
 * @param {[number, number]} coords [lon, lat]
 * @param {{ origin: {marker:any,coords:[number,number]|null}, dest: {marker:any,coords:[number,number]|null} }} state
 * @param {mapgl.Map} map
 * @param {{ originInput: HTMLInputElement, destInput: HTMLInputElement }} inputs
 */
export function setPoint(kind, coords, state, map, inputs) {
  const entry = kind === "origin" ? state.origin : state.dest;

  // удалить предыдущий маркер этого вида
  destroyMarkerSafe(entry.marker);
  entry.marker = null;

  // создать новый кружок
  entry.marker = createCircleMarker(map, coords, getStyle(kind));
  entry.coords = coords;

  // обновить поле
  if (kind === "origin") {
    inputs.originInput.value = fmtCoords(coords);
  } else {
    inputs.destInput.value = fmtCoords(coords);
  }

  // сделать перетаскиваемым
  makeDraggable(kind, entry, state, map, inputs);
}

/**
 * Очистить обе точки и инпуты.
 */
export function clearAllPoints(state, inputs) {
  destroyMarkerSafe(state.origin.marker);
  destroyMarkerSafe(state.dest.marker);
  state.origin.marker = null;
  state.dest.marker = null;
  state.origin.coords = null;
  state.dest.coords = null;
  inputs.originInput.value = "";
  inputs.destInput.value = "";
}

// (экспортируем стили и хелперы, если пригодятся дальше)
export { ORIGIN_STYLE, DEST_STYLE, fmtCoords };
