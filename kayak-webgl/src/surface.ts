import type { Point } from "./types"

export type SmoothVertex = { position: Point; normal: Point }
export type SmoothTriangle = [SmoothVertex, SmoothVertex, SmoothVertex]
export type Surface = (u: number, v: number) => Point

export const point = (x: number, y: number, z: number): Point => ({ x, y, z })
export const add = (a: Point, b: Point) => point(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Point, b: Point) => point(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Point, k: number) => point(a.x * k, a.y * k, a.z * k)
export const cross = (a: Point, b: Point) =>
    point(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const unit = (a: Point) => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1))
export const interpolate = (a: Point, b: Point, t: number) => add(a, scale(sub(b, a), t))
const TAU = Math.PI * 2

export function surface(sample: Surface, rows: number, columns: number, outward = 1): SmoothTriangle[] {
    const vertices: SmoothVertex[][] = []
    const e = .001
    for (let i = 0; i <= rows; i++) {
        const u = i / rows
        const row: SmoothVertex[] = []
        for (let j = 0; j <= columns; j++) {
            const v = j / columns
            const du = sub(sample(Math.min(1, u+e), v), sample(Math.max(0, u-e), v))
            // Sample away from the poles so collapsed rings still get stable normals.
            const uNormal = Math.min(1-e, Math.max(e, u))
            const dv = sub(sample(uNormal, Math.min(1, v+e)), sample(uNormal, Math.max(0, v-e)))
            row.push({ position: sample(u,v), normal: scale(unit(cross(du,dv)),outward) })
        }
        vertices.push(row)
    }
    const triangles: SmoothTriangle[] = []
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            const a = vertices[i][j], b = vertices[i+1][j]
            const c = vertices[i+1][j+1], d = vertices[i][j+1]
            triangles.push([a,b,c], [a,c,d])
        }
    }
    return triangles
}

export function oval(center: Point, radii: Point, rows: number, columns: number) {
    return surface((u,v) => {
        const latitude = u * Math.PI, angle = v * TAU
        return add(center, point(
            Math.sin(latitude) * Math.cos(angle) * radii.x,
            Math.cos(latitude) * radii.y,
            Math.sin(latitude) * Math.sin(angle) * radii.z,
        ))
    }, rows, columns, -1)
}

export function tubeSurface(center: (u: number) => Point, radius: (u: number) => number, rows: number, columns: number) {
    return surface((u,v) => {
        const axis = unit(sub(center(Math.min(1,u+.002)), center(Math.max(0,u-.002))))
        const across = unit(cross(axis, Math.abs(axis.y) > .96 ? point(1,0,0) : point(0,1,0)))
        const up = cross(across, axis), angle = v * TAU
        const radial = add(scale(across,Math.cos(angle)),scale(up,Math.sin(angle)))
        return add(center(u), scale(radial, radius(u)))
    }, rows, columns)
}
