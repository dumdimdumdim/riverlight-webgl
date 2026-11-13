import { KayakCore as C } from "./core"
import type { RiverRenderer } from "./renderer"
import { add, cross, interpolate, oval, point, scale, sub, surface, tubeSurface, unit } from "./surface"
import type { SmoothTriangle } from "./surface"
import type { Point, Trip } from "./types"

const MATTE = 2
const LACQUER = 3
const VARNISH = 6
const identity = (p: Point) => p

function profile(z: number) {
    const t = Math.max(-1, Math.min(1,z/1.97))
    const taper = Math.max(0,1-t*t)**.77
    return { width: .003+.352*taper, rim: .147+.155*taper, taper }
}
function opening(z: number) {
    return .222 * Math.sqrt(Math.max(0,1-((z+.17)/.55)**2))
}
function deckHeight(z: number, x: number) {
    const { width, rim, taper } = profile(z)
    return rim + .078*taper*(1-(x/width)**2)
}
const longitudinal = (u: number) => -1.97*Math.cos(Math.PI*u)
const shell = surface((u,v) => {
    const z = longitudinal(u)
    const { width, rim, taper } = profile(z)
    const angle = Math.PI*v
    return point(-Math.cos(angle)*width, rim-Math.sin(angle)*(.014+.37*taper), z)
}, 58, 17, -1)

function deck(side: number) {
    return surface((u,v) => {
        // Sample the cockpit on an angular scale to resolve both rounded ends.
        const z = u < .25 ? C.lerp(-1.97,-.72,1-Math.cos(u*2*Math.PI))
            : u > .75 ? C.lerp(.38,1.97,Math.sin((u-.75)*2*Math.PI))
            : -.17 - .55*Math.cos((u-.25)*2*Math.PI)
        const x = side*C.lerp(opening(z),profile(z).width,v)
        return point(x,deckHeight(z,x),z)
    }, 80, 8, side)
}
const leftDeck = deck(-1), rightDeck = deck(1)
const cockpitWall = surface((u,v) => {
    const a = u*2*Math.PI
    const z = -.17+.55*Math.cos(a), x = .222*Math.sin(a)
    return point(x*(1-v*.19), C.lerp(deckHeight(z,x),.085,v), z)
}, 48, 4)
function cockpitRim(u: number) {
    const a = 2*Math.PI*u, z = -.17+.553*Math.cos(a), x = .226*Math.sin(a)
    return point(x,deckHeight(z,x)+.006,z)
}
const rim = tubeSurface(cockpitRim, () => .019, 56, 9)
const seat = oval(point(0,.1,-.17),point(.19,.027,.45),10,24)
const deckLine = [-1,1].map(side => tubeSurface(u => {
    const z = C.lerp(-1.66,1.69,u), x = side*profile(z).width*.96
    return point(x,deckHeight(z,x)-.007,z)
}, u => .006*Math.sin(u*Math.PI)**.4,42,5))

const vest = oval(point(0,.401,-.36),point(.195,.218,.143),18,32)
const shirt = oval(point(0,.503,-.359),point(.203,.112,.127),15,32)
const neck = oval(point(0,.589,-.322),point(.071,.092,.07),12,20)
const face = oval(point(0,.704,-.312),point(.112,.13,.114),20,32)
const crown = oval(point(0,.801,-.326),point(.129,.077,.131),18,32)
const band = oval(point(0,.772,-.327),point(.132,.024,.134),9,32)
const brim = oval(point(0,.764,-.311),point(.187,.017,.175),12,42)
const straps = [-1,1].map(side => tubeSurface(u => {
    const { x,y,z } = point(side*(.097+.015*u),.356+.205*u,-.476)
    const backing = Math.sqrt(Math.max(0,1-(x/.195)**2-((y-.401)/.218)**2))
    return point(x,y,Math.min(z,-.36-.143*backing-.006))
}, () => .012,12,8))
const hand = oval(point(0,0,0),point(.046,.045,.05),10,20)

