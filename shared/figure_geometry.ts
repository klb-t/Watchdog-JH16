/** Orthographic camera for normalized coordinates; raw observations stay untouched. */
export function project3d(x: number, y: number, z: number, camera: { yaw: number; pitch: number; zoom: number }) {
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
  const rx = x * Math.cos(yaw) - z * Math.sin(yaw), rz = x * Math.sin(yaw) + z * Math.cos(yaw);
  return [rx * camera.zoom, (y * Math.cos(pitch) - rz * Math.sin(pitch)) * camera.zoom, y * Math.sin(pitch) + rz * Math.cos(pitch)];
}
/** Deterministic SVG wrapping, including long URLs/hashes, without browser font measurement. */
export function wrapFigureText(text: string, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = ''; }
    while (word.length > width) { lines.push(word.slice(0, width)); word = word.slice(width); }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}
