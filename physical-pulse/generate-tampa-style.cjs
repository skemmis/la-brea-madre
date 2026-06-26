const fs=require("fs"); const G="client/public/geo/";
// Screenshot frame; equal-miles aspect: 27.4mi × 23.5mi -> W/H = 1.169
const LNG_MIN=-118.60, LNG_MAX=-118.12, LAT_MIN=33.93, LAT_MAX=34.27;
const W=11.7, H=10.0; const lngSpan=LNG_MAX-LNG_MIN, latSpan=LAT_MAX-LAT_MIN;
const PX=c=>((c[0]-LNG_MIN)/lngSpan*W), PY=c=>((LAT_MAX-c[1])/latSpan*H);
const inBox=c=>c[0]>=LNG_MIN&&c[0]<=LNG_MAX&&c[1]>=LAT_MIN&&c[1]<=LAT_MAX;
function clip(a,b){let t0=0,t1=1;const dx=b[0]-a[0],dy=b[1]-a[1];
  const p=[-dx,dx,-dy,dy],q=[a[0]-LNG_MIN,LNG_MAX-a[0],a[1]-LAT_MIN,LAT_MAX-a[1]];
  for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return null;}else{const r=q[i]/p[i];
    if(p[i]<0){if(r>t1)return null;if(r>t0)t0=r;}else{if(r<t0)return null;if(r<t1)t1=r;}}}
  return [[a[0]+t0*dx,a[1]+t0*dy],[a[0]+t1*dx,a[1]+t1*dy]];}
function polylines(coords){const out=[];let cur=null;const e=1e-9;
  for(let i=0;i<coords.length-1;i++){const c=clip(coords[i],coords[i+1]);
    if(!c){if(cur&&cur.length>=2)out.push(cur);cur=null;continue;}const[a,b]=c;
    const ex=Math.abs(b[0]-coords[i+1][0])>e||Math.abs(b[1]-coords[i+1][1])>e;
    const en=Math.abs(a[0]-coords[i][0])>e||Math.abs(a[1]-coords[i][1])>e;
    if(!cur||en){if(cur&&cur.length>=2)out.push(cur);cur=[a];}cur.push(b);
    if(ex){if(cur.length>=2)out.push(cur);cur=null;}}
  if(cur&&cur.length>=2)out.push(cur);return out;}
const linePath=pls=>pls.map(pl=>"M"+pl.map(c=>PX(c).toFixed(3)+","+PY(c).toFixed(3)).join("L")).join(" ");
const load=f=>JSON.parse(fs.readFileSync(G+f,"utf8")).features;
const linesOf=(feats,filt)=>{const o=[];for(const f of feats){if(filt&&!filt(f))continue;
  const geom=f.geometry; const parts=geom.type==="Polygon"?geom.coordinates:[geom.coordinates];
  for(const ring of parts) for(const pl of polylines(ring)) o.push(pl);}return o;};
function fillPath(feats){let d="";for(const f of feats){for(const ring of f.geometry.coordinates){
  d+="M"+ring.map(c=>PX(c).toFixed(3)+","+PY(c).toFixed(3)).join("L")+"Z";}}return d;}
const osm=JSON.parse(fs.readFileSync("physical-pulse/data/osm-roads-box.json","utf8"));
const free=[],major=[],minor=[];
for(const w of osm){const t=w.h; if(t==="motorway_link"||t==="trunk_link")continue;
  const dst=(t==="motorway"||t==="trunk")?free:(t==="primary"||t==="secondary")?major:minor;
  for(const pl of polylines(w.c)) dst.push(pl);}
const land=load("socal-land.geojson");
const rings=[]; for(const f of land) for(const r of f.geometry.coordinates) rings.push(r);
function inLand(p){let c=false;for(const r of rings){for(let i=0,j=r.length-1;i<r.length;j=i++){
  const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];
  if(((yi>p[1])!=(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))c=!c;}}return c;}
