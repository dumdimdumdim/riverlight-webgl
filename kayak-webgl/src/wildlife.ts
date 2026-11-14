import { KayakCore as C } from "./core"
import type { Point, RiverBird, Tree } from "./types"

const climb = (distance: number, large: boolean) => distance*(large ? .52 : .66)

function passesTree(start: Point, heading: number, length: number, large: boolean, tree: Tree) {
    const dx = tree.x-start.x, dz = tree.z-start.z
    const sin = Math.sin(heading), cos = Math.cos(heading)
    const along = dx*sin+dz*cos
    const lateral = dx*cos-dz*sin
    const margin = large ? 1.15 : .42
    function intersects(radius: number, lower: number, upper: number) {
        if (Math.abs(lateral) >= radius) return false
        const span = Math.sqrt(radius*radius-lateral*lateral)
        const enter = Math.max(0,along-span)
        const exit = Math.min(length,along+span)
        return enter < exit && start.y+climb(enter,large) < upper && start.y+climb(exit,large)+1.25 > lower
    }
    return intersects(tree.size*.11+margin,tree.y,tree.y+tree.size*1.65) ||
        intersects(tree.size*1.15+margin,tree.y+tree.size*.45,tree.y+tree.size*2.95)
}

export function birdDeparture(bird: RiverBird, boat: Point, trees: Tree[]): RiverBird["departure"] {
    const downstream = C.clamp(Math.atan2(
        C.center(bird.z+15)-bird.x, 15
    ), -1.5, 1.5)
    // Prefer open water and avoid flying back toward the boat where possible.
    const spread = (C.rand(bird.seed+51)-.5)*.40
    const preferred = downstream+spread
    const candidates = [preferred, downstream, downstream-.34, downstream+.34,
        downstream-.68, downstream+.68, downstream-1.1, downstream+1.1,
        downstream-Math.PI*.75, downstream+Math.PI*.75]
    const length = bird.large ? 42 : 57
    let clearHeading: number | undefined
    for (const heading of candidates) {
        if (trees.some(tree => passesTree(bird,heading,length,bird.large,tree))) continue
        clearHeading ??= heading
        const boatAhead = (boat.x-bird.x)*Math.sin(heading)+(boat.z-bird.z)*Math.cos(heading)
        if (boatAhead < 4 || Math.hypot(boat.x-bird.x,boat.z-bird.z)>8) {
            return { heading, vertical: false }
        }
    }
    if (clearHeading !== undefined) return { heading: clearHeading, vertical: false }
    const wingMargin = bird.large ? 1.15 : .42
    if (trees.some(tree => bird.y < tree.y+tree.size*2.95 &&
        Math.hypot(tree.x-bird.x,tree.z-bird.z) < tree.size*1.15+wingMargin)) return
    return { heading: downstream, vertical: true }
}

export function advanceBird(bird: RiverBird, dt: number) {
    const route = bird.departure
    if (!route) return
    const previousAge = bird.age
    bird.age += dt
    const preparation = bird.large ? .65 : .35
    const distanceAt = (age: number) => {
        const time = Math.max(0,age-preparation)
        return (bird.large ? 4.8 : 6.5)*(time+Math.expm1(-2.2*time)/2.2)
    }
    const verticalDistance = route.vertical ? 16 : 0
    const distance = distanceAt(bird.age), previous = distanceAt(previousAge)
    const horizontal = Math.max(0,distance-verticalDistance)-Math.max(0,previous-verticalDistance)
    const vertical = distance-previous-horizontal
    bird.x += Math.sin(route.heading)*horizontal
    bird.z += Math.cos(route.heading)*horizontal
    bird.y += climb(horizontal,bird.large)+vertical*1.1
    bird.heading += C.angleDelta(route.heading,bird.heading)*(1-Math.exp(-dt*8))
}
