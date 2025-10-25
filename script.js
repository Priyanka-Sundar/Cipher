// === Cipher Pixel Chaos JS ===

let blazefaceModel = null;
let useFaceDetector = ('FaceDetector' in window);
let detector = null;

// Elements
const els = {
  imageInput: document.getElementById('imageInput'),
  previewImg: document.getElementById('previewImg'),
  previewCanvas: document.getElementById('previewCanvas'),
  resultPanel: document.getElementById('resultPanel'),
  resultTitle: document.getElementById('resultTitle'),
  explain: document.getElementById('explain'),
  retryBtn: document.getElementById('retryBtn'),
  downloadReportBtn: document.getElementById('downloadReportBtn'),
  statVisitors: document.getElementById('statVisitors'),
  statUploads: document.getElementById('statUploads'),
  statReal: document.getElementById('statReal'),
  statFake: document.getElementById('statFake'),
  subscribeForm: document.getElementById('subscribeForm'),
  subFeedback: document.getElementById('subFeedback'),
  issueField: document.getElementById('issue'),
  emailField: document.getElementById('email')
};

// Community stats
const stats = { visits: 0, uploads: 0, real: 0, fake: 0 };

// Load stats from localStorage
function loadStats(){
  try { Object.assign(stats, JSON.parse(localStorage.getItem('cipher_stats') || '{}')); }
  catch(e){}
  renderStats();
}

// Save stats
function saveStats(){ localStorage.setItem('cipher_stats', JSON.stringify(stats)); }

// Render stats in DOM
function renderStats(){
  els.statVisitors.textContent = stats.visits||0;
  els.statUploads.textContent = stats.uploads||0;
  els.statReal.textContent = stats.real||0;
  els.statFake.textContent = stats.fake||0;
}

// Increment visits
function bumpVisit(){ stats.visits = (stats.visits||0)+1; saveStats(); renderStats(); }

// Initialize face detectors
async function initDetectors(){
  if(useFaceDetector){
    try { detector = new FaceDetector({fastMode:true, maxDetectedFaces:2}); }
    catch(e){ useFaceDetector=false; }
  }
  if(!useFaceDetector){
    blazefaceModel = await blazeface.load();
  }
}

// Convert data URL to Image
function dataURLToImage(url){
  return new Promise((res,rej)=>{
    const img = new Image();
    img.onload = ()=>res(img);
    img.onerror = rej;
    img.src = url;
  });
}

// Detect faces
async function detectFaces(img){
  if(useFaceDetector && detector){
    try {
      const faces = await detector.detect(img);
      return faces.map(f => ({
        box: { x:f.boundingBox.x, y:f.boundingBox.y, width:f.boundingBox.width, height:f.boundingBox.height },
        landmarks: (f.landmarks||[]).map(p=>({x:p.x, y:p.y})),
        prob: f.score || 0.95
      }));
    } catch(e){}
  }
  if(blazefaceModel){
    const preds = await blazefaceModel.estimateFaces(img, false);
    return preds.map(p=>{
      const tl=p.topLeft, br=p.bottomRight;
      const box={x:tl[0], y:tl[1], width:br[0]-tl[0], height:br[1]-tl[1]};
      return { box, landmarks: (p.landmarks||[]).map(l=>({x:l[0], y:l[1]})), prob: p.probability||0.9 };
    });
  }
  return [];
}

// Draw image to canvas
function drawToCanvas(img, maxW=900){
  const canvas = els.previewCanvas;
  const ratio = Math.min(1, maxW/img.width);
  canvas.width = Math.round(img.width*ratio);
  canvas.height = Math.round(img.height*ratio);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return ctx;
}

