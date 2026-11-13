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
const hand = oval(point(0,0,0),point(.039,.043,.039),10,20)
const thumb = oval(point(0,0,0),point(.026,.022,.025),8,14)

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

export function paddlePose(trip: Trip) {
    const paddle = C.paddle(trip)
    // Ease the resting pose out before the blade touches water.
    const restBlend = 1-C.clamp(Math.min(paddle.u/.16,(1-paddle.u)/.16),0,1)
    const resting = restBlend*restBlend*(3-2*restBlend)
    const offset = point(0,.035*resting,.099*resting)
    return {
        ...paddle,
        center: add(paddle.center,offset),
        blade: add(paddle.blade,offset),
        other: add(paddle.other,offset),
    }
}

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

    const pp = paddlePose(trip)
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
    draw(shaft,"#93663d",VARNISH,p => add(pp.center,shaftDirection(p)),shaftDirection)

    for (const [sign,end] of [[-1,left],[1,right]] as const) {
        const grip = interpolate(pp.center,end,.25)
        const palm = add(grip,shaftDirection(point(0,-.013,-.014)))
        const wrist = add(grip,shaftDirection(point(0,-.029,-.043)))
        const shoulder = lean(point(sign*.093,.557,-.357))
        const elbowFromGrip = shaftDirection(point(-sign*.136,-.143+.033*effort,-.146))
        const elbow = add(grip,elbowFromGrip)
        const arm = (u: number) => interpolate(interpolate(shoulder,elbow,u),interpolate(elbow,wrist,u),u)
        // Sleeve and forearm share a surface, so the cuff stays closed on every stroke.
        const armMesh = tubeSurface(arm, u => {
            const cuff = cuffRow/armRows
            const falloff = Math.max(0,1-Math.abs(u-cuff)/.24)
            return C.lerp(.056,.026,u)+.009*falloff
        }, armRows, armSides)
        const cuffTriangle = cuffRow*armSides*2
        draw(armMesh.slice(0,cuffTriangle),shirtColor)
        draw(armMesh.slice(cuffTriangle),"#be8258")
        draw(hand,"#c7895d",MATTE,p => add(palm,shaftDirection(p)),shaftDirection)
        const thumbCenter = add(grip,shaftDirection(point(-sign*.018,.018,.012)))
        draw(thumb,"#c7895d",MATTE,p => add(thumbCenter,shaftDirection(p)),shaftDirection)
        const bladeDirection = (p: Point) =>
            shaftDirection(point(p.x*sign,p.y,p.z*sign))
        draw(blade,"#e8be78",VARNISH,p => add(end,bladeDirection(p)),bladeDirection)
    }
}
