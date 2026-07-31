precision highp float;
uniform vec2 uR;
uniform float uT, uS, uSc, uBl;
uniform vec3 uBg;
#define TAU 6.2831853

mat2 r2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

float smin(float a,float b,float k){
  float h=clamp(.5+.5*(b-a)/k,0.,1.);
  return mix(b,a,h)-k*h*(1.-h);
}
float smax(float a,float b,float k){ return -smin(-a,-b,k); }

// quintic ease — smoother start/end than linear mix, avoids the "snap" feel at stage boundaries
float ease(float x){ x=clamp(x,0.,1.); return x*x*x*(x*(x*6.0-15.0)+10.0); }

float sphere(vec3 p,float r){return length(p)-r;}
float sdEllipsoid(vec3 p, vec3 r){
  float k0=length(p/r);
  float k1=length(p/(r*r));
  return k0*(k0-1.0)/max(k1,1e-4);
}
float sdEgg(vec3 p, float rx, float rBottom, float rTop){
  float ry = p.y > 0.0 ? rTop : rBottom;
  return sdEllipsoid(vec3(p.x, p.y*(rBottom/max(ry,1e-3)), p.z), vec3(rx, rBottom, rx));
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float rad){
  vec3 pa=p-a, ba=b-a;
  float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);
  return length(pa-ba*h)-rad;
}
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba);
  float t=clamp(dot(p-a,ba)/l2,0.,1.);
  vec3 pr = a + ba*t - p;
  float rr = mix(r1,r2,t);
  return length(pr)-rr;
}
// flat tapered blade for feathers (thin round cone, squashed on one axis)
float sdFeather(vec3 p, vec3 a, vec3 b, float w0, float w1, vec3 flatAxis){
  vec3 ba=b-a; float l2=dot(ba,ba);
  float t=clamp(dot(p-a,ba)/l2,0.,1.);
  vec3 proj = a + ba*t - p;
  float along = dot(proj, normalize(flatAxis));
  vec3 perp = proj - along*normalize(flatAxis);
  float w = mix(w0,w1,t);
  return length(vec2(length(perp), along*0.35)) - w;
}
float fbmFluff(vec3 p){
  float n = sin(p.x*40.0)*sin(p.y*40.0+1.7)*sin(p.z*40.0+3.1);
  n += 0.5*sin(p.x*81.0+2.0)*sin(p.y*77.0+.4)*sin(p.z*73.0+1.1);
  return n/1.5;
}

// bodyR, ex1=(headR,beakL,wingR,legL), ex2=(combH,tailR,stance,fluffAmt), ex3=(wattleH,neckL,lean)
void stageParams(float stage, out vec3 bodyR, out vec4 ex1, out vec4 ex2, out vec3 ex3){
  if(stage < 0.5){ // EGG
    bodyR=vec3(.40,.55,.40);
    ex1=vec4(.001,.0,.001,.0);
    ex2=vec4(.0,.001,.0,.0);
    ex3=vec3(.0,.0,.0);
  } else if(stage < 1.5){ // CHICK
    bodyR=vec3(.34,.32,.34);
    ex1=vec4(.24,.055,.13,.075);
    ex2=vec4(.015,.07,.10,1.0);
    ex3=vec3(.0,.02,.05);
  } else if(stage < 2.5){ // PULLET
    bodyR=vec3(.32,.38,.34);
    ex1=vec4(.17,.075,.16,.22);
    ex2=vec4(.05,.16,.14,.55);
    ex3=vec3(.02,.11,.08);
  } else if(stage < 3.5){ // LAYER
    bodyR=vec3(.36,.42,.36);
    ex1=vec4(.155,.085,.20,.30);
    ex2=vec4(.11,.28,.16,.20);
    ex3=vec3(.06,.16,.10);
  } else { // BROILER
    bodyR=vec3(.54,.36,.46);
    ex1=vec4(.14,.07,.25,.15);
    ex2=vec4(.06,.15,.26,.10);
    ex3=vec3(.03,.10,.30);
  }
}