function offset(coords,sign,d){const o=[];for(let i=0;i<coords.length;i++){
  const a=coords[Math.max(0,i-1)],b=coords[Math.min(coords.length-1,i+1)];
  let dx=b[0]-a[0],dy=b[1]-a[1];const L=Math.hypot(dx,dy)||1;const nx=-dy/L,ny=dx/L;
  o.push([coords[i][0]+sign*nx*d,coords[i][1]+sign*ny*d]);}return o;}
const coastFeats=load("socal-coastline.geojson"); let bathy=[];
for(const f of coastFeats){const co=f.geometry.coordinates;const m=Math.floor(co.length/2);
  let sign=1;const t=offset([co[Math.max(0,m-1)],co[m],co[Math.min(co.length-1,m+1)]],1,0.01)[1];
  if(inLand(t))sign=-1;
  for(const d of [0.004,0.009,0.015,0.022,0.030,0.039,0.049,0.060,0.072,0.085,0.099,0.114])
    for(const pl of polylines(offset(co,sign,d))) bathy.push(pl);}
const coast=linesOf(coastFeats);
const terrain=linesOf(load("socal-contours.geojson"));
const nb=load("la-neighborhood-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const cy=load("la-city-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const ar=nb.map(f=>f.properties.area).sort((a,b)=>a-b);
const amin=Math.sqrt(ar[0]||1e-4),amax=Math.sqrt(ar[ar.length-1]||1e-3);
const fsize=a=>{const t=(Math.sqrt(a)-amin)/((amax-amin)||1);return Math.max(0.05,Math.min(0.145,0.05+t*0.095));};
// ── label placement: dodges other labels AND freeways, nudged organically ──
const freeSegs=[]; for(const pl of free){for(let i=0;i<pl.length-1;i++)freeSegs.push([PX(pl[i]),PY(pl[i]),PX(pl[i+1]),PY(pl[i+1])]);}
function segInRect(x0,y0,x1,y1,a0,b0,a1,b1){let t0=0,t1=1;const dx=x1-x0,dy=y1-y0;
  const p=[-dx,dx,-dy,dy],q=[x0-a0,a1-x0,y0-b0,b1-y0];
  for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return false;}else{const r=q[i]/p[i];
    if(p[i]<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}}}return true;}
