// One projection for the scene, water and mirrored scene. +Z is downstream.
const camera = `
uniform vec3 eye;
uniform vec4 lens; // focal / width, focal / height, cos(pitch), sin(pitch)
uniform float mirror;
vec4 project(vec3 p) {
    vec3 v = vec3(p.x, p.y * mirror, p.z) - eye;
    float d = v.z * lens.z - v.y * lens.w;
    float y = v.y * lens.z + v.z * lens.w;
    return vec4(v.x * lens.x, y * lens.y + .14 * d, d * 1.00175 - 1.40123, d);
}
`
const atmosphere = `
const vec3 sun = vec3(-.42, .27, .865);
vec3 sky(vec3 dir) {
    float h = max(dir.y, 0.);
    vec3 col = mix(vec3(.95,.77,.57), vec3(.33,.65,.73), smoothstep(-.025,.54,h));
    float light = max(dot(dir, sun),0.);
    col += vec3(.26,.136,.043) * pow(light, 11.);
    col += vec3(1.,.68,.25) * smoothstep(.99948,.99967,light) * .62;
    return col;
}
float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
`
export const backgroundVertex = `#version 300 es
out vec2 uv;
void main(){
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    uv = p;
    gl_Position = vec4(p*2.-1.,0,1);
}`
export const backgroundFragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
${camera}
${atmosphere}
float ridge(float x, float seed) {
    return noise(vec2(x*5.,seed))*.036 + noise(vec2(x*17.,seed))*.015
        + noise(vec2(x*55.,seed))*.008;
}
void main(){
    float v = (uv.y*2.-1.-.14)/lens.y;
    vec3 dir = normalize(vec3((uv.x*2.-1.)/lens.x, v*lens.z-lens.w, lens.z+v*lens.w));
    vec3 c = sky(dir);
    vec2 cloudUV = vec2(dir.x,dir.y*2.35)*4.;
    float mist = noise(cloudUV) * .6 + noise(cloudUV*2.07)*.27 + noise(cloudUV*5.)*.13;
    c = mix(c, vec3(1.,.87,.72), smoothstep(.51,.8,mist)*smoothstep(.02,.15,dir.y)*.4);
    float x = dir.x + eye.x*.001;
    c = mix(c,vec3(.69,.70,.60),1.-smoothstep(-.001,.001, dir.y-ridge(x,8.)-.009));
    c = mix(c,vec3(.49,.60,.48),1.-smoothstep(-.001,.001, dir.y-ridge(x+6.,19.)+.012));
    c += (hash(gl_FragCoord.xy)-.5)*.018;
    frag = vec4(c,1);
}`
export const meshVertex = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec4 color;
layout(location=2) in vec4 data;
out vec3 world;
out vec4 tint;
flat out vec3 info;
out vec2 texcoord;
${camera}
void main(){
    world=position;
    tint=color;
    info = data.xyz;
    texcoord = data.xy;
    gl_Position = project(world);
}`
export const meshFragment = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 world;
in vec4 tint;
flat in vec3 info;
in vec2 texcoord;
uniform vec3 eye;
uniform float mirror;
uniform sampler2DArray canopy;
uniform int mode; // 0 solid, 1 foliage, 2 water decals
out vec4 frag;
${atmosphere}
void main(){
    vec3 col = tint.rgb;
    float alpha = tint.a;
    if (mode==2) {
        frag=vec4(col,alpha);
        return;
    }
    float dist = length(world.xz-eye.xz);
    if (mode == 1) {
        vec4 leaf=texture(canopy,vec3(texcoord,info.z));
        if (leaf.a < .44) discard;
        col=leaf.rgb/max(leaf.a,.01);
        float backlight = smoothstep(.4,1.,texcoord.y)*(1.-texcoord.x);
        col *= vec3(.76,.89,.75) + backlight*vec3(.36,.27,.11);
    } else if (info.x > .5) {
        vec2 p = world.xz;
        float groundTone = noise(p*.34)*.7+noise(p*2.3)*.3;
        float flecks = noise(p*15.)-.5;
        col *= .69 + groundTone*.45 + flecks*.13;
        col = mix(col, vec3(.62,.54,.29), smoothstep(.66,.98,groundTone)*.24);
    } else {
        // Gentle key light on the original flat pigment colors.
        vec3 n = cross(dFdx(world),dFdy(world));
        n *= inversesqrt(max(dot(n,n),1e-16));
        float diffuse = abs(dot(n,sun));
        col *= vec3(.84,.89,.88) + diffuse*vec3(.29,.23,.16);
    }
    if(alpha < .999 && hash(floor(gl_FragCoord.xy)) > alpha) discard;
    float fog = 1. - exp(-dist * (mode==1 ? .010 : .0065));
    col = mix(col, vec3(.74,.76,.62), fog*.88);
    col += (hash(gl_FragCoord.xy)-.5)*.022;
    frag=vec4(col,1);
}`
export const waterFragment = `#version 300 es
precision highp float;
in vec3 world;
in vec2 texcoord; // bank width and center interpolate with the river mesh
uniform vec3 eye;
uniform vec2 resolution;
uniform float time;
uniform vec4 islands[3]; // x, z, rx, rz
uniform vec3 phases;
uniform int islandCount;
uniform sampler2D reflection;
out vec4 frag;
${atmosphere}
void main(){
    vec2 p = world.xz;
    vec3 view = normalize(eye-world);
    float dist = length(p-eye.xz);
    float edge = texcoord.x - abs(p.x-texcoord.y);
    for(int i=0; i<3; i++){
        if(i>=islandCount) break;
        vec4 o=islands[i];
        vec2 offset=(p-o.xy)/o.zw;
        if(abs(offset.y)>2.) continue;
        float a=atan(offset.y,offset.x);
        float r=1.+.1*sin(a*3.+phases[i])+.05*cos(a*5.-phases[i]);
        edge=min(edge,(length(offset)-r)*o.z);
    }
    float a = dot(p,vec2(.64,1.58))-time*1.05;
    float b = dot(p,vec2(-1.14,2.5))+time*.77;
    float c = dot(p,vec2(1.88,4.2))-time*1.53;
    float d = dot(p,vec2(-.38,7.6))+time*1.92;
    float detail = 1.-smoothstep(14.,55.,dist);
    vec2 wave = vec2(.042,.087)*cos(a) + vec2(-.034,.072)*cos(b);
    wave += (vec2(.026,.052)*cos(c)+vec2(-.012,.032)*cos(d))*detail;
    vec3 n = normalize(vec3(wave.x,1.,wave.y));
    vec3 ray = reflect(-view,n);
    float fresnel = pow(1.-max(0.,dot(n,view)),3.5);
    vec3 blue = vec3(.076,.38,.40), pale = vec3(.43,.65,.43);
    float grain = sin(a+b*.55)*.5 + sin(b-c*.71)*.3 + sin(d+c)*.2;
    vec3 pigment = mix(pale,blue,smoothstep(-.18,3.6,edge+(noise(p*1.6)-.5)*.34));
    pigment += grain*vec3(.030,.043,.033)*mix(.45,1.,detail);
    vec3 env = sky(ray);
    vec2 st = gl_FragCoord.xy/resolution;
    vec2 stretch = wave * vec2(.11,.071) * (.62 + .38*detail);
    vec4 refl = texture(reflection, clamp(st+stretch,0.,1.));
    env = mix(env, refl.rgb/max(refl.a,.01)*vec3(.83,.92,.87), refl.a*.84);
    vec3 water = mix(pigment, env, .15 + fresnel*.55);
    float glint = max(dot(ray,sun),0.);
    water += vec3(1.,.74,.40)*(pow(glint,95.)*.34+pow(glint,20.)*.12);
    float foam = (1.-smoothstep(.017,.17,abs(edge-.10+.045*sin(p.y*6.-time))))*.23;
    water = mix(water,vec3(.88,.91,.69),foam);
    water = mix(water, vec3(.74,.76,.62), (1.-exp(-dist*.008))*.67);
    // Thin silver crests, filtered out as their screen footprint shrinks.
    float crest = sin(a*.38 + c*1.24 + .56*sin(b))*.61 + sin(d*.61+b)*.39;
    float ripple = smoothstep(.76,.96,crest);
    water += vec3(.08,.11,.09)*ripple*detail;
    water += (hash(gl_FragCoord.xy)-.5)*.021;
    frag=vec4(water,1.);
}`
