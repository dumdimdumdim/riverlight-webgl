import { KayakCore } from "./core"
import { add, interpolate, point, surface, tubeSurface } from "./surface"
import type { SmoothTriangle } from "./surface"
import type { Point } from "./types"

type TreePart = { triangles: SmoothTriangle[]; tone: number; wood?: boolean }

export function buildTree(kind: number, variant: number, woodland: boolean): TreePart[] {
    const parts: TreePart[] = []
    const rand = (n: number) => KayakCore.rand(n + kind*451 + variant*137)
    const lean = point((rand(1)-.5)*.38, 0, (rand(2)-.5)*.32)
    const trunk = (t: number) => point(lean.x*t*t, 2.65*t, lean.z*t*t)
    const branch = (a: Point, b: Point, thickness: number) => parts.push({
        triangles: tubeSurface(u => interpolate(a,b,u), u => thickness*(1-.96*u), woodland ? 1 : 3, woodland ? 5 : 7),
        tone: .88 + rand(7)*.14,
        wood: true,
    })
    parts.push({
        triangles: tubeSurface(trunk, u => .073*(1-.96*u)**.74, woodland ? 3 : 7, woodland ? 5 : 8),
        tone: 1,
        wood: true,
    })

    if (kind === 0) {
        for (let i = 0; i < 6; i++) {
            const base = .55+i*.32+(rand(i+19)-.5)*.10
            const width = (.68-i*.088)*(.81+rand(12+i)*.36)
            const c = trunk(base/2.65)
            parts.push({
                triangles: surface((u,v) => {
                    const a = v*2*Math.PI
                    const wave = Math.sin(a*5+i)*.14+Math.cos(a*9+variant)*.089
                    const r = Math.sin(Math.PI*u)**.79 * (1.74-1.25*u)*width*(1+wave)
                    return add(c,point(Math.cos(a)*r, u*(.86-i*.032)+r*wave*1.4, Math.sin(a)*r*.9))
                }, woodland ? 4 : 7, woodland ? 8 : 15),
                tone: .82 + i*.036 + rand(i+30)*.08,
            })
        }
    } else {
        const clusters = woodland ? 5 : 9
        for (let i = 0; i < clusters; i++) {
            const u = i/(clusters-1), angle = i*2.399963+rand(22)*3
            const reach = Math.sin(Math.PI*(.17+u*.83))*(kind===1 ? .47 : .72)
                * (.70+rand(i+52)*.42)
            const y = 1.03 + u*(kind===1 ? 1.50 : 1.19)
            const c = add(trunk(y/2.65),point(Math.cos(angle)*reach,y-trunk(y/2.65).y,Math.sin(angle)*reach))
            const size = (.85+rand(i+61)*.28)*(1-.42*u)*(woodland ? 1.15 : 1)
            const rx = size*(kind===1 ? .47 : .59), ry = size*(kind===1 ? .67 : .54)
            if (!woodland && i < clusters-2) branch(trunk(Math.max(.25,(y-.49)/2.65)), c, .028*(1-u*.55))
            parts.push({
                triangles: surface((t,v) => {
                    const phi = Math.PI*t, a = 2*Math.PI*v
                    const lobes = 1+Math.sin(a*5+i+phi*4)*.095+Math.cos(a*7-phi*7+i)*.053
                    const planar = Math.sin(phi)*lobes
                    return add(c, point(Math.cos(a)*rx*planar, Math.cos(phi)*ry, Math.sin(a)*rx*planar*.95))
                }, woodland ? 4 : 7, woodland ? 8 : 13, -1),
                tone: .74 + rand(i+44)*.31 + u*.09,
            })
        }
    }
    return parts
}
