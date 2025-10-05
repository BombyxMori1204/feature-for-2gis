const ORIGIN_STYLE = {
  diameter: 18,            // см. CircleMarkerOptions
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

function fmt([lon, lat]) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function setPoint(kind, coords) {
  const bucket = kind === "origin" ? origin : dest;
  // удаляем предыдущий круг этого типа
  try { bucket.marker?.destroy(); } catch {}
  bucket.marker = null;

  // создаём новый круг
  const style = kind === "origin" ? ORIGIN_STYLE : DEST_STYLE;
  bucket.marker = new mapgl.CircleMarker(map, {
    coordinates: coords,   // [lon, lat]
    ...style,
  });
  bucket.coords = coords;

  // заполняем поле
  (kind === "origin" ? originInput : destInput).value = fmt(coords);
}
