// Neighborhood-forward engrave map for the physical Pulse — labels are the hero,
// region outlines + freeways are faint context, dense streets dropped.
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
// region outlines (neighborhood polygons)
let hoods=[]; for(const f of load("la-city-land.geojson")){const ring=f.geometry.coordinates[0];
  for(const pl of polylines(ring))hoods.push(pl);}
// freeways only — faint orientation
let fwy=[]; for(const f of load("la-roads.geojson"))for(const pl of polylines(f.geometry.coordinates))fwy.push(pl);
let coast=[]; for(const f of load("socal-coastline.geojson"))for(const pl of polylines(f.geometry.coordinates))coast.push(pl);
// labels, sized by area
const nb=load("la-neighborhood-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const cy=load("la-city-labels.geojson").filter(f=>inBox(f.geometry.coordinates));
const areas=nb.map(f=>f.properties.area).sort((a,b)=>a-b);
const amin=Math.sqrt(areas[0]||1e-4), amax=Math.sqrt(areas[areas.length-1]||1e-3);
const fsize=a=>{const t=(Math.sqrt(a)-amin)/((amax-amin)||1);return Math.max(0.058,Math.min(0.155,0.058+t*0.097));};
function label(f,col,scale,weight){const c=f.geometry.coordinates;const s=fsize(f.properties.area||1e-4)*scale;
  const name=f.properties.name.toUpperCase();
  return `<text x="${PX(c).toFixed(3)}" y="${PY(c).toFixed(3)}" font-size="${s.toFixed(3)}" fill="${col}" `+
    `font-family="Georgia, 'Times New Roman', serif" font-weight="${weight}" text-anchor="middle" `+
    `letter-spacing="${(s*0.14).toFixed(3)}" dominant-baseline="middle">${name}</text>`;}
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${W} ${H}">\n`;
svg+=`<rect width="${W}" height="${H}" fill="#f4efe1"/>\n`;
svg+=`<g stroke="#c9c0aa" stroke-width="0.009" fill="none" stroke-linejoin="round"><path d="${path(fwy)}"/></g>\n`;       // freeways faint
svg+=`<g stroke="#9aa0b8" stroke-width="0.006" fill="none" stroke-linejoin="round"><path d="${path(hoods)}"/></g>\n`;    // hood outlines
svg+=`<g stroke="#2a6e7a" stroke-width="0.013" fill="none"><path d="${path(coast)}"/></g>\n`;                            // coast
for(const f of cy) svg+=label(f,"#7a8199",1.25,"normal")+"\n";   // surrounding cities, lighter
for(const f of nb) svg+=label(f,"#15233f",1.0,"bold")+"\n";      // neighborhoods, hero
svg+="</svg>\n";
fs.writeFileSync("physical-pulse/pulse-map-neighborhoods-10in.svg",svg);
console.log("hood outlines:",hoods.length,"freeway:",fwy.length,"labels:",nb.length,"+cities",cy.length,"bytes:",fs.statSync("physical-pulse/pulse-map-neighborhoods-10in.svg").size);
