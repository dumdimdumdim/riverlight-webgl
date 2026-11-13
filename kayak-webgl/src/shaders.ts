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
layout(location=3) in vec4 instancePlacement;
layout(location=4) in vec4 instanceColor;
layout(location=5) in vec4 instanceRotation;
out vec3 world;
out vec4 tint;
out vec3 normal;
out vec3 localPosition;
flat out highp int material;
out vec2 texcoord;
uniform highp int mode; // 0 scene, 1 instanced trees, 2 water decals
${camera}
void main(){
    world = position;
    normal = data.xyz;
    localPosition = position;
    tint = color;
    material = int(data.w);
    texcoord = data.xy;
    if (mode==1) {
        float c=instanceRotation.x, s=instanceRotation.y;
        mat2 rotation=mat2(c,-s,s,c);
        world.xz=rotation*world.xz;
        normal.xz=rotation*normal.xz;
        world=world*instancePlacement.w+instancePlacement.xyz;
        localPosition.x+=instanceRotation.z;
        tint.a=instanceColor.a;
        tint.rgb*=material==4 ? vec3(.42,.31,.206) : instanceColor.rgb;
    }
    gl_Position=project(world);
}`
export const meshFragment = `#version 300 es
precision highp float;
in vec3 world;
in vec4 tint;
in vec3 normal;
in vec3 localPosition;
flat in highp int material;
uniform vec3 eye;
uniform float mirror;
uniform highp int mode;
out vec4 frag;
${atmosphere}
void main(){
    vec3 col=tint.rgb;
    if (mode==2) {
        frag=vec4(col,tint.a);
        return;
    }
    if (world.y<0.) discard;
    float dist=length(world.xz-eye.xz);
    if (material==1) {
        vec2 p=world.xz;
        float groundTone=noise(p*.34)*.7+noise(p*2.3)*.3;
        float flecks=noise(p*15.)-.5;
        col*=.69+groundTone*.45+flecks*.13;
        col=mix(col,vec3(.62,.54,.29),smoothstep(.66,.98,groundTone)*.24);
    } else if (material==0) {
        vec3 n=cross(dFdx(world),dFdy(world));
        n*=inversesqrt(max(dot(n,n),1e-16));
        col*=vec3(.84,.89,.88)+abs(dot(n,sun))*vec3(.29,.23,.16);
    } else {
        vec3 n=normalize(normal);
        vec3 key=normalize(vec3(-.48,.74,-.43));
        float diffuse=max(dot(n,key),0.);
        float bounce=max(n.y,0.);
        vec3 view=normalize(vec3(eye.x,eye.y*mirror,eye.z)-world);
        float spec=pow(max(dot(n,normalize(key+view)),0.), material==3 ? 50. : 30.);
        if (material==5) {
            vec2 leaf=localPosition.xz*19.+localPosition.y*vec2(9.2,5.7);
            float detail=1.-smoothstep(30.,90.,dist);
            float mottling=noise(leaf)*.57+noise(leaf*2.14)*.43;
            float light=.55+diffuse*.37+bounce*.16;
            col*=light+(mottling-.5)*.29*detail+smoothstep(.7,2.75,localPosition.y)*.13;
            col+=vec3(.17,.13,.043)*pow(max(dot(n,sun),0.),4.)*.39;
        } else if (material==4) {
            float bark=noise(localPosition.xz*37.+localPosition.y*vec2(2.3,1.2));
            col*=.51+diffuse*.53+bark*.24;
        } else {
            col*=vec3(.63,.66,.70)+diffuse*vec3(.44,.39,.32)+bounce*.07;
            if (material==3 || material==6) {
                col+=vec3(1.,.84,.57)*spec*(material==3 ? .40 : .24);
            }
        }
    }
    if(tint.a<.999 && hash(floor(gl_FragCoord.xy))>tint.a) discard;
    float fog=1.-exp(-dist*(mode==1 ? .008 : .0065));
    col=mix(col,vec3(.74,.76,.62),fog*.88);
    col+=(hash(gl_FragCoord.xy)-.5)*.019;
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
    // Low frequency drift bends each family of waves by a different amount.
    vec2 flow=vec2(noise(p*.24+vec2(6.,-time*.026)),noise(p*.31+vec2(-3.,time*.041)))-.5;
    float a=dot(p,vec2(.42,1.67))+flow.x*3.2-time*.70;
    float b=dot(p,vec2(-1.13,2.76))+flow.y*4.6+time*.57;
    float c=dot(p,vec2(.88,7.6))+(flow.x+flow.y)*6.8-time*1.3;
    float detail=1.-smoothstep(12.,66.,dist);
    float distanceCalm=mix(.47,1.,1.-smoothstep(22.,135.,dist));
    float wind=noise(p*.75+vec2(time*.045,-time*.11));
    vec2 wave=vec2(.024,.057)*cos(a)*( .55+wind*.67)
        + vec2(-.025,.056)*cos(b)*(.8-flow.x*.42);
    wave*=distanceCalm;
    wave+=vec2(.013,.041)*cos(c)*wind*detail;
    vec3 n = normalize(vec3(wave.x,1.,wave.y));
    vec3 ray = reflect(-view,n);
    float fresnel = pow(1.-max(0.,dot(n,view)),3.5);
    vec3 blue = vec3(.076,.38,.40), pale = vec3(.43,.65,.43);
    float grain = noise(p*vec2(.42,1.2)+flow+vec2(.0,-time*.09))-.5;
    vec3 pigment = mix(pale,blue,smoothstep(-.18,3.6,edge+(noise(p*1.6)-.5)*.34));
    pigment += grain*vec3(.027,.040,.033);
    vec3 env = sky(ray);
    vec2 st = gl_FragCoord.xy/resolution;
    vec2 stretch = wave * vec2(.11,.071) * (.62 + .38*detail);
    vec4 refl = texture(reflection, clamp(st+stretch,0.,1.));
    env = mix(env, refl.rgb/max(refl.a,.01)*vec3(.83,.92,.87), refl.a*.84);
    vec3 water = mix(pigment, env, .15 + fresnel*.55);
    float glint = max(dot(ray,sun),0.);
    water += vec3(1.,.74,.40)*(pow(glint,110.)*.22+pow(glint,27.)*.095);
    float foam = (1.-smoothstep(.017,.17,abs(edge-.10+.045*sin(p.y*6.-time))))*.23;
    water = mix(water,vec3(.88,.91,.69),foam);
    water = mix(water, vec3(.74,.76,.62), (1.-exp(-dist*.008))*.67);
    // Broken, thin capillary highlights appear in local patches of wind.
    float crest=sin(dot(p,vec2(-1.8,14.2))+flow.y*9.+noise(p*1.83)*2.8-time*1.4);
    float band=1.-smoothstep(.5,2.6,fwidth(c));
    float breaks=noise(p*vec2(.94,2.8)+vec2(time*.034,-time*.082)+flow);
    float ripple=smoothstep(.80,.99,crest)*smoothstep(.46,.77,breaks)
        *smoothstep(.48,.78,wind)*band*detail;
    water+=vec3(.055,.074,.070)*ripple;
    water += (hash(gl_FragCoord.xy)-.5)*.021;
    frag=vec4(water,1.);
}`