// Compute sharpness & texture variance
function computeSharpnessAndTexture(ctx){
  const w=ctx.canvas.width, h=ctx.canvas.height;
  const data=ctx.getImageData(0,0,w,h).data;
  const gray=new Float32Array(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++) gray[p]=0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2];

  let sum=0, sumSq=0;
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const idx=y*w+x;
      const lap = (
        -1*gray[idx-w-1]+ -1*gray[idx-w]+ -1*gray[idx-w+1]+
        -1*gray[idx-1]+ 8*gray[idx]+ -1*gray[idx+1]+
        -1*gray[idx+w-1]+ -1*gray[idx+w]+ -1*gray[idx+w+1]
      );
      sum += Math.abs(lap);
      sumSq += lap*lap;
    }
  }
  const mean=sum/((w-2)*(h-2));
  const variance=sumSq/((w-2)*(h-2)) - mean*mean;

  let mu=0; for(let i=0;i<gray.length;i++) mu+=gray[i]; mu/=gray.length;
  let varL=0; for(let i=0;i<gray.length;i++) varL+=(gray[i]-mu)*(gray[i]-mu); varL/=gray.length;

  return { sharpness: mean, lapVar: variance, textureVar: varL };
}

// Compute landmark symmetry
function computeLandmarkSymmetry(landmarks){
  if(!landmarks || landmarks.length<3) return null;
  const sorted=[...landmarks].sort((a,b)=>a.x-b.x);
  const left=sorted[0], right=sorted[sorted.length-1], mid=sorted[Math.floor(sorted.length/2)];
  const dL=Math.hypot(left.x-mid.x, left.y-mid.y);
  const dR=Math.hypot(right.x-mid.x, right.y-mid.y);
  return Math.abs(dL-dR)/((dL+dR)/2 + 1e-6);
}

// Compute fake score
function computeFakeScore(metrics){
  const sharpNorm=Math.tanh(metrics.sharpness/10);
  const textureNorm=Math.tanh(metrics.textureVar/1000);
  const symNorm=Math.tanh((metrics.symmetry||0.5)*3);
  const fakeFromSharp=1-sharpNorm;
  const fakeFromTexture=1-textureNorm;
  const fakeFromSym=symNorm;
  const fakeFromConf=1-(metrics.prob||0.9);
  const score=0.45*fakeFromSharp + 0.25*fakeFromTexture + 0.2*fakeFromSym + 0.1*fakeFromConf;
  return Math.max(0, Math.min(1, score));
}

// Format explanation text
function formatExplanation(metrics,fakeScore){
  const lines=[];
  lines.push(`Confidence: ${(metrics.prob*100).toFixed(1)}%`);
  lines.push(`Sharpness: ${metrics.sharpness.toFixed(2)}`);
  lines.push(`Texture variance: ${metrics.textureVar.toFixed(2)}`);
  lines.push(`Landmark symmetry: ${metrics.symmetry!==null?metrics.symmetry.toFixed(3):'n/a'}`);
  lines.push(`Deepfake score: ${(fakeScore*100).toFixed(1)}%`);
  if(fakeScore>0.65) lines.push('\nVerdict: Likely synthetic');
  else if(fakeScore>0.35) lines.push('\nVerdict: Ambiguous');
  else lines.push('\nVerdict: Likely real human image');
  return lines.join('\n');
}

// Show results
function showResult(title,text){
  els.resultPanel.classList.remove('hidden');
  els.resultTitle.textContent = title;
  els.explain.textContent = text;
}

// Handle image upload
els.imageInput.addEventListener('change', async ev=>{
  const file=ev.target.files[0];
  if(!file || !file.type.startsWith('image/')) return alert('Upload an image file.');
  const reader=new FileReader();
  reader.onload=async e=>{
    const img=await dataURLToImage(e.target.result);
    const ctx=drawToCanvas(img,800);
    els.previewCanvas.hidden=false;
    els.previewImg.hidden=true;
    await runAnalysis(img);
  };
  reader.readAsDataURL(file);
});