function hitsFree(bb){for(const s of freeSegs){if(segInRect(s[0],s[1],s[2],s[3],bb[0],bb[1],bb[2],bb[3]))return true;}return false;}
const placed=[]; const M=0.27;
function boxFree(bb){for(const p of placed){if(!(bb[2]<p[0]||bb[0]>p[2]||bb[3]<p[1]||bb[1]>p[3]))return false;}return true;}
function onLandInch(x,y){const lng=LNG_MIN+x/W*lngSpan, lat=LAT_MAX-y/H*latSpan; return inLand([lng,lat]);}
function place(cx,cy_,w,h,avoidFree,needLand){const pad=0.02;
  const cands=[[0,0]]; for(const rr of [1,1.5,2,2.6,3.2,4,4.8]) for(let k=0;k<8;k++){const a=k*Math.PI/4+(rr%2?0:0.39); cands.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
  const sx=Math.max(0.11,w*0.5+0.04), sy=Math.max(0.1,h*0.6+0.03);
  for(const[ox,oy]of cands){let x=cx+ox*sx,y=cy_+oy*sy;
    x=Math.min(Math.max(x,M+w/2),W-M-w/2); y=Math.min(Math.max(y,M+h/2),H-M-h/2);
    const bb=[x-w/2-pad,y-h/2-pad,x+w/2+pad,y+h/2+pad];
    if(needLand){const pts=[[x,y],[bb[0],bb[1]],[bb[2],bb[1]],[bb[0],bb[3]],[bb[2],bb[3]]]; if(!pts.every(p=>onLandInch(p[0],p[1]))) continue;}
    if(boxFree(bb)&&(!avoidFree||!hitsFree(bb))){placed.push(bb);return[x,y];}}
  return null;}
const HOLE_D=11.75/25.4, HOLE_R=HOLE_D/2, HOLE_GAP=0.03; const holes=[]; // 11.75mm pixel hole, stacked below each title
function mkLabel(f,col,scale,weight,avoidFree){const c=f.geometry.coordinates;const s=fsize(f.properties.area||1e-4)*scale;
  const lines=f.properties.name.toUpperCase().split(/\s+/);
  const lh=s*1.02, w=Math.max(...lines.map(l=>l.length))*s*0.76, h=lines.length*lh;
  const uW=Math.max(w,HOLE_D), uH=h+HOLE_GAP+HOLE_D;          // title + hole stack
  let pos=place(PX(c),PY(c),uW,uH,avoidFree,true); if(!pos) pos=place(PX(c),PY(c),uW,uH,false,true); if(!pos) pos=place(PX(c),PY(c),uW,uH,false,false); if(!pos) return "";
  const top=pos[1]-uH/2, labelY=top+h/2, holeY=top+h+HOLE_GAP+HOLE_R;
  holes.push({x:pos[0],y:holeY,name:f.properties.name});
  const ls=(s*0.05).toFixed(3); const first=(-(lines.length-1)/2*lh).toFixed(3);
  let t=`<text x="${pos[0].toFixed(3)}" y="${labelY.toFixed(3)}" font-size="${s.toFixed(3)}" fill="${col}" `+
    `font-family="Georgia,'Times New Roman',serif" font-weight="${weight}" text-anchor="middle" letter-spacing="${ls}" dominant-baseline="central">`;
  lines.forEach((l,i)=>{t+=`<tspan x="${pos[0].toFixed(3)}" dy="${i===0?first:lh.toFixed(3)}">${l}</tspan>`;});
  return t+"</text>\n";}
const layer=(pls,col,sw,op=1)=>`<g stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"><path d="${linePath(pls)}"/></g>\n`;
function compass(x,y,r,col){let s=`<g>`;for(let i=0;i<8;i++){const a=i*Math.PI/4,lr=(i%2?r*0.4:r);
  const x2=x+Math.sin(a)*lr,y2=y-Math.cos(a)*lr,w2=i%2?0.03:0.05;
  s+=`<polygon points="${x},${y} ${(x+Math.sin(a-0.13)*w2).toFixed(2)},${(y-Math.cos(a-0.13)*w2).toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${(x+Math.sin(a+0.13)*w2).toFixed(2)},${(y-Math.cos(a+0.13)*w2).toFixed(2)}" fill="${col}"/>`;}
  s+=`<circle cx="${x}" cy="${y}" r="${(r*0.18).toFixed(2)}" fill="none" stroke="${col}" stroke-width="0.018"/>`;
  s+=`<text x="${x}" y="${(y-r-0.06).toFixed(2)}" font-size="0.12" fill="${col}" text-anchor="middle" font-family="Georgia,serif">N</text></g>`;return s;}
const WATER="#45544f",LANDC="#e9dcc0",BATH="#5d716c",CONT="#d2c2a0",MIN="#cabb98",MAJ="#b09a72",FREE="#7a6647",NBC="#46361f",CYC="#736248",CHART="#d3dbd6";
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${W} ${H}">\n`;
svg+=`<rect width="${W}" height="${H}" fill="${WATER}"/>\n`;
svg+=layer(bathy,BATH,0.006,0.6);
svg+=`<path d="${fillPath(land)}" fill="${LANDC}" fill-rule="evenodd"/>\n`;
svg+=layer(coast,"#3a4a45",0.013,0.9);
svg+=layer(terrain,CONT,0.004,0.85);
svg+=layer(minor,MIN,0.0035,0.7);
svg+=layer(major,MAJ,0.006,0.85);
svg+=layer(free,FREE,0.013,0.9);
placed.push([0.3,H-2.6,2.8,H-0.2]); // reserve compass + cartouche corner
let labelSvg="";
// surrounding-city labels (Glendale, Beverly Hills, etc.) removed — City of LA only
// Curated 45: a mix of highly-ticketed hotspots and well-known names, spread across regions
const SELECTED=new Set(["DOWNTOWN","KOREATOWN","WESTLAKE","MID-WILSHIRE","HOLLYWOOD","EAST HOLLYWOOD","BEVERLY GROVE","FAIRFAX","HANCOCK PARK","MID-CITY","BOYLE HEIGHTS","LINCOLN HEIGHTS","EL SERENO","CHINATOWN","HOLLYWOOD HILLS","LOS FELIZ","SILVER LAKE","ECHO PARK","ATWATER VILLAGE","HIGHLAND PARK","EAGLE ROCK","VENICE","WESTWOOD","SAWTELLE","BRENTWOOD","WEST LOS ANGELES","MAR VISTA","PICO-ROBERTSON","WESTCHESTER","NORTH HOLLYWOOD","VAN NUYS","SHERMAN OAKS","STUDIO CITY","ENCINO","CANOGA PARK","PANORAMA CITY","RESEDA","FLORENCE","EXPOSITION PARK","SOUTH PARK","HISTORIC SOUTH-CENTRAL","WATTS","BALDWIN HILLS/CRENSHAW","LEIMERT PARK","PICO-UNION"]);
const TOP45=nb.filter(f=>SELECTED.has(f.properties.name.toUpperCase())).sort((a,b)=>b.properties.area-a.properties.area);
let nplaced=0,missed=[];for(const f of TOP45){const r=mkLabel(f,NBC,1.0,"bold",true);if(r)nplaced++;else missed.push(f.properties.name);labelSvg+=r;}
console.log("neighborhood titles placed:",nplaced,"of 45; missed:",missed.join("|")||"none");
fs.writeFileSync("physical-pulse/led-neighborhoods.json",JSON.stringify(holes.map((hh,i)=>{const f=TOP45.find(t=>t.properties.name===hh.name);return{idx:i,name:hh.name,lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],holeX_in:+hh.x.toFixed(3),holeY_in:+hh.y.toFixed(3)};}),null,1));
console.log("THE 45:",TOP45.map(f=>f.properties.name).join(", "));
svg+=labelSvg;
for(const hh of holes) svg+=`<circle cx="${hh.x.toFixed(3)}" cy="${hh.y.toFixed(3)}" r="${HOLE_R.toFixed(3)}" fill="none" stroke="#d11d1d" stroke-width="0.02"/>\n`;
svg+=compass(1.05,H-1.55,0.5,CHART);
svg+=`<text x="1.65" y="${(H-0.8).toFixed(2)}" font-size="0.2" fill="${CHART}" text-anchor="middle" font-family="Georgia,serif" letter-spacing="0.03">LOS ANGELES</text>\n`;
svg+=`<text x="1.65" y="${(H-0.58).toFixed(2)}" font-size="0.095" fill="${CHART}" text-anchor="middle" font-family="Georgia,serif" letter-spacing="0.16">CALIFORNIA</text>\n`;
svg+=`<rect x="0.13" y="0.13" width="${W-0.26}" height="${H-0.26}" fill="none" stroke="${NBC}" stroke-width="0.026"/>\n`;
svg+=`<rect x="0.19" y="0.19" width="${W-0.38}" height="${H-0.38}" fill="none" stroke="${NBC}" stroke-width="0.01"/>\n`;
svg+="</svg>\n";
fs.writeFileSync("physical-pulse/pulse-map-tampa-style.svg",svg);
console.log("labels placed:",placed.length-1,"of",nb.length+cy.length,"| multiline+freeway-dodge | bytes:",fs.statSync("physical-pulse/pulse-map-tampa-style.svg").size);
