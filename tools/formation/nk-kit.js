/* ══════════════════════════════════════════════════════════════
   KIT COMMUN DES FORMATIONS (scènes et illustrations)

   Injecté par tools/formation/build.js devant les widgets de chaque
   formation, et recopié dans digitalview.html entre les repères
   NK-KIT (même commande). Ne pas le modifier ailleurs qu'ici.
     · vz*  : briques de base des scènes (boutons, légende, cases)
     · nk*  : appareils réalistes en SVG et paquets qui voyagent
     · rs*  : scènes pas à pas (Suivant, Retour, barre d'étapes)
     · gi*  : illustrations fixes des mots clés du lexique (GI)
   ══════════════════════════════════════════════════════════════ */
var GV={};
var VZ_CSS='.vz{--vd:var(--deep,#1F7D74);--vs:var(--soft,#D3EDEA);display:block;margin-top:4px}'
 +'.vz *{box-sizing:border-box}'
 +'.vz-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
 +'.vz-ctl{display:flex;align-items:center;gap:12px;margin:4px 0 12px;font-size:14px;color:var(--muted)}'
 +'.vz-ctl input[type=range]{flex:1;accent-color:var(--vd)}'
 +'.vz-ctl b{color:var(--ink);font-weight:600;min-width:64px;text-align:right}'
 +'.vz-btn{border:0;border-radius:999px;padding:8px 14px;font:inherit;font-size:13.5px;font-weight:500;background:var(--vs);color:var(--ink);cursor:pointer}'
 +'.vz-btn.on,.vz-btn:hover{background:var(--vd);color:#fff}'
 +'.vz-box{border-radius:14px;padding:10px 12px;background:var(--vs);color:var(--ink);font-size:13px;line-height:1.35;border:0;text-align:left;font:inherit;font-size:13px;cursor:default;transition:background-color .25s,color .25s,opacity .25s,transform .25s}'
 +'.vz-box b{display:block;font-size:14px;font-weight:600}'
 +'button.vz-box{cursor:pointer}'
 +'.vz-box.sel{background:var(--vd);color:#fff}'
 +'.vz-box.ko{background:#F6D5D3;color:#8E1F17}'
 +'.vz-box.off{opacity:.35}'
 +'.vz-box.ok{background:#D4EEDD;color:#14532D}'
 +'.vz-msg{margin-top:12px;border-radius:14px;background:var(--surface2);padding:12px 14px;font-size:14px;line-height:1.5;min-height:48px}'
 +'.vz-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}'
 +'.vz-dots{display:flex;flex-wrap:wrap;gap:5px}'
 +'.vz-dot{width:18px;height:18px;border-radius:50%;background:#3D6FD9;transition:background-color .3s,transform .3s}'
 +'.vz-dot.g{background:#1F9D6B}.vz-dot.r{background:#D93025}.vz-dot.x{transform:scale(0)}'
 +'.vz-lane{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:13px}'
 +'.vz-lane i{display:block;height:14px;border-radius:999px;transition:width .35s}'
 +'.vz-bar{height:12px;border-radius:999px;background:var(--line);overflow:hidden}'
 +'.vz-bar i{display:block;height:100%;border-radius:999px;background:var(--vd);transition:width .35s}'
 +'.vz-gantt{display:grid;grid-template-columns:130px 1fr;gap:6px 10px;align-items:center;font-size:13px}'
 +'.vz-gantt button{border:0;height:16px;border-radius:999px;background:var(--vd);opacity:.55;cursor:pointer;padding:0;transition:opacity .2s}'
 +'.vz-gantt button.sel,.vz-gantt button:hover{opacity:1}'
 +'.vz-gantt button.slow{background:#D93025;opacity:1}'
 +'.vz-sub{font-size:12.5px;color:var(--muted);margin:10px 0 6px}'
 +'html[data-theme="dark"] .vz-box.ko{background:#3A1A18;color:#F6B4AE}html[data-theme="dark"] .vz-box.ok{background:#12301F;color:#A7E3BF}'
 +'html[data-theme="dark"] .vz{--vs:#000}';
if(typeof document!=='undefined'&&document.createElement){var vzs=document.createElement('style');vzs.textContent=VZ_CSS;document.head.appendChild(vzs)}

// Les clics dans une scène ne doivent pas faire avancer la carte.
function vzStop(el){el.addEventListener('click',function(e){e.stopPropagation()})}
function vzQ(el,s){return el.querySelector(s)}
function vzA(el,s){return [].slice.call(el.querySelectorAll(s))}


/* ══════════════════════════════════════════════════════════════
   KIT « RÉSEAU RÉALISTE »
   De vrais appareils dessinés en SVG (téléphone, ordinateur, box,
   switch, routeur, serveur, pare-feu, base, antenne, nuage internet)
   et des paquets qui voyagent pour de vrai le long des câbles.
   Une scène = une « scène » SVG (nkStage) + une légende en français
   simple (.vz-msg) + quelques boutons. Une seule idée par scène.
   ══════════════════════════════════════════════════════════════ */
