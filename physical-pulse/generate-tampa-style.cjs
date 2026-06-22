const fs=require("fs"); const G="client/public/geo/";
// Screenshot frame (≈27×23mi): valley + basin + east LA, ocean only in SW corner
const LNG_MIN=-118.60, LNG_MAX=-118.12, LAT_MIN=33.93, LAT_MAX=34.27;
const W=10, H=7.083; const lngSpan=LNG_MAX-LNG_MIN, latSpan=LAT_MAX-LAT_MIN; // aspect=lng/lat*... keep equal miles
// equal-miles aspect: lngMiles=27.46, latMiles=23.46 -> W/H=1.170
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
// ── OSM roads (complete coverage), weighted by class ──
const osm=JSON.parse(fs.readFileSync("physical-pulse/data/osm-roads-box.json","utf8"));
const free=[],major=[],minor=[];
for(const w of osm){const t=w.h; if(t==="motorway_link"||t==="trunk_link")continue; const dst=(t==="motorway"||t==="trunk")?free:(t==="primary"||t==="secondary")?major:minor;
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
// ── labels with greedy collision avoidance ──
const nb=load("la-neighborhood-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const cy=load("la-city-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const ar=nb.map(f=>f.properties.area).sort((a,b)=>a-b);
const amin=Math.sqrt(ar[0]||1e-4),amax=Math.sqrt(ar[ar.length-1]||1e-3);
const fsize=a=>{const t=(Math.sqrt(a)-amin)/((amax-amin)||1);return Math.max(0.043,Math.min(0.135,0.043+t*0.092));};
const placed=[]; // bboxes [x0,y0,x1,y1]
const M=0.27;
function tryPlace(cx,cy_,s,len){const w=len*s*0.72, h=s*0.95; const pad=0.012;
  cx=Math.min(Math.max(cx, M+w/2), W-M-w/2); cy_=Math.min(Math.max(cy_, M+h/2), H-M-h/2);
  const bb=[cx-w/2-pad,cy_-h/2-pad,cx+w/2+pad,cy_+h/2+pad];
  for(const p of placed){ if(!(bb[2]<p[0]||bb[0]>p[2]||bb[3]<p[1]||bb[1]>p[3])) return null; }
  placed.push(bb); return [cx,cy_];}
function mkLabel(f,col,scale,weight){const c=f.geometry.coordinates;const s=fsize(f.properties.area||1e-4)*scale;
  const name=f.properties.name.toUpperCase();
  const pos=tryPlace(PX(c),PY(c),s,name.length); if(!pos) return "";
  return `<text x="${pos[0].toFixed(3)}" y="${pos[1].toFixed(3)}" font-size="${s.toFixed(3)}" fill="${col}" `+
    `font-family="Georgia,'Times New Roman',serif" font-weight="${weight}" text-anchor="middle" `+
    `letter-spacing="${(s*0.06).toFixed(3)}" dominant-baseline="middle">${name}</text>\n`;}
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
// place cities first (priority), then neighborhoods by area desc
placed.push([0.3,4.95,2.5,6.9]); // reserve compass + cartouche corner
let labelSvg="";
for(const f of cy.sort((a,b)=>b.properties.area-a.properties.area)) labelSvg+=mkLabel(f,CYC,1.05,"normal");
for(const f of nb.sort((a,b)=>b.properties.area-a.properties.area)) labelSvg+=mkLabel(f,NBC,1.0,"bold");
svg+=labelSvg;
svg+=compass(0.95,5.8,0.42,CHART);
svg+=`<text x="1.5" y="6.5" font-size="0.2" fill="${CHART}" text-anchor="middle" font-family="Georgia,serif" letter-spacing="0.03">LOS ANGELES</text>\n`;
svg+=`<text x="1.5" y="6.7" font-size="0.095" fill="${CHART}" text-anchor="middle" font-family="Georgia,serif" letter-spacing="0.16">CALIFORNIA</text>\n`;
svg+=`<rect x="0.13" y="0.13" width="${W-0.26}" height="${H-0.26}" fill="none" stroke="${NBC}" stroke-width="0.026"/>\n`;
svg+=`<rect x="0.19" y="0.19" width="${W-0.38}" height="${H-0.38}" fill="none" stroke="${NBC}" stroke-width="0.01"/>\n`;
svg+="</svg>\n";
fs.writeFileSync("physical-pulse/pulse-map-tampa-style.svg",svg);
console.log("roads free/major/minor:",free.length,major.length,minor.length,"| labels placed:",placed.length,"of",nb.length+cy.length,"| bytes:",fs.statSync("physical-pulse/pulse-map-tampa-style.svg").size);