float birdSDF(vec3 p, vec3 bodyR, vec4 ex1, vec4 ex2, vec3 ex3){
  float headR=ex1.x, beakL=ex1.y, wingR=ex1.z, legL=ex1.w;
  float combH=ex2.x, tailR=ex2.y, stance=ex2.z, fluffAmt=ex2.w;
  float wattleH=ex3.x, neckL=ex3.y, lean=ex3.z;

  vec3 pb = p;
  pb.yz = r2(-lean)*pb.yz;

  float body = sdEllipsoid(pb, max(bodyR, vec3(.05)));
  body += fluffAmt * fbmFluff(p) * 0.0065;

  vec3 neckBase = vec3(0.0, bodyR.y*0.55, bodyR.z*0.55);
  vec3 headCenter = neckBase + vec3(0.0, headR*0.9 + neckL, headR*0.35);
  float neck = sdCapsule(pb, neckBase, headCenter, mix(headR*0.55, headR*0.4, 0.5));

  vec3 headP = pb - headCenter;
  float head = sphere(headP, max(headR,0.02));
  head += fluffAmt * fbmFluff(p*1.3) * 0.0045;

  vec3 beakBase = headCenter + vec3(0.0, -headR*0.05, headR*0.85);
  vec3 beakTip  = beakBase + vec3(0.0, -beakL*0.25, beakL);
  float beak = sdRoundCone(pb, beakBase, beakTip, headR*0.22, 0.012);

  // comb: 5 jagged bumps, height varies across the arc for a natural saw edge
  vec3 cp = pb - headCenter;
  float comb = 1e5;
  for(int i=0;i<5;i++){
    float fi = float(i);
    float h = combH * (0.55 + 0.45*sin(fi*1.3+0.4));
    vec3 off = vec3(0.0, headR*0.82 + h, headR*0.55 - fi*headR*0.24);
    float knob = sphere(cp - off, max(h*0.6,0.006));
    comb = min(comb, knob);
  }

  vec3 wp = pb - (headCenter + vec3(0.0,-headR*0.55,headR*0.55));
  float wattle = min(
    sdEllipsoid(wp - vec3( headR*0.18,0,0), vec3(headR*0.16, max(wattleH,0.006), headR*0.16)),
    sdEllipsoid(wp - vec3(-headR*0.18,0,0), vec3(headR*0.16, max(wattleH,0.006), headR*0.16))
  );

  vec3 eyeC = headCenter + vec3(0.0, headR*0.15, headR*0.75);
  float eyeL = sphere(headP - vec3( headR*0.42,eyeC.y-headCenter.y,eyeC.z-headCenter.z), headR*0.22);
  float eyeR = sphere(headP - vec3(-headR*0.42,eyeC.y-headCenter.y,eyeC.z-headCenter.z), headR*0.22);
  head = smax(head, -eyeL, 0.015);
  head = smax(head, -eyeR, 0.015);

  // wing covert base
  vec3 wingBaseL = vec3( bodyR.x*0.86, bodyR.y*0.05, -bodyR.z*0.05);
  vec3 wingBaseR = vec3(-bodyR.x*0.86, bodyR.y*0.05, -bodyR.z*0.05);
  vec3 wL = pb - wingBaseL; wL.xy = r2(-0.35)*wL.xy;
  vec3 wR = pb - wingBaseR; wR.xy = r2(0.35)*wR.xy;
  float wing = min(
    sdEllipsoid(wL, vec3(max(wingR*0.32,.02), wingR*0.85, wingR*0.5)),
    sdEllipsoid(wR, vec3(max(wingR*0.32,.02), wingR*0.85, wingR*0.5))
  );
  // 3 primary feather blades trailing off each wing
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec3 dirL = normalize(vec3(0.35+fi*0.12, -0.5-fi*0.15, -0.8-fi*0.1));
    vec3 dirR = vec3(-dirL.x, dirL.y, dirL.z);
    vec3 baseL = wingBaseL + vec3(0.0,-wingR*0.2,0.0);
    vec3 baseR = wingBaseR + vec3(0.0,-wingR*0.2,0.0);
    float feL = sdFeather(pb, baseL, baseL + dirL*wingR*1.3, wingR*0.14, 0.008, vec3(0,1,0));
    float feR = sdFeather(pb, baseR, baseR + dirR*wingR*1.3, wingR*0.14, 0.008, vec3(0,1,0));
    wing = min(wing, min(feL,feR));
  }

  float legX = bodyR.x*0.32 + stance*0.4;
  vec3 legTop  = vec3( legX, -bodyR.y*0.82, bodyR.z*0.05);
  vec3 legBot  = legTop + vec3(0.0, -legL, 0.0);
  vec3 legTopL = vec3(-legX, legTop.y, legTop.z);
  vec3 legBotL = vec3(-legX, legBot.y, legBot.z);
  float legs = min(
    sdRoundCone(pb, legTop, legBot, 0.045, 0.028),
    sdRoundCone(pb, legTopL, legBotL, 0.045, 0.028)
  );

  float toes = 1e5;
  for(int i=0;i<3;i++){
    float fi=float(i)-1.0;
    vec3 dir = normalize(vec3(fi*0.55, -0.15, 0.9));
    toes = min(toes, sdRoundCone(pb, legBot,  legBot  + dir*0.12, 0.017, 0.005));
    toes = min(toes, sdRoundCone(pb, legBotL, legBotL + dir*0.12, 0.017, 0.005));
  }

  // tail: fan of 5 individual feather blades instead of one blob
  vec3 tailBase = pb - vec3(0.0, bodyR.y*0.15, -bodyR.z*0.88);
  float tail = 1e5;
  for(int i=0;i<5;i++){
    float fi=float(i)-2.0;
    vec3 dir = normalize(vec3(fi*0.28, 0.35+abs(fi)*0.05, -0.9));
    vec3 tp = tailBase;
    tp.yz = r2(0.15*fi)*tp.yz;
    float fe = sdFeather(tp, vec3(0.0), dir*tailR*1.5, tailR*0.22, 0.01, vec3(1,0.3,0));
    tail = min(tail, fe);
  }

  float d = body;
  d = smin(d, neck, 0.10);
  d = smin(d, head, 0.09);
  d = smin(d, beak, 0.02);
  d = smin(d, comb, 0.015);
  d = smin(d, wattle, 0.015);
  d = smin(d, wing, 0.08);
  d = min(d, legs);
  d = min(d, toes);
  d = smin(d, tail, 0.09);
  return d;
}