var NK_CSS='.vz{--nk-body:#EEF1F5;--nk-edge:#8C96A6;--nk-dark:#262B35;--nk-scr:#1D2838;--nk-link:#C4CBD5;--nk-zone:#F4F6F9;--nk-zedge:#CDD3DC;--nk-paper:#FFFDF6;--nk-pedge:#C2AE86}'
 +'html[data-theme="dark"] .vz{--nk-body:#15171C;--nk-edge:#4A505C;--nk-dark:#0D0F13;--nk-scr:#101A2A;--nk-link:#363B46;--nk-zone:#08090B;--nk-zedge:#2A2E36;--nk-paper:#1E1B14;--nk-pedge:#6B5B3E}'
 +'.nk{width:100%;max-width:640px;height:auto;display:block;margin:0 auto;overflow:visible}'
 +'.nk .lk{stroke:var(--nk-link);stroke-width:3;fill:none;stroke-linecap:round;transition:stroke .3s}'
 +'.nk .lk.wifi{stroke-dasharray:1 8;stroke-width:4}.nk .lk.on{stroke:var(--vd)}.nk .lk.ko{stroke:#D93025;stroke-dasharray:6 6}'
 +'.nk .nl{font-size:15px;font-weight:600;fill:var(--ink);text-anchor:middle}.nk .ns{font-size:12.5px;fill:var(--muted);text-anchor:middle;font-family:ui-monospace,Menlo,monospace}'
 +'.nk .nside .nl,.nk .nside .ns{text-anchor:start}'
 +'.nk g.n{transition:opacity .3s}.nk g.n.dim{opacity:.3}'
 +'.nk .halo{fill:none;stroke:var(--vd);stroke-width:3;opacity:0;transition:opacity .25s,stroke .25s}'
 +'.nk g.n.hl .halo{opacity:1}.nk g.n.bad .halo{opacity:1;stroke:#D93025}.nk g.n.good .halo{opacity:1;stroke:#1F9D6B}'
 +'.nk .zone{fill:var(--nk-zone);stroke:var(--nk-zedge);stroke-width:1.5;stroke-dasharray:6 5}.nk .zl{font-size:12px;font-weight:600;letter-spacing:.06em;fill:var(--muted)}'
 +'.nk .led{fill:#2BD06B}.nk .led.off{fill:#3A404C}.nk .led.amb{fill:#F2A20C}.nk .led.blink{animation:nkb .18s 4}'
 +'@keyframes nkb{50%{fill:#FFFFFF}}'
 +'.nk .pk .env{fill:var(--nk-paper);stroke:var(--nk-pedge);stroke-width:1.5}.nk .pk .tg rect{fill:var(--vd)}.nk .pk .tg text{fill:#fff;font-size:12px;font-family:ui-monospace,Menlo,monospace;text-anchor:middle}'
 +'.nk .pk.pub .tg rect{fill:#1F9D6B}.nk .pk.ko .tg rect{fill:#D93025}.nk .pk.ko .env{stroke:#D93025}.nk .pk.fade{transition:opacity .6s;opacity:0}'
 +'.nk .lbl rect{fill:var(--vs)}.nk .lbl text{fill:var(--ink);font-size:12px;font-family:ui-monospace,Menlo,monospace;text-anchor:middle}.nk .lbl.ko rect{fill:#F6D5D3}.nk .lbl.ko text{fill:#8E1F17}'
 +'html[data-theme="dark"] .nk .lbl.ko rect{fill:#3A1A18}html[data-theme="dark"] .nk .lbl.ko text{fill:#F6B4AE}'
 +'.nk-term{border-radius:12px;overflow:hidden;background:#101114;margin-top:12px;box-shadow:0 0 0 1px #2A2D35}'
 +'.nk-tb{display:flex;align-items:center;gap:6px;padding:8px 12px;background:#24262C;color:#9A9DA8;font-size:12px}.nk-tb i{width:11px;height:11px;border-radius:50%;background:#FF5F57}.nk-tb i+i{background:#FEBC2E}.nk-tb i+i+i{background:#28C840}.nk-tb span{margin-left:8px}'
 +'.nk-tx{margin:0;padding:12px 14px;color:#D7D7E0;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;white-space:pre-wrap;min-height:48px}'
 +'.nk-tx .p{color:#7FD1A8}.nk-tx .k{color:#F28B82}.nk-tx .w{color:#F5C08E}.nk-tx .c{color:#8AB4F8}'
 +'.nk-say{display:block;margin-top:6px;font-size:15px;font-style:italic;color:var(--ink)}'
 +'.nk-if{display:block;margin-top:8px;font-size:13px;color:var(--muted)}'
 +'.nk-go{font-weight:600}'
 +'.gi{display:block}.gi .nk{max-width:420px}.gi-c{margin-top:8px;font-size:13.5px;color:var(--muted);text-align:center}';
if(typeof document!=='undefined'&&document.createElement){var nks=document.createElement('style');nks.textContent=NK_CSS;document.head.appendChild(nks)}

