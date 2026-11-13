export type Point = { x: number; y: number; z: number }
export type Projected = { x: number; y: number; d: number }
export type Island = {
    i: number
    z: number
    x: number
    rx: number
    rz: number
    phase: number
}
export type Deer = {
    id: number
    side: number
    x: number
    z: number
    heading: number
    state: "idle" | "alert" | "fleeing" | "escaped"
    age: number
    phase: number
    siteZ: number
    alertClock: number
    fleeClock: number
    alertRange: number
    fleeRange: number
    alertDelay: number
    fleeDelay: number
}
export type Habitat = {
    key: string
    x: number
    y: number
    z: number
    seed: number
    kind: "reeds" | "tree"
    side?: number
    length?: number
    width?: number
    islandI?: number
    angleCentre?: number
}
export type RiverBird = {
    key: string
    homeZ: number
    x: number
    y: number
    z: number
    large: boolean
    flying: boolean
    escaped: boolean
    age: number
    heading: number
    targetHeading?: number
    vx: number
    vz: number
    seed: number
    delay: number
}
type Stroke = { side: number; age: number; pushed: boolean }
export type Wake = {
    x: number
    z: number
    heading: number
    age: number
    effort: number
}
type Ripple = { x: number; z: number; age: number; side: number }
export type Trip = {
    x: number
    z: number
    heading: number
    speed: number
    angular: number
    time: number
    stroke: Stroke | null
    queue: number[]
    ripples: Ripple[]
    wake: Wake[]
    wakeClock: number
    lastSide: number
    lastTime: number
    course: number
    desired: number
    contacts: number
}
export type Tree = {
    x: number
    y: number
    z: number
    size: number
    seed: number
    color: string
}
export type Transform = ((point: Point) => Point) | null