// Blade coordinates are along the shaft, across the blade and through its thickness.
const blade = surface((u,v) => {
    const a = 2*Math.PI*v
    const shape = u < .5
        ? .018+.129*Math.sin(u*Math.PI)**1.48
        : .147*Math.cos((u-.5)*Math.PI)**.64
    const t = -.39+.673*u
    return point(t,shape*Math.cos(a),.021*Math.sin(Math.PI*u)**.5*Math.sin(a)+.017*Math.sin(u*2.5))
}, 30, 24, -1)
const shaft = tubeSurface(u => point(C.lerp(-1.11,1.11,u),0,0), () => .0205, 2, 18)

export function drawKayak(gpu: RiverRenderer, trip: Trip) {
    const co = Math.cos(trip.heading), si = Math.sin(trip.heading)
    const rotate = (p: Point) => point(p.x*co+p.z*si,p.y,p.z*co-p.x*si)
    const world = (p: Point) => {
        const q = rotate(p)
        return point(q.x+trip.x,q.y,q.z+trip.z)
    }
    function draw(mesh: SmoothTriangle[], color: string, material = MATTE, pose = identity, orient = identity) {
        gpu.smooth(mesh,color,material,p => world(pose(p)),n => rotate(orient(n)))
    }
    draw(shell,"#d29439",LACQUER)
    draw(leftDeck,"#efba52",LACQUER)
    draw(rightDeck,"#efba52",LACQUER)
    draw(cockpitWall,"#3c3425")
    draw(seat,"#594636")
    draw(rim,"#704229",LACQUER)
    for (const line of deckLine) draw(line,"#f3d583",LACQUER)

    const pp = C.paddle(trip)
    const effort = trip.stroke ? Math.sin(Math.PI*pp.u)**2 : 0
    const lean = (p: Point) => point(p.x-pp.side*.035*effort,p.y,p.z)
    draw(shirt,"#e8d3a7",MATTE,lean)
    draw(vest,"#ab4e36",MATTE,lean)
    for (const strap of straps) draw(strap,"#743d2b",MATTE,lean)
    draw(neck,"#ba7b50",MATTE,lean)
    draw(face,"#c7895d",MATTE,lean)
    draw(brim,"#c39552",MATTE,lean)
    draw(crown,"#d6aa64",MATTE,lean)
    draw(band,"#886444",MATTE,lean)

    const left = pp.blade.x < pp.other.x ? pp.blade : pp.other
    const right = left === pp.blade ? pp.other : pp.blade
    const axis = unit(sub(right,left))
    const side = unit(cross(axis,point(0,1,0)))
    const upright = cross(side,axis)
    const shaftDirection = (p: Point) =>
        add(add(scale(axis,p.x),scale(upright,p.y)),scale(side,p.z))
    draw(shaft,"#93663d",VARNISH,p => add(pp.center,shaftDirection(p)),shaftDirection)

    for (const [sign,end] of [[-1,left],[1,right]] as const) {
        const grip = interpolate(pp.center,end,.27)
        const shoulder = lean(point(sign*.173*Math.cos(pp.yaw),.518,-.374-sign*.19*Math.sin(pp.yaw*1.8)))
        const elbow = point(
            sign*(.23+.092*effort)*Math.cos(pp.yaw)+grip.x*.10,
            (shoulder.y+grip.y)*.5-.125+.10*effort,
            -.25-sign*.22*Math.sin(pp.yaw)+(grip.z+.32)*.35,
        )
        const arm = (u: number) => interpolate(interpolate(shoulder,elbow,u),interpolate(elbow,grip,u),u)
        draw(tubeSurface(arm,u => C.lerp(.067,.034,u),13,15),"#be8258")
        draw(tubeSurface(u => arm(u*.29),u => .073-u*.009,5,15),"#e8d3a7")
        draw(hand,"#c7895d",MATTE,p => add(p,grip))
        const bladeDirection = (p: Point) =>
            shaftDirection(point(p.x*sign,p.y,p.z*sign))
        draw(blade,"#e8be78",VARNISH,p => add(end,bladeDirection(p)),bladeDirection)
    }
}