// Dimensions de chaque appareil (largeur, hauteur), pour le halo et les libellés.
var NK_D={phone:[32,60],laptop:[76,46],tv:[64,48],server:[92,34],box:[80,40],switch:[120,28],router:[92,30],fw:[60,44],cloud:[124,62],db:[40,46],tower:[40,64],mini:[42,20],lb:[92,30],rack:[64,130],ups:[54,72],gen:[100,58],pylon:[52,74],crah:[44,84],building:[96,72],pod:[58,44],bell:[36,40],user:[36,46],ats:[60,44],sw2:[82,22],sfp:[72,24],storage:[92,46],tech:[36,50],k8s:[64,64]};
function nkLeds(xs,y){return xs.map(function(x){return '<circle cx="'+x+'" cy="'+y+'" r="2.2" class="led"/>'}).join('')}
function nkIcon(t){switch(t){
 case 'phone':return '<rect x="-16" y="-30" width="32" height="60" rx="7" fill="var(--nk-dark)"/><rect x="-13" y="-25" width="26" height="47" rx="3" fill="var(--nk-scr)"/><rect x="-9" y="-19" width="18" height="5" rx="2" fill="#3D6FD9"/><rect x="-9" y="-11" width="12" height="3" rx="1.5" fill="#56647C"/><rect x="-9" y="-5" width="16" height="3" rx="1.5" fill="#56647C"/><rect x="-9" y="1" width="10" height="3" rx="1.5" fill="#56647C"/><rect x="-4" y="25" width="8" height="2" rx="1" fill="#56647C"/>';
 case 'laptop':return '<rect x="-30" y="-24" width="60" height="38" rx="4" fill="var(--nk-dark)"/><rect x="-26" y="-20" width="52" height="30" rx="2" fill="var(--nk-scr)"/><rect x="-20" y="-14" width="24" height="4" rx="2" fill="#3D6FD9"/><rect x="-20" y="-7" width="36" height="3" rx="1.5" fill="#56647C"/><rect x="-20" y="-1" width="28" height="3" rx="1.5" fill="#56647C"/><path d="M-38 14h76l-5 8h-66z" fill="var(--nk-edge)"/>';
 case 'tv':return '<rect x="-32" y="-24" width="64" height="40" rx="3" fill="var(--nk-dark)"/><rect x="-28" y="-20" width="56" height="32" rx="1" fill="#24466F"/><path d="M-10 16h20l3 8h-26z" fill="var(--nk-edge)"/>';
 case 'server':var h='<rect x="-46" y="-17" width="92" height="34" rx="4" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/>';for(var i=0;i<4;i++)h+='<rect x="'+(-40+i*14)+'" y="-11" width="11" height="22" rx="2" fill="var(--nk-dark)"/><circle cx="'+(-34.5+i*14)+'" cy="6" r="1.6" class="led"/>';return h+'<path d="M20 -9h20M20 -3h20M20 3h20M20 9h20" stroke="var(--nk-edge)" stroke-width="2"/><circle cx="14" cy="-10" r="2.2" class="led"/>';
 case 'box':return '<path d="M-24 -18l-7 -15M24 -18l7 -15" stroke="var(--nk-edge)" stroke-width="3.5" stroke-linecap="round"/><rect x="-40" y="-18" width="80" height="38" rx="10" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/>'+nkLeds([-22,-12,-2,8],9)+'<rect x="16" y="6" width="14" height="6" rx="2" fill="var(--nk-edge)"/>';
 case 'switch':var s='<rect x="-60" y="-14" width="120" height="28" rx="3" fill="var(--nk-dark)"/>';for(var j=0;j<8;j++){var x=-52+j*13;s+='<rect x="'+x+'" y="-3" width="10" height="9" rx="1" fill="#06070A" stroke="#4A505C"/><circle data-led="'+(j+1)+'" cx="'+(x+5)+'" cy="-8" r="1.9" class="led off"/>'}return s;
 case 'router':var r='<rect x="-46" y="-15" width="92" height="30" rx="4" fill="var(--nk-dark)"/>';for(var k=0;k<4;k++)r+='<rect x="'+(-38+k*13)+'" y="-3" width="10" height="9" rx="1" fill="#06070A" stroke="#4A505C"/>';return r+nkLeds([-33,-20,-7,6],-8)+'<path d="M18 -6h18m-5 -4l5 4l-5 4M36 6h-18m5 -4l-5 4l5 4" stroke="#8FB0F0" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
 case 'lb':return '<rect x="-46" y="-15" width="92" height="30" rx="4" fill="var(--nk-dark)"/><text x="-14" y="5" fill="#8FB0F0" font-size="13" font-weight="700" text-anchor="middle">VIP</text>'+nkLeds([12,22,32],0);
 case 'fw':return '<rect x="-30" y="-22" width="60" height="44" rx="4" fill="#B5462B"/><path d="M-30 -7h60M-30 8h60M-10 -22v15M14 -22v15M-22 -7v15M2 -7v15M24 -7v15M-10 8v14M14 8v14" stroke="#7A2B19" stroke-width="2"/>';
 case 'cloud':return '<path d="M-46 22a19 19 0 0 1 1 -37a27 27 0 0 1 49 -10a23 23 0 0 1 40 14a17 17 0 0 1 -4 33z" fill="var(--nk-zone)" stroke="var(--nk-zedge)" stroke-width="2"/><path d="M-18 4a18 18 0 1 0 36 0a18 18 0 1 0 -36 0M-18 4h36M0 -14c-8 10 -8 26 0 36M0 -14c8 10 8 26 0 36" stroke="var(--nk-edge)" stroke-width="1.6" fill="none"/>';
 case 'db':return '<path d="M-20 -16v32a20 7 0 0 0 40 0v-32" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><ellipse cx="0" cy="-16" rx="20" ry="7" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><path d="M-20 0a20 7 0 0 0 40 0" fill="none" stroke="var(--nk-edge)" stroke-width="1.5"/>';
 case 'tower':return '<path d="M0 -22L-14 30M0 -22L14 30M-9 12h18M-5 -4h10M-11 22l20 -14M11 22l-20 -14" stroke="var(--nk-edge)" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="0" cy="-24" r="4" fill="#3D6FD9"/><path d="M-11 -33a14 14 0 0 0 0 18M11 -33a14 14 0 0 1 0 18M-17 -38a22 22 0 0 0 0 28M17 -38a22 22 0 0 1 0 28" stroke="#3D6FD9" stroke-width="2" fill="none" stroke-linecap="round"/>';
 case 'rack':var rk='<rect x="-32" y="-65" width="64" height="130" rx="3" fill="var(--nk-dark)"/><rect x="-28" y="-61" width="56" height="122" rx="2" fill="#11141A"/>';for(var q=0;q<9;q++){var yy=-57+q*13,ty=q%4===0?'#2D5A8E':q%4===3?'#2A2E36':'#C9CED6';rk+='<rect x="-25" y="'+yy+'" width="50" height="10" rx="1.5" fill="'+ty+'"/>'+(q%4!==3?'<circle cx="19" cy="'+(yy+5)+'" r="1.6" class="led"/>':'')}return rk;
 case 'ups':return '<rect x="-27" y="-36" width="54" height="72" rx="5" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><rect x="-17" y="-28" width="34" height="16" rx="2" fill="#12324A"/><path d="M-12 -20h6M-3 -20h4" stroke="#7FD1A8" stroke-width="2"/><rect x="-15" y="0" width="30" height="24" rx="3" fill="var(--nk-dark)"/><rect x="-5" y="-3" width="10" height="4" rx="1" fill="var(--nk-dark)"/><path d="M-8 12h16" stroke="#7FD1A8" stroke-width="3" class="bat"/>';
 case 'gen':return '<rect x="-50" y="22" width="100" height="7" rx="2" fill="var(--nk-edge)"/><rect x="-46" y="-26" width="92" height="48" rx="6" fill="#C9A227"/><path d="M-36 -14h40M-36 -6h40M-36 2h40M-36 10h40" stroke="#8E7012" stroke-width="2.5"/><rect x="14" y="-18" width="24" height="18" rx="2" fill="#2B303B"/><circle cx="26" cy="9" r="3" class="led off gl"/><rect x="30" y="-36" width="6" height="12" rx="1" fill="var(--nk-edge)"/>';
 case 'pylon':return '<path d="M0 -37L-18 37M0 -37L18 37M-11 4h22M-6 -16h12M-14 22l26 -16M14 22l-26 -16M-24 -22h48M-20 -8h40" stroke="var(--nk-edge)" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="-24" cy="-22" r="2.5" fill="#E8840C"/><circle cx="24" cy="-22" r="2.5" fill="#E8840C"/>';
 case 'crah':return '<rect x="-22" y="-42" width="44" height="84" rx="4" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><circle cx="0" cy="-16" r="14" fill="none" stroke="var(--nk-edge)" stroke-width="2"/><path d="M0 -16l10 -6M0 -16l-10 -6M0 -16v12" stroke="#3D6FD9" stroke-width="2.5" class="fan"/><path d="M-14 10h28M-14 18h28M-14 26h28" stroke="var(--nk-edge)" stroke-width="2"/>';
 case 'building':var bd='<rect x="-48" y="-30" width="96" height="66" rx="3" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><rect x="-48" y="-36" width="96" height="8" rx="2" fill="var(--nk-edge)"/>';for(var r1=0;r1<3;r1++)for(var c1=0;c1<6;c1++)bd+='<rect x="'+(-40+c1*14)+'" y="'+(-22+r1*14)+'" width="9" height="8" rx="1" fill="#5D7CA6"/>';return bd+'<rect x="-8" y="20" width="16" height="16" fill="var(--nk-dark)"/>';
 case 'pod':return '<rect x="-29" y="-22" width="58" height="44" rx="10" fill="#326CE5"/><rect x="-19" y="-11" width="16" height="16" rx="2" fill="#fff"/><rect x="3" y="-11" width="16" height="16" rx="2" fill="#fff"/><path d="M-19 -5h16M3 -5h16" stroke="#326CE5" stroke-width="1.5"/>';
 case 'k8s':return '<path d="M0 -32L28 -18L32 12L12 32H-12L-32 12L-28 -18Z" fill="#326CE5"/><circle cx="0" cy="0" r="12" fill="none" stroke="#fff" stroke-width="3"/><path d="M0 -12V-24M0 12V24M-12 0H-24M12 0H24M-8 -8L-17 -17M8 8L17 17M8 -8L17 -17M-8 8L-17 17" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>';
 case 'bell':return '<path d="M-14 12V-2a14 14 0 0 1 28 0V12l4 6H-18z" fill="#F2A20C"/><circle cx="0" cy="22" r="4" fill="#F2A20C"/><circle cx="0" cy="-18" r="3" fill="#F2A20C"/>';
 case 'user':return '<circle cx="0" cy="-12" r="10" fill="var(--nk-edge)"/><path d="M-18 23c0-14 8-20 18-20s18 6 18 20z" fill="var(--nk-edge)"/>';
 case 'tech':return '<circle cx="0" cy="-12" r="9" fill="#C98B5B"/><path d="M-10 -16a10 9 0 0 1 20 0z" fill="#F2A20C"/><path d="M-17 25c0-14 7-20 17-20s17 6 17 20z" fill="#2D5A8E"/><rect x="-4" y="8" width="8" height="10" rx="1" fill="#F2A20C"/>';
 case 'ats':return '<rect x="-30" y="-22" width="60" height="44" rx="4" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="1.5"/><circle cx="-14" cy="-6" r="4" fill="var(--nk-edge)"/><circle cx="14" cy="-6" r="4" fill="var(--nk-edge)"/><circle cx="0" cy="12" r="4" fill="var(--nk-edge)"/><path class="lev" d="M0 12L-14 -6" stroke="var(--vd)" stroke-width="4" stroke-linecap="round"/>';
 case 'sw2':var s2='<rect x="-41" y="-11" width="82" height="22" rx="3" fill="var(--nk-dark)"/>';for(var z=0;z<6;z++)s2+='<rect x="'+(-35+z*11)+'" y="-3" width="8" height="8" rx="1" fill="#06070A" stroke="#4A505C"/><circle cx="'+(-31+z*11)+'" cy="-7" r="1.5" class="led"/>';return s2+'<path d="M32 -4h6M32 0h6M32 4h6" stroke="#4A505C" stroke-width="1.5"/>';
 case 'sfp':return '<rect x="-30" y="-9" width="56" height="18" rx="2" fill="#B8BEC8" stroke="#8C96A6"/><path d="M-26 -3h40M-26 3h40" stroke="#9AA3B2" stroke-width="1.2"/><rect x="26" y="-6" width="10" height="12" rx="1" fill="#2B303B"/><path d="M-30 0h-6" stroke="#3D6FD9" stroke-width="6" stroke-linecap="round"/>';
 case 'storage':var sg='<rect x="-46" y="-23" width="92" height="46" rx="4" fill="#2A2E36"/>';for(var d2=0;d2<12;d2++)sg+='<rect x="'+(-40+(d2%6)*14)+'" y="'+(-17+Math.floor(d2/6)*18)+'" width="11" height="14" rx="1.5" fill="#8C96A6"/><circle cx="'+(-34.5+(d2%6)*14)+'" cy="'+(-5+Math.floor(d2/6)*18)+'" r="1.4" class="led"/>';return sg;
 case 'mini':return '<rect x="-21" y="-10" width="42" height="20" rx="3" fill="var(--nk-dark)"/>'+nkLeds([-12,-4],0)+'<path d="M4 -3h10m-3 -3l3 3l-3 3M14 4h-10m3 -3l-3 3l3 3" stroke="#8FB0F0" stroke-width="1.6" fill="none"/>';
 }return ''}
