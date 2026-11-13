import type { Island, Point, Tree } from "./types"
import * as shader from "./shaders"

const STRIDE = 11
const TREE_LAYERS = 36 // Four palettes × three silhouettes × three variants.
type Color = [number, number, number]
type Program = { id: WebGLProgram; uniform: (name: string) => WebGLUniformLocation | null }

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
    function stage(type: number, source: string) {
        const object = gl.createShader(type)!
        gl.shaderSource(object, source)
        gl.compileShader(object)
        if (gl.getShaderParameter(object, gl.COMPILE_STATUS)) return object
        const message = gl.getShaderInfoLog(object)
        gl.deleteShader(object)
        throw new Error(message || "Could not compile the river shader.")
    }
    const vs = stage(gl.VERTEX_SHADER, vertex)
    const fs = stage(gl.FRAGMENT_SHADER, fragment)
    const id = gl.createProgram()!
    gl.attachShader(id, vs)
    gl.attachShader(id, fs)
    gl.linkProgram(id)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(id)
        gl.deleteProgram(id)
        throw new Error(message || "Could not link the river shader.")
    }
    const locations = new Map<string, WebGLUniformLocation | null>()
    return { id, uniform(name) {
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(id, name))
        return locations.get(name) ?? null
    } }
}

class Mesh {
    private buffer: WebGLBuffer
    private vao: WebGLVertexArrayObject
    private floats = new Float32Array(STRIDE * 4096)
    private size = 0
    constructor(private gl: WebGL2RenderingContext) {
        this.buffer = gl.createBuffer()!
        this.vao = gl.createVertexArray()!
        gl.bindVertexArray(this.vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        for (const [index, count, offset] of [[0, 3, 0], [1, 4, 3], [2, 4, 7]]) {
            gl.enableVertexAttribArray(index)
            gl.vertexAttribPointer(index, count, gl.FLOAT, false, STRIDE * 4, offset * 4)
        }
        gl.bindVertexArray(null)
    }
    clear() { this.size = 0 }
    point(p: Point, color: Color, a: number, u = 0, v = 0, layer = 0) {
        if (this.size + STRIDE > this.floats.length) {
            const larger = new Float32Array(this.floats.length * 2)
            larger.set(this.floats)
            this.floats = larger
        }
        const f = this.floats
        let i = this.size
        f[i++] = p.x; f[i++] = p.y; f[i++] = p.z
        f[i++] = color[0]; f[i++] = color[1]; f[i++] = color[2]; f[i++] = a
        f[i++] = u; f[i++] = v; f[i++] = layer; f[i++] = 0
        this.size = i
    }
    polygon(p: Point[], color: Color, alpha: number, material = 0) {
        for (let i = 2; i < p.length; i++) {
            this.point(p[0], color, alpha, material)
            this.point(p[i - 1], color, alpha, material)
            this.point(p[i], color, alpha, material)
        }
    }
    upload() {
        if (!this.size) return
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, this.floats.subarray(0, this.size), gl.STREAM_DRAW)
    }
    draw() {
        if (!this.size) return
        this.gl.bindVertexArray(this.vao)
        this.gl.drawArrays(this.gl.TRIANGLES, 0, this.size / STRIDE)
    }
    destroy() {
        this.gl.deleteBuffer(this.buffer)
        this.gl.deleteVertexArray(this.vao)
    }
}

export class RiverRenderer {
    private gl: WebGL2RenderingContext
    private solid: Mesh
    private foliage: Mesh
    private decals: Mesh
    private river: Mesh
    private scene: Program
    private waterShader: Program
    private background: Program
    private reflection: WebGLFramebuffer
    private reflectedColor: WebGLTexture
    private reflectedDepth: WebGLRenderbuffer
    private canopy: WebGLTexture
    private layers = new Map<HTMLCanvasElement, number>()
    private colors = new Map<string, Color>()
    private reflectionWidth = 0
    private reflectionHeight = 0
    private islandData = new Float32Array(12)
    private phases = new Float32Array(3)
    private static readonly white: Color = [1, 1, 1]