float sdf(vec3 p){
  float t = uT*.25;
  p.xz = r2(t*0.35)*p.xz;
  p.y += sin(uT*.6)*.015;

  float stage = floor(uSc);
  float e = ease(uBl);

  vec3 bR0,bR1; vec4 e10,e11,e20,e21; vec3 e30,e31;
  stageParams(stage, bR0,e10,e20,e30);
  stageParams(min(stage+1.0,4.0), bR1,e11,e21,e31);

  vec3 bodyR = mix(bR0,bR1,e);
  vec4 ex1   = mix(e10,e11,e);
  vec4 ex2   = mix(e20,e21,e);
  vec3 ex3   = mix(e30,e31,e);

  if(stage < 0.5 && uBl < 0.999){
    float egg = sdEgg(p, bR0.x, bR0.y, bR0.y*1.15);
    float chick = birdSDF(p, bodyR, ex1, ex2, ex3);
    return mix(egg, chick, e);
  }
  return birdSDF(p, bodyR, ex1, ex2, ex3);
}

vec3 norm(vec3 p){float ee=.0015;return normalize(vec3(
  sdf(p+vec3(ee,0,0))-sdf(p-vec3(ee,0,0)),
  sdf(p+vec3(0,ee,0))-sdf(p-vec3(0,ee,0)),
  sdf(p+vec3(0,0,ee))-sdf(p-vec3(0,0,ee))));}

// cheap AO: sample sdf along normal at increasing steps, darken where surface is close by
float ao(vec3 p, vec3 n){
  float occ=0.0, sc=1.0;
  for(int i=0;i<5;i++){
    float h = 0.02 + 0.05*float(i);
    float d = sdf(p + n*h);
    occ += (h-d)*sc;
    sc *= 0.7;
  }
  return clamp(1.0 - occ*2.2, 0.0, 1.0);
}

vec3 pal(float t){return .5+.5*cos(TAU*(.9*t+vec3(0.,.15,.25)));}

void main(){
  vec2 uv=(gl_FragCoord.xy-uR*.5)/min(uR.x,uR.y);
  vec3 ro=vec3(0,0,2.4);
  vec3 rd=normalize(vec3(uv,-1.2));
  float t=0.,hit=0.;
  for(int i=0;i<130;i++){
    float d=sdf(ro+rd*t);
    if(d<.0011){hit=1.;break;}
    if(t>6.)break;
    t+=d*0.85;
  }
  vec3 bg=uBg,col=bg;
  if(hit>.5){
    vec3 p=ro+rd*t;
    vec3 n=norm(p);
    float occ=ao(p,n);
    vec3 bc=pal(uS);
    vec3 l=normalize(vec3(.7,1.,.5));
    float dif=clamp(dot(n,l),0.,1.);
    float fill=clamp(dot(n,normalize(vec3(-.4,-.2,.6))),0.,1.)*0.15;
    float spe=pow(clamp(dot(reflect(-l,n),-rd),0.,1.),32.);
    float fr=pow(1.-clamp(dot(-rd,n),0.,1.),3.5);
    col=bc*(dif*.65+fill+.28)*occ + spe*.5*occ + fr*vec3(.784,1.,.278)*.6;
    col=mix(bg,col,exp(-t*.15));
  }
  col=mix(uBg,col,clamp(1.-dot(uv*.9,uv*.9),0.,1.));
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(127.1,311.7)))*43758.5)-.5)*.025;
  gl_FragColor=vec4(col,1.);
}