// Un appareil : icône, halo, nom et sous-titre (dessous, ou à droite si side).
function nkNode(n){var d=NK_D[n.t]||[60,40],sc=n.sc||1,w=d[0]*sc,h=d[1]*sc,lx=n.side?w/2+12:0,ly=n.side?-2:h/2+19;
 return '<g class="n'+(n.side?' nside':'')+(n.cls?' '+n.cls:'')+'" data-n="'+n.id+'" data-x="'+n.x+'" data-y="'+n.y+'" transform="translate('+n.x+','+n.y+')">'
  +'<rect class="halo" x="'+(-w/2-7)+'" y="'+(-h/2-7)+'" width="'+(w+14)+'" height="'+(h+14)+'" rx="12"/>'+(sc!==1?'<g transform="scale('+sc+')">'+nkIcon(n.t)+'</g>':nkIcon(n.t))
  +(n.l?'<text class="nl" x="'+lx+'" y="'+ly+'">'+n.l+'</text>':'')+(n.s?'<text class="ns" x="'+lx+'" y="'+(ly+16)+'">'+n.s+'</text>':'')+'</g>'}
// Une scène : zones (pièces, sites), câbles, appareils, puis la couche des paquets.
function nkStage(o){var P={};o.nodes.forEach(function(n){P[n.id]=n});
 var s='<svg class="nk" viewBox="0 0 '+o.w+' '+o.h+'" role="img"'+(o.label?' aria-label="'+o.label+'"':'')+'>';
 (o.zones||[]).forEach(function(z){s+='<rect class="zone" x="'+z[0]+'" y="'+z[1]+'" width="'+z[2]+'" height="'+z[3]+'" rx="16"/><text class="zl" x="'+(z[0]+14)+'" y="'+(z[1]+22)+'">'+z[4]+'</text>'});
 (o.links||[]).forEach(function(l){var a=P[l[0]],b=P[l[1]];s+='<path class="lk '+(l[2]||'')+'" data-l="'+l[0]+'-'+l[1]+'" d="'+(l[3]||'M'+a.x+' '+a.y+'L'+b.x+' '+b.y)+'"/>'});
 s+=(o.extra||'');o.nodes.forEach(function(n){s+=nkNode(n)});return s+'<g class="lbls"></g><g class="pks"></g></svg>'}