    constructor(private canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { alpha: false, antialias: true })
        if (!gl) throw new Error("This game requires WebGL 2.")
        this.gl = gl
        this.scene = compile(gl, shader.meshVertex, shader.meshFragment)
        this.waterShader = compile(gl, shader.meshVertex, shader.waterFragment)
        this.background = compile(gl, shader.backgroundVertex, shader.backgroundFragment)
        this.solid = new Mesh(gl)
        this.foliage = new Mesh(gl)
        this.decals = new Mesh(gl)
        this.river = new Mesh(gl)
        this.reflection = gl.createFramebuffer()!
        this.reflectedColor = gl.createTexture()!
        this.reflectedDepth = gl.createRenderbuffer()!
        this.canopy = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.canopy)
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 192, 320, TREE_LAYERS)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.reflectedColor)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.depthFunc(gl.LEQUAL)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    }
    private color(hex: string): Color {
        const cached = this.colors.get(hex)
        if (cached) return cached
        const c = Number.parseInt(hex.slice(1, 7), 16)
        const rgb: Color = [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
        if (this.colors.size < 1024) this.colors.set(hex, rgb)
        return rgb
    }
    begin() {
        this.solid.clear()
        this.foliage.clear()
        this.decals.clear()
        this.river.clear()
    }
    face(p: Point[], color: string, alpha: number, material: number) {
        this.solid.polygon(p, this.color(color), alpha, material)
    }
    decal(p: Point[], color: string, alpha: number) {
        if (alpha > 0) this.decals.polygon(p, this.color(color), alpha)
    }
    tree(sprite: HTMLCanvasElement, o: Tree, fade: number) {
        let layer = this.layers.get(sprite)
        if (layer === undefined) {
            layer = this.layers.size
            if (layer >= TREE_LAYERS) throw new Error("The canopy texture array is full.")
            const gl = this.gl
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.canopy)
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 192, 320, 1, gl.RGBA, gl.UNSIGNED_BYTE, sprite)
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
            this.layers.set(sprite, layer)
        }
        const x = o.size * .83, top = o.y + o.size * 2.6, rgb = RiverRenderer.white
        const a = { x: o.x-x, y: o.y, z: o.z }, b = { x: o.x+x, y: o.y, z: o.z }
        const c = { ...b, y: top }, d = { ...a, y: top }
        this.foliage.point(a,rgb,fade,0,1,layer); this.foliage.point(b,rgb,fade,1,1,layer); this.foliage.point(c,rgb,fade,1,0,layer)
        this.foliage.point(a,rgb,fade,0,1,layer); this.foliage.point(c,rgb,fade,1,0,layer); this.foliage.point(d,rgb,fade,0,0,layer)
    }
    water(z: number, zz: number, center: number, next: number, half: number, nextHalf: number) {
        const rgb = RiverRenderer.white
        const a = { x: center-half, y: 0, z }, b = { x: center+half, y: 0, z }
        const c = { x: next+nextHalf, y: 0, z: zz }, d = { x: next-nextHalf, y: 0, z: zz }
        this.river.point(a,rgb,1,half,center); this.river.point(b,rgb,1,half,center); this.river.point(c,rgb,1,nextHalf,next)
        this.river.point(a,rgb,1,half,center); this.river.point(c,rgb,1,nextHalf,next); this.river.point(d,rgb,1,nextHalf,next)
    }
    private resizeReflection() {
        const gl = this.gl
        const rw = Math.max(1, Math.round(this.canvas.width * .53))
        const rh = Math.max(1, Math.round(this.canvas.height * .53))
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflection)
        if (rw === this.reflectionWidth && rh === this.reflectionHeight) return
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.reflectedColor)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.reflectedColor, 0)
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.reflectedDepth)
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.reflectedDepth)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error("Could not allocate the water reflection.")
        this.reflectionWidth = rw
        this.reflectionHeight = rh
    }
    draw(eye: Point, w: number, h: number, focal: number, pitch: number, time: number, islands: Island[]) {
        const gl = this.gl
        const width = this.canvas.width, height = this.canvas.height
        const f = focal * 2, co = Math.cos(pitch), si = Math.sin(pitch)
        const use = (program: Program, mirror = 1) => {
            gl.useProgram(program.id)
            gl.uniform3f(program.uniform("eye"),eye.x,eye.y,eye.z)
            gl.uniform4f(program.uniform("lens"),f/w,f/h,co,si)
            gl.uniform1f(program.uniform("mirror"),mirror)
        }
        const landscape = (mirror: number) => {
            use(this.scene, mirror)
            gl.uniform1i(this.scene.uniform("canopy"),0)
            gl.uniform1i(this.scene.uniform("mode"),0)
            this.solid.draw()
            gl.uniform1i(this.scene.uniform("mode"),1)
            this.foliage.draw()
        }

        for (const mesh of [this.solid,this.foliage,this.river,this.decals]) mesh.upload()
        this.resizeReflection()
        gl.viewport(0,0,this.reflectionWidth,this.reflectionHeight)
        gl.clearColor(0,0,0,0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.enable(gl.DEPTH_TEST)
        landscape(-1)

        gl.bindFramebuffer(gl.FRAMEBUFFER,null)
        gl.viewport(0,0,width,height)
        gl.clear(gl.DEPTH_BUFFER_BIT)
        gl.disable(gl.DEPTH_TEST)
        gl.bindVertexArray(null)
        use(this.background)
        gl.drawArrays(gl.TRIANGLES,0,3)

        gl.enable(gl.DEPTH_TEST)
        use(this.waterShader)
        gl.uniform1i(this.waterShader.uniform("reflection"),1)
        gl.uniform1f(this.waterShader.uniform("time"),time)
        gl.uniform2f(this.waterShader.uniform("resolution"),width,height)
        const n = Math.min(islands.length,3)
        for (let i=0; i<n; i++) {
            const o=islands[i], j=i*4
            this.islandData[j]=o.x; this.islandData[j+1]=o.z
            this.islandData[j+2]=o.rx; this.islandData[j+3]=o.rz
            this.phases[i]=o.phase
        }
        gl.uniform1i(this.waterShader.uniform("islandCount"),n)
        gl.uniform4fv(this.waterShader.uniform("islands[0]"),this.islandData)
        gl.uniform3fv(this.waterShader.uniform("phases"),this.phases)
        this.river.draw()

        landscape(1)
        gl.uniform1i(this.scene.uniform("mode"),2)
        gl.depthMask(false)
        gl.enable(gl.BLEND)
        this.decals.draw()
        gl.disable(gl.BLEND)
        gl.depthMask(true)
    }
    destroy() {
        const gl=this.gl
        for(const mesh of [this.solid,this.foliage,this.decals,this.river]) mesh.destroy()
        for(const program of [this.scene,this.background,this.waterShader]) gl.deleteProgram(program.id)
        gl.deleteFramebuffer(this.reflection)
        gl.deleteRenderbuffer(this.reflectedDepth)
        gl.deleteTexture(this.reflectedColor)
        gl.deleteTexture(this.canopy)
        this.layers.clear()
    }
}
