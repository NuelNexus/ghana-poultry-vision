precision highp float;
uniform vec2 uR;
uniform float uT, uS, uSc, uBl;
uniform vec3 uBg;
#define TAU 6.2831853
mat2 r2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float sphere(vec3 p,float r){return length(p)-r;}
float torus(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}
float box(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float octa(vec3 p,float s){p=abs(p);return (p.x+p.y+p.z-s)*.5773;}
float sdf(vec3 p){
  float t=uT*.25,sc=uSc,bl=uBl;
  float d0=sphere(p,.65+.05*sin(t*1.3));
  vec3 p1=p; p1.xz=r2(t*.6)*p1.xz;
  float d1=torus(p1,vec2(.55,.22));
  vec3 p2=p; p2.xy=r2(t*.4)*p2.xy; p2.yz=r2(t*.3)*p2.yz;
  float d2=box(p2,vec3(.42+.04*sin(t*2.)));
  vec3 p3=p; p3.xy=r2(t*.5)*p3.xy;
  float d3=octa(p3,.72+.04*sin(t*1.7));
  vec3 p4=p; p4.xz=r2(t*.7)*p4.xz;
  float d4a=torus(p4,vec2(.45,.15));
  vec3 p5=p; p5.xy=r2(t*.5+1.2)*p5.xy;
  float d4b=torus(p5,vec2(.35,.12));
  float d4=min(d4a,d4b);
  if(sc<1.)return mix(d0,d1,bl);
  if(sc<2.)return mix(d1,d2,bl);
  if(sc<3.)return mix(d2,d3,bl);
  return mix(d3,d4,bl);
}
vec3 norm(vec3 p){float e=.001;return normalize(vec3(
  sdf(p+vec3(e,0,0))-sdf(p-vec3(e,0,0)),
  sdf(p+vec3(0,e,0))-sdf(p-vec3(0,e,0)),
  sdf(p+vec3(0,0,e))-sdf(p-vec3(0,0,e))));}
vec3 pal(float t){return .5+.5*cos(TAU*(.9*t+vec3(0.,.15,.25)));}
void main(){
  vec2 uv=(gl_FragCoord.xy-uR*.5)/min(uR.x,uR.y);
  vec3 ro=vec3(0,0,2.4);
  vec3 rd=normalize(vec3(uv,-1.2));
  float t=0.,hit=0.;
  for(int i=0;i<96;i++){
    float d=sdf(ro+rd*t);
    if(d<.001){hit=1.;break;}
    if(t>6.)break;
    t+=d;
  }
  vec3 bg=uBg,col=bg;
  if(hit>.5){
    vec3 p=ro+rd*t;
    vec3 n=norm(p);
    vec3 bc=pal(uS);
    vec3 l=normalize(vec3(.7,1.,.5));
    float dif=clamp(dot(n,l),0.,1.);
    float spe=pow(clamp(dot(reflect(-l,n),-rd),0.,1.),32.);
    float fr=pow(1.-clamp(dot(-rd,n),0.,1.),3.5);
    col=bc*(dif*.7+.3)+spe*.5+fr*vec3(.784,1.,.278)*.6;
    col=mix(bg,col,exp(-t*.15));
  }
  col=mix(uBg,col,clamp(1.-dot(uv*.9,uv*.9),0.,1.));
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(127.1,311.7)))*43758.5)-.5)*.025;
  gl_FragColor=vec4(col,1.);
}