function nkPos(el,id){if(typeof id!=='string')return id;var g=vzQ(el,'g.n[data-n="'+id+'"]');return [+g.dataset.x,+g.dataset.y]}
function nkTagW(t){return Math.max(30,String(t).length*7.4+16)}
function nkPk(tag,cls){var w=nkTagW(tag);return '<g class="pk '+(cls||'')+'">'+(tag?'<g class="tg"><rect x="'+(-w/2)+'" y="-36" width="'+w+'" height="21" rx="10.5"/><text y="-21.5">'+tag+'</text></g>':'')+'<rect class="env" x="-13" y="-9" width="26" height="18" rx="2"/><path class="env" d="M-13 -9l13 9l13 -9" fill="none"/></g>'}
function nkTag(pk,t,cls){var r=pk.querySelector('.tg rect'),x=pk.querySelector('.tg text');if(!r)return;var w=nkTagW(t);r.setAttribute('x',-w/2);r.setAttribute('width',w);x.textContent=t;if(cls!==undefined)pk.setAttribute('class','pk '+cls)}
var NK_RM=typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// Fait voyager un paquet le long d'un chemin (ids d'appareils ou points [x,y]).
// Renvoie une promesse : le paquet (si keep), true, ou false si la scène a été relancée.
function nkFly(el,path,o){o=o||{};var tok=el._tok,lay=vzQ(el,'.pks');lay.insertAdjacentHTML('beforeend',o.dot?'<g class="pk"><circle r="'+(o.r||5)+'" fill="'+o.dot+'"/></g>':nkPk(o.tag||'',o.cls));var pk=lay.lastElementChild,pts=path.map(function(p){return nkPos(el,p)}),dur=NK_RM?1:(o.dur||650);
 return new Promise(function(res){var i=0,t0=null;function at(x,y){pk.setAttribute('transform','translate('+x+','+y+')')}at(pts[0][0],pts[0][1]);
  function step(ts){if(el._tok!==tok){pk.remove();return res(false)}
   if(i>=pts.length-1){if(o.keep)return res(pk);setTimeout(function(){pk.remove()},o.linger||200);return res(true)}
   if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/dur),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2,a=pts[i],b=pts[i+1];at(a[0]+(b[0]-a[0])*e,a[1]+(b[1]-a[1])*e);
   if(k>=1){i++;t0=null;if(o.hop)o.hop(i,pk)}requestAnimationFrame(step)}
  requestAnimationFrame(step)})}
