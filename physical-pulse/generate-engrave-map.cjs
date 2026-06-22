// Composite engrave map for the physical Pulse: terrain contours (faint) +
// major streets (freeways + arterials, local grid dropped) + neighborhood
// labels as the hero. Vintage source aesthetic. Built from the app's geo data.
const fs=require("fs");
const G="client/public/geo/";
const LNG_MIN=-118.497, LNG_MAX=-118.183, LAT_MIN=33.910, LAT_MAX=34.170; // ≈18×18mi
const W=10,H=10; const lngSpan=LNG_MAX-LNG_MIN, latSpan=LAT_MAX-LAT_MIN;
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
const path=pls=>pls.map(pl=>"M"+pl.map(c=>PX(c).toFixed(3)+","+PY(c).toFixed(3)).join("L")).join(" ");
const load=f=>JSON.parse(fs.readFileSync(G+f,"utf8")).features;
const linesOf=(feats,filt)=>{const o=[];for(const f of feats){if(filt&&!filt(f))continue;
  for(const pl of polylines(f.geometry.coordinates))o.push(pl);}return o;};
const terrain = linesOf(load("socal-contours.geojson"));
const major   = linesOf(load("la-streets.geojson"), f=>(f.properties.t||0)>=1); // arterials, no local grid
const fwy     = linesOf(load("la-roads.geojson"));
const coast   = linesOf(load("socal-coastline.geojson"));
const nb=load("la-neighborhood-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const cy=load("la-city-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const ar=nb.map(f=>f.properties.area).sort((a,b)=>a-b);
const amin=Math.sqrt(ar[0]||1e-4), amax=Math.sqrt(ar[ar.length-1]||1e-3);
const fsize=a=>{const t=(Math.sqrt(a)-amin)/((amax-amin)||1);return Math.max(0.058,Math.min(0.15,0.058+t*0.092));};
function label(f,col,scale,weight){const c=f.geometry.coordinates;const s=fsize(f.properties.area||1e-4)*scale;
  return `<text x="${PX(c).toFixed(3)}" y="${PY(c).toFixed(3)}" font-size="${s.toFixed(3)}" fill="${col}" `+
    `font-family="Georgia, 'Times New Roman', serif" font-weight="${weight}" text-anchor="middle" `+
    `letter-spacing="${(s*0.14).toFixed(3)}" dominant-baseline="middle">${f.properties.name.toUpperCase()}</text>`;}
const layer=(pls,col,sw)=>`<g stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${path(pls)}"/></g>\n`;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${W} ${H}">\n`;
svg+=`<rect width="${W}" height="${H}" fill="#f4efe1"/>\n`;
svg+=layer(terrain,"#cdbf9e",0.004);   // terrain contours, faintest
svg+=layer(major,  "#97a0bd",0.006);   // major streets / arterials
svg+=layer(fwy,    "#2b3a63",0.017);   // freeways, boldest line
svg+=layer(coast,  "#2a6e7a",0.013);   // coastline
for(const f of cy) svg+=label(f,"#7a8199",1.22,"normal")+"\n";
for(const f of nb) svg+=label(f,"#15233f",1.0,"bold")+"\n";
svg+="</svg>\n";
fs.writeFileSync("physical-pulse/pulse-map-composite-10in.svg",svg);
console.log("terrain:",terrain.length,"major:",major.length,"fwy:",fwy.length,"labels:",nb.length,"+cities",cy.length,"bytes:",fs.statSync("physical-pulse/pulse-map-composite-10in.svg").size);