// Run analysis
async function runAnalysis(img){
  stats.uploads=(stats.uploads||0)+1; saveStats(); renderStats();

  const faces=await detectFaces(img);
  if(!faces.length){ showResult('No face detected','We couldn’t find a human face. Try again.'); return; }
  if(faces.length>1){ showResult('Multiple faces detected','Please upload an image with a single person.'); return; }

  const face=faces[0];
  const ctx=els.previewCanvas.getContext('2d');
  ctx.strokeStyle='#ff99c8';
  ctx.lineWidth=3;
  ctx.strokeRect(face.box.x,face.box.y,face.box.width,face.box.height);

  const faceCanvas=document.createElement('canvas');
  faceCanvas.width=Math.round(face.box.width);
  faceCanvas.height=Math.round(face.box.height);
  const fctx=faceCanvas.getContext('2d');
  fctx.drawImage(els.previewCanvas,face.box.x,face.box.y,face.box.width,face.box.height,0,0,face.box.width,face.box.height);

  const metrics=computeSharpnessAndTexture(fctx);
  metrics.symmetry=computeLandmarkSymmetry(face.landmarks);
  metrics.prob=face.prob||0.9;
  const fakeScore=computeFakeScore(metrics);
  const explanation=formatExplanation(metrics,fakeScore);

  const verdict=fakeScore>0.65?'Likely Fake':fakeScore>0.35?'Ambiguous':'Likely Real';
  showResult(verdict,explanation);

  if(fakeScore>0.65) stats.fake=(stats.fake||0)+1; else stats.real=(stats.real||0)+1;
  saveStats(); renderStats();

  window._lastReport={ ts:new Date().toISOString(), metrics, fakeScore };
}

// Retry button
els.retryBtn.addEventListener('click', ()=>{
  els.resultPanel.classList.add('hidden');
  els.previewImg.hidden=true;
  els.previewCanvas.hidden=true;
  els.imageInput.value='';
});

// Download report button
els.downloadReportBtn.addEventListener('click', ()=>{
  const rep=window._lastReport;
  if(!rep) return alert('No report yet.');
  const blob=new Blob([JSON.stringify(rep,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`cipher_report_${(new Date()).toISOString().replace(/[:.]/g,'-')}.json`;
  a.click(); URL.revokeObjectURL(url);
});

// Subscribe form
els.subscribeForm.addEventListener('submit', e=>{
  e.preventDefault();
  const email=els.emailField.value.trim();
  if(!email||!email.includes('@')){ els.subFeedback.textContent='enter valid email'; return; }
  const list=JSON.parse(localStorage.getItem('cipher_subs')||'[]');
  list.push({ email, note: els.issueField.value.trim(), ts:new Date().toISOString() });
  localStorage.setItem('cipher_subs',JSON.stringify(list));
  els.subFeedback.textContent='thanks!';
  els.subscribeForm.reset();
  setTimeout(()=>els.subFeedback.textContent='',2000);
});

// Init
(async function(){
  loadStats();
  bumpVisit();
  await initDetectors();
})();
// Store each analyzed upload
function storeUpload(dataURL,fakeScore){
  const list = JSON.parse(localStorage.getItem('cipher_uploads')||'[]');
  list.push({ dataURL, fakeScore, ts: new Date().toISOString() });
  localStorage.setItem('cipher_uploads', JSON.stringify(list));
}

// Update in runAnalysis
if(fakeScore>0.65) stats.fake=(stats.fake||0)+1; else stats.real=(stats.real||0)+1;
storeUpload(els.previewCanvas.toDataURL(), fakeScore);
saveStats(); renderStats();
const explain = document.getElementById('explain');
const aiComment = document.getElementById('aiComment');
const confidenceFill = document.getElementById('confidenceFill');

function fakeAnalyze() {
  const fakeConfidence = Math.floor(Math.random() * 100);
  const verdict = fakeConfidence > 60 ? "Possible Deepfake ⚠️" : "Likely Real ✅";
  document.getElementById('resultTitle').textContent = verdict;
  confidenceFill.style.width = fakeConfidence + "%";
  explain.textContent = `Analysis completed.\nConfidence: ${fakeConfidence}%\nDetails: low-frequency pixel inconsistencies detected.`;
  aiComment.textContent = fakeConfidence > 60 
    ? "CipherBot: This one feels... digitally haunted."
    : "CipherBot: Organic patterns detected. Looks human to me!";
  document.getElementById('resultPanel').classList.remove('hidden');
}

// Mock analysis trigger when image uploaded
document.getElementById('imageInput').addEventListener('change', ()=>{
  setTimeout(fakeAnalyze, 1500);
});