function nkWait(el,ms){var tok=el._tok;return new Promise(function(r){setTimeout(function(){r(el._tok===tok)},NK_RM?1:ms)})}
// Relance une scène : annule les paquets en vol et efface les états.
function nkReset(el){el._tok=(el._tok||0)+1;var l=vzQ(el,'.pks');if(l)l.innerHTML='';var b=vzQ(el,'.lbls');if(b)b.innerHTML='';vzA(el,'g.n').forEach(function(g){g.classList.remove('hl','bad','good','dim')});vzA(el,'.lk').forEach(function(l){l.classList.remove('on','ko')})}
function nkSet(el,id,cls){var g=vzQ(el,'g.n[data-n="'+id+'"]');if(g)g.classList.add(cls)}
function nkLk(el,a,b,cls){var l=vzQ(el,'[data-l="'+a+'-'+b+'"]')||vzQ(el,'[data-l="'+b+'-'+a+'"]');if(l)l.classList.add(cls||'on')}
// Étiquette fixe posée sur la scène (texte dans une pastille).
function nkLabel(el,x,y,t,cls){var w=nkTagW(t);vzQ(el,'.lbls').insertAdjacentHTML('beforeend','<g class="lbl '+(cls||'')+'" transform="translate('+x+','+y+')"><rect x="'+(-w/2)+'" y="-11" width="'+w+'" height="21" rx="10.5"/><text y="4">'+t+'</text></g>')}
// Version figée pour les illustrations : un paquet posé, sans animation.
function nkPkAt(x,y,tag,cls){return '<g transform="translate('+x+','+y+')">'+nkPk(tag,cls)+'</g>'}
function nkTerm(title){return '<div class="nk-term"><div class="nk-tb"><i></i><i></i><i></i><span>'+title+'</span></div><pre class="nk-tx"></pre></div>'}
function nkMsg(el,h){vzQ(el,'.vz-msg').innerHTML=h}


