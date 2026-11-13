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

const cargoStations = [-1.53,-1.25,-.95].map(z =>
    [-1,1].map(side => {
        const x = side*profile(z).width*.73
        return point(x,deckHeight(z,x),z)
    })
)
const cargoMounts = cargoStations.flat().flatMap(anchor =>
    oval(anchor,point(.030,.023,.039),8,14)
)
const cargoCords = cargoStations.slice(1).flatMap((station,i) =>
    station.flatMap((end,side) => {
        const start = cargoStations[i][1-side]
        return tubeSurface(u => {
            const p = interpolate(start,end,u)
            const lift = .020*Math.sin(Math.PI*u)
            return point(p.x,Math.max(p.y,deckHeight(p.z,p.x))+.015+lift,p.z)
        }, () => .012,14,8)
    })
)

const vest = oval(point(0,.424,-.36),point(.151,.217,.106),18,32)
const shirt = oval(point(0,.546,-.359),point(.171,.102,.098),15,32)
const neck = oval(point(0,.638,-.322),point(.052,.085,.05),12,20)
const face = oval(point(0,.734,-.312),point(.092,.111,.094),20,32)
const capCrown = surface((u,v) => {
    const latitude = u*Math.PI/2
    const angle = v*2*Math.PI
    const ring = Math.sin(latitude)
    const front = Math.sin(angle)
    return point(
        .106*ring*Math.cos(angle),
        .776+(.092+.024*front)*Math.cos(latitude)**.72,
        -.312+.110*ring*front+.012*Math.cos(latitude),
    )
}, 16, 36, -1)
const capBill = surface((u,v) => {
    const latitude = Math.PI*u
    const angle = 2*Math.PI*v
    const ring = Math.sin(latitude)
    const z = -.172+.128*Math.cos(latitude)
    const width = .024+.098*(1-Math.max(0,(z+.172)/.128)**2)
    const x = width*ring*Math.cos(angle)
    return point(x,.777+.009*ring*Math.sin(angle)-1.35*x*x-.065*(z+.172),z)
}, 18, 34)
const capSeam = tubeSurface(u => {
    const angle = Math.PI*(.85+1.30*u)
    return point(.1065*Math.cos(angle),.783,-.312+.1105*Math.sin(angle))
}, u => .0027*Math.sin(Math.PI*u),22,6)
const capButton = oval(point(0,.869,-.30),point(.011,.005,.011),7,14)
const shirtColor = "#e8d3a7"
const armRows = 18
const armSides = 16
const cuffRow = 7
const hand = oval(point(0,0,0),point(.046,.048,.047),10,20)

// Blade coordinates are along the shaft, across the blade and through its thickness.
const blade = surface((u,v) => {
    const a = 2*Math.PI*v
    const shape = u < .5
        ? .018+.129*Math.sin(u*Math.PI)**1.48
        : .147*Math.cos((u-.5)*Math.PI)**.64
    const t = -.39+.673*u
    return point(t,shape*Math.cos(a),.021*Math.sin(Math.PI*u)**.5*Math.sin(a)+.017*Math.sin(u*2.5))
}, 30, 24, -1)
const gripFraction = .27
const gripX = 1.48*gripFraction
// Match the original: the shaft ends inside each grip, where it is hidden by the hand.
const shaftSections = [
    [-1.11,-gripX-.035],
    [-gripX+.035,gripX-.035],
    [gripX+.035,1.11],
].map(([start,end]) =>
    tubeSurface(u => point(C.lerp(start,end,u),0,0), () => .0205, 2, 18)
)

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
    draw(cargoMounts,"#514738")
    draw(cargoCords,"#302e27")

    const pp = C.paddle(trip)
    const effort = trip.stroke ? Math.sin(Math.PI*pp.u)**2 : 0
    const lean = (p: Point) => point(p.x-pp.side*.035*effort,p.y,p.z)
    draw(shirt,shirtColor,MATTE,lean)
    draw(vest,"#ab4e36",MATTE,lean)
    draw(neck,"#ba7b50",MATTE,lean)
    draw(face,"#c7895d",MATTE,lean)
    draw(capBill,"#294748",MATTE,lean)
    draw(capCrown,"#3e6665",MATTE,lean)
    draw(capSeam,"#2f5150",MATTE,lean)
    draw(capButton,"#294748",MATTE,lean)

    const left = pp.blade.x < pp.other.x ? pp.blade : pp.other
    const right = left === pp.blade ? pp.other : pp.blade
    const axis = unit(sub(right,left))
    const side = unit(cross(axis,point(0,1,0)))
    const upright = cross(side,axis)
    const shaftDirection = (p: Point) =>
        add(add(scale(axis,p.x),scale(upright,p.y)),scale(side,p.z))
    for (const section of shaftSections)
        draw(section,"#93663d",VARNISH,p => add(pp.center,shaftDirection(p)),shaftDirection)

    for (const [sign,end] of [[-1,left],[1,right]] as const) {
        const grip = interpolate(pp.center,end,gripFraction)
        // Shoulder and elbow control points from the original Framer paddler.
        const shoulder = lean(point(
            sign*.205*Math.cos(pp.yaw),
            .52,
            -.37-sign*.205*Math.sin(pp.yaw*1.8),
        ))
        const elbow = point(
            sign*(.25+.09*effort)*Math.cos(pp.yaw)+grip.x*.10,
            (shoulder.y+grip.y)*.5-.025-.10*(1-effort),
            -.25-sign*.22*Math.sin(pp.yaw)+(grip.z+.32)*.35,
        )
        const sleeveRoot = lean(point(sign*.125,.545,-.359))
        const arm = (u: number) => {
            const original = interpolate(interpolate(shoulder,elbow,u),interpolate(elbow,grip,u),u)
            // Tuck the shoulder end into the shirt while preserving the forearm curve.
            return add(original,scale(sub(sleeveRoot,shoulder),Math.max(0,1-u/.32)**2))
        }
        const armMesh = tubeSurface(arm, u => C.lerp(.061,.043,u), armRows, armSides)
        const cuffTriangle = cuffRow*armSides*2
        draw(armMesh.slice(0,cuffTriangle),shirtColor)
        draw(armMesh.slice(cuffTriangle),"#be8258")
        draw(hand,"#c7895d",MATTE,p => add(grip,shaftDirection(p)),shaftDirection)
        const bladeDirection = (p: Point) =>
            shaftDirection(point(p.x*sign,p.y,p.z*sign))
        draw(blade,"#e8be78",VARNISH,p => add(end,bladeDirection(p)),bladeDirection)
    }
}
