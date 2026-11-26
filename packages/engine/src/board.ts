// Board geometry: pointy-top hexes in axial coordinates (q, r).
// Vertices (intersections) and edges (paths) are derived from hex corners.

export type Terrain = 'woodland' | 'claypits' | 'meadow' | 'farmland' | 'highlands' | 'wastes';
export type Resource = 'timber' | 'clay' | 'fleece' | 'grain' | 'stone';
export const RESOURCES: Resource[] = ['timber', 'clay', 'fleece', 'grain', 'stone'];

export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  woodland: 'timber',
  claypits: 'clay',
  meadow: 'fleece',
  farmland: 'grain',
  highlands: 'stone',
  wastes: null,
};

export type PortKind = 'any' | Resource; // 'any' = 3:1, resource = 2:1

export interface HexGeo { id: number; q: number; r: number; x: number; y: number; vertices: number[]; edges: number[]; neighbors: number[] }
export interface VertexGeo { id: number; x: number; y: number; hexes: number[]; vertices: number[]; edges: number[] }
export interface EdgeGeo { id: number; a: number; b: number; hexes: number[] }
export interface PortGeo { kind: PortKind; edge: number; vertices: [number, number]; x: number; y: number; angle: number }

export interface Geometry {
  hexes: HexGeo[];
  vertices: VertexGeo[];
  edges: EdgeGeo[];
  coastalEdges: number[]; // ordered around the coast
}

const SQRT3 = Math.sqrt(3);

export function hexCenter(q: number, r: number) {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/** Axial coords for the 19-hex (3-4 player) island: rows 3-4-5-4-3. */
export function standardCoords(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++) out.push([q, r]);
  }
  return out;
}

/** Axial coords for the 30-hex (5-6 player) island: rows 3-4-5-6-5-4-3. */
export function largeCoords(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = -3; r <= 3; r++) {
    const qMin = r < 0 ? -3 - r : -3;
    const qMax = r > 0 ? 2 - r : 2;
    for (let q = qMin; q <= qMax; q++) out.push([q, r]);
  }
  return out;
}

export function buildGeometry(coords: [number, number][]): Geometry {
  const vertexKey = new Map<string, number>();
  const vertices: VertexGeo[] = [];
  const edgeKey = new Map<string, number>();
  const edges: EdgeGeo[] = [];
  const hexes: HexGeo[] = [];

  const getVertex = (x: number, y: number) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    let id = vertexKey.get(k);
    if (id === undefined) {
      id = vertices.length;
      vertexKey.set(k, id);
      vertices.push({ id, x, y, hexes: [], vertices: [], edges: [] });
    }
    return id;
  };
  const getEdge = (a: number, b: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const k = `${lo}-${hi}`;
    let id = edgeKey.get(k);
    if (id === undefined) {
      id = edges.length;
      edgeKey.set(k, id);
      edges.push({ id, a: lo, b: hi, hexes: [] });
      vertices[lo].edges.push(id);
      vertices[hi].edges.push(id);
      vertices[lo].vertices.push(hi);
      vertices[hi].vertices.push(lo);
    }
    return id;
  };

  coords.forEach(([q, r], id) => {
    const c = hexCenter(q, r);
    const vs: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 90); // pointy top: first corner straight up
      vs.push(getVertex(c.x + Math.cos(ang), c.y + Math.sin(ang)));
    }
    const es: number[] = [];
    for (let i = 0; i < 6; i++) es.push(getEdge(vs[i], vs[(i + 1) % 6]));
    vs.forEach((v) => vertices[v].hexes.push(id));
    es.forEach((e) => edges[e].hexes.push(id));
    hexes.push({ id, q, r, x: c.x, y: c.y, vertices: vs, edges: es, neighbors: [] });
  });

  const byCoord = new Map(hexes.map((h) => [`${h.q},${h.r}`, h.id]));
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const h of hexes) {
    for (const [dq, dr] of dirs) {
      const n = byCoord.get(`${h.q + dq},${h.r + dr}`);
      if (n !== undefined) h.neighbors.push(n);
    }
  }

  const coastal = edges.filter((e) => e.hexes.length === 1);
  const angleOf = (e: EdgeGeo) => {
    const mx = (vertices[e.a].x + vertices[e.b].x) / 2;
    const my = (vertices[e.a].y + vertices[e.b].y) / 2;
    return Math.atan2(my, mx);
  };
  const coastalEdges = coastal.sort((a, b) => angleOf(a) - angleOf(b)).map((e) => e.id);
  return { hexes, vertices, edges, coastalEdges };
}

/** Evenly spaced coastal edges for ports. */
export function portEdges(geo: Geometry, count: number): number[] {
  const n = geo.coastalEdges.length;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(geo.coastalEdges[Math.floor((i * n) / count) % n]);
  return out;
}

export function portGeo(geo: Geometry, edge: number, kind: PortKind): PortGeo {
  const e = geo.edges[edge];
  const va = geo.vertices[e.a], vb = geo.vertices[e.b];
  const x = (va.x + vb.x) / 2, y = (va.y + vb.y) / 2;
  return { kind, edge, vertices: [e.a, e.b], x, y, angle: Math.atan2(y, x) };
}

/** Hex ids ordered in a spiral: outer ring counterclockwise from a corner, then inward. */
export function spiralOrder(geo: Geometry): number[] {
  const byCoord = new Map(geo.hexes.map((h) => [`${h.q},${h.r}`, h.id]));
  const maxRing = Math.max(...geo.hexes.map((h) => (Math.abs(h.q) + Math.abs(h.r) + Math.abs(-h.q - h.r)) / 2));
  const dirs = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];
  const order: number[] = [];
  for (let ring = maxRing; ring > 0; ring--) {
    let q = ring, r = 0; // start at a corner
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        const id = byCoord.get(`${q},${r}`);
        if (id !== undefined) order.push(id);
        q += dirs[side][0];
        r += dirs[side][1];
      }
    }
  }
  const center = byCoord.get('0,0');
  if (center !== undefined) order.push(center);
  // include any hexes not on a perfect ring (large board) at the end
  for (const h of geo.hexes) if (!order.includes(h.id)) order.push(h.id);
  return order;
}

export const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