/* ── Scènes pas à pas, tableaux, cases à cocher, cartes de test ── */
var RSK_CSS='.rs-steps{display:flex;gap:4px;margin:12px 0 0}.rs-steps i{flex:1;height:5px;border-radius:999px;background:var(--line);transition:background-color .3s}.rs-steps i.on{background:var(--vd)}'
 +'.rs-envs{margin-top:12px}.rs-env{display:block;border-radius:12px;padding:8px 12px 10px;margin-top:6px;border:1.5px solid currentColor}'
 +'.rs-env>small{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:600;margin-bottom:6px}.rs-env>small i{font-style:normal;font-weight:400;font-family:ui-monospace,Menlo,monospace;opacity:.9}'
 +'.rs-env.d{background:var(--nk-paper);color:#6B5320;border-style:solid}.rs-env.d b{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:500;color:var(--ink)}'
 +'.rs-env.t{background:#F1ECFB;color:#5B34B0}.rs-env.i{background:#E8EFFC;color:#1E4FB8}.rs-env.e{background:#FDF0E2;color:#8A4B0B}.rs-env.hl{box-shadow:0 0 0 3px currentColor}.rs-env.new{animation:rsIn .35s}'
 +'@keyframes rsIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
 +'html[data-theme="dark"] .rs-env.d{color:#E3C98F}html[data-theme="dark"] .rs-env.t{background:#160F26;color:#C9B5F5}html[data-theme="dark"] .rs-env.i{background:#0E1626;color:#9DB8F2}html[data-theme="dark"] .rs-env.e{background:#22160A;color:#F5C08E}'
 +'.rs-tbl{width:100%;border-collapse:separate;border-spacing:0 4px;font-size:13px;margin-top:10px}.rs-tbl caption{text-align:left;font-size:12.5px;font-weight:600;color:var(--muted);padding-bottom:2px}'
 +'.rs-tbl th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:0 8px}.rs-tbl td{padding:7px 8px;background:var(--surface);font-family:ui-monospace,Menlo,monospace;font-size:12.5px;transition:background-color .3s,color .3s,opacity .5s}'
 +'.rs-tbl td:first-child{border-radius:10px 0 0 10px}.rs-tbl td:last-child{border-radius:0 10px 10px 0}.rs-tbl td.t{font-family:inherit}'
 +'.rs-tbl tr.ok td{background:#D4EEDD;color:#14532D}.rs-tbl tr.sel td{background:var(--vd);color:#fff}.rs-tbl tr.gone td{opacity:.25}.rs-tbl .empty td{color:var(--muted);font-family:inherit;text-align:center}'
 +'html[data-theme="dark"] .rs-tbl td{background:#000;box-shadow:inset 0 0 0 1px var(--line)}html[data-theme="dark"] .rs-tbl tr.ok td{background:#12301F;color:#A7E3BF;box-shadow:none}html[data-theme="dark"] .rs-tbl tr.sel td{box-shadow:none}'
 +'@media (max-width:520px){.rs-tbl td{font-size:11px;padding:6px 5px;word-break:break-all}}'
 +'.sn-addr{display:flex;flex-wrap:wrap;align-items:flex-end;gap:4px;margin:4px 0 12px}.sn-addr>i{font-style:normal;font-size:30px;line-height:52px;color:var(--muted)}'
 +'.sn-oct{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:66px;padding:8px 6px;border-radius:12px;transition:background-color .3s,color .3s}.sn-oct b{font-family:ui-monospace,Menlo,monospace;font-size:26px;font-weight:500}.sn-oct small{font-size:11.5px;font-weight:600}'
 +'.sn-oct.n{background:#E8EFFC;color:#1E4FB8}.sn-oct.h{background:#E3F4E8;color:#14532D}.sn-oct.m{background:#F1ECFB;color:#5B34B0}.sn-cidr{font-family:ui-monospace,Menlo,monospace;font-size:26px;line-height:52px;margin-left:6px;color:var(--vd);font-weight:600}'
 +'html[data-theme="dark"] .sn-oct.n{background:#0E1626;color:#9DB8F2}html[data-theme="dark"] .sn-oct.h{background:#0C2014;color:#A7E3BF}html[data-theme="dark"] .sn-oct.m{background:#160F26;color:#C9B5F5}'
 +'.sn-big{font-size:16px;line-height:1.5;margin:10px 0}.sn-bits{display:flex;flex-wrap:wrap;gap:8px;font-family:ui-monospace,Menlo,monospace;font-size:14px;margin:8px 0}.sn-bits span{display:flex;gap:1px}.sn-bits b{width:14px;text-align:center;border-radius:3px;font-weight:500;padding:2px 0}.sn-bits b.n{background:#E8EFFC;color:#1E4FB8}.sn-bits b.h{background:#E3F4E8;color:#14532D}'
 +'html[data-theme="dark"] .sn-bits b.n{background:#0E1626;color:#9DB8F2}html[data-theme="dark"] .sn-bits b.h{background:#0C2014;color:#A7E3BF}'
 +'.rs-in{font:inherit;font-family:ui-monospace,Menlo,monospace;font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:170px}html[data-theme="dark"] .rs-in{background:#000}'
 +'.rs-rule{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer}.rs-rule:last-child{border:0}.rs-rule input{accent-color:var(--vd);width:20px;height:20px;flex:none}'
 +'.rs-card{border-radius:14px;padding:6px 14px;background:var(--surface2);margin-top:10px}'
 +'.rs-tests{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:10px}'
 +'.rs-test{display:flex;align-items:center;gap:10px;border:0;border-radius:14px;padding:10px 12px;background:var(--surface2);color:var(--ink);font:inherit;text-align:left;cursor:pointer}'
 +'.rs-test b{display:block;font-size:14px;font-weight:600}.rs-test code{font-size:12px;color:var(--muted)}.rs-test .st{margin-left:auto;flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:700;background:var(--line);color:var(--muted)}'
 +'.rs-test.ok .st{background:#1F9D6B;color:#fff}.rs-test.ko .st{background:#D93025;color:#fff}.rs-test:hover{box-shadow:inset 0 0 0 2px var(--vd)}';
if(typeof document!=='undefined'&&document.createElement){var rss=document.createElement('style');rss.textContent=RSK_CSS;document.head.appendChild(rss)}
function rsSteps(n,i){var h='';for(var k=0;k<n;k++)h+='<i class="'+(k<=i?'on':'')+'"></i>';return h}
function rsNav(extra){return '<div class="vz-row" style="margin-top:12px"><button class="vz-btn pv">◀ Retour</button><button class="vz-btn nx on nk-go">Suivant ▶</button>'+(extra||'')+'</div>'}
// Une scène pas à pas : S = étapes {m: légende, go(el, rejouer): animation}.
function rsWalk(el,S,draw){var i=0;function show(anim){nkReset(el);vzQ(el,'.rs-steps').innerHTML=rsSteps(S.length,i);nkMsg(el,'<b>'+(i+1)+' / '+S.length+'</b> · '+S[i].m);if(draw)draw(i);if(S[i].go)S[i].go(el,anim);vzQ(el,'.pv').disabled=i===0;vzQ(el,'.nx').textContent=i===S.length-1?'Recommencer':'Suivant ▶'}
 vzQ(el,'.nx').onclick=function(){i=i===S.length-1?0:i+1;show(true)};vzQ(el,'.pv').onclick=function(){if(i>0){i--;show(false)}};show(false);return function(k){i=k;show(true)}}

var GI={};
function giSvg(w,h,body){return '<svg class="nk" viewBox="0 0 '+w+' '+h+'" role="img">'+body+'</svg>'}
function giWrap(svg,cap){return '<div class="vz gi">'+svg+(cap?'<div class="gi-c">'+cap+'</div>':'')+'</div>'}
function giSt(o,cap){var x=o.pk||[];o.extra=(o.extra||'');var s=nkStage(o);s=s.replace('<g class="pks"></g>','<g>'+x.map(function(p){return nkPkAt(p[0],p[1],p[2],p[3])}).join('')+'</g>');return giWrap(s,cap)}
function giLbl(x,y,t,cls){var w=nkTagW(t);return '<g class="lbl '+(cls||'')+'" transform="translate('+x+','+y+')"><rect x="'+(-w/2)+'" y="-11" width="'+w+'" height="21" rx="10.5"/><text y="4">'+t+'</text></g>'}
function giT(x,y,t,o){o=o||{};return '<text x="'+x+'" y="'+y+'" font-size="'+(o.s||14)+'" font-weight="'+(o.b?600:400)+'" fill="'+(o.c||'var(--ink)')+'" text-anchor="'+(o.a||'middle')+'"'+(o.m?' font-family="ui-monospace,Menlo,monospace"':'')+'>'+t+'</text>'}
// Une adresse découpée en morceaux colorés : [[texte, ton, légende], …]
function giPlate(parts,y){var x=20,s='';parts.forEach(function(p){var w=p[0].length*13+24,c={n:['#E8EFFC','#1E4FB8'],h:['#E3F4E8','#14532D'],m:['#F1ECFB','#5B34B0'],o:['#FDF0E2','#8A4B0B'],g:['var(--surface2)','var(--muted)']}[p[1]];
 s+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="46" rx="10" fill="'+c[0]+'"/>'+giT(x+w/2,y+30,p[0],{s:22,m:1,c:c[1]})+(p[2]?giT(x+w/2,y+66,p[2],{s:12.5,c:c[1],b:1}):'');x+=w+6});return s}

