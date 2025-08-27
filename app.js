/*******************************
 * لا قاموس محلي — النتائج كلها من الـ API
 *******************************/

/*******************************
 * DOM
 *******************************/
const statusEl    = document.getElementById("status");
const fileInput   = document.getElementById("fileInput");
const pickBtn     = document.getElementById("pickBtn");
const dropArea    = document.getElementById("dropArea");
const previewImg  = document.getElementById("preview");
const videoEl     = document.getElementById("video");
const canvasEl    = document.getElementById("canvas");
const startCamBtn = document.getElementById("startCam");
const stopCamBtn  = document.getElementById("stopCam");
const captureBtn  = document.getElementById("capture");

const predictedEl = document.getElementById("predictedLabel");
const confEl      = document.getElementById("confidence");
const priceInput  = document.getElementById("price");

const caloriesOut = document.getElementById("calories");
const costOut     = document.getElementById("cost");
const proteinOut  = document.getElementById("protein");
const fiberOut    = document.getElementById("fiber");
const fatOut      = document.getElementById("fat");
const carbsOut    = document.getElementById("carbs");

/*******************************
 * حالة التطبيق
 *******************************/
let stream = null;
let lastAI = {
  labelEn: null,
  labelAr: null,
  score: 0,
  calories100g: null,
  protein100g: null,
  fiber100g: null,
  fat100g: null,
  carbs100g: null,
};

/*******************************
 * تهيئة
 *******************************/
initEvents();
statusEl.textContent = "جاهز ✅";

/*******************************
 * أحداث
 *******************************/
function initEvents(){
  pickBtn.addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", onFilePicked);

  ["dragenter","dragover"].forEach(ev=>{
    dropArea.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); dropArea.style.borderColor = "rgba(34,197,94,.6)";
    });
  });
  ["dragleave","drop"].forEach(ev=>{
    dropArea.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); dropArea.style.borderColor = "rgba(255,255,255,.18)";
    });
  });
  dropArea.addEventListener("drop", e=>{
    const file = e.dataTransfer.files?.[0];
    if(file) readImageFile(file);
  });

  startCamBtn.addEventListener("click", startCamera);
  stopCamBtn.addEventListener("click", stopCamera);
  captureBtn.addEventListener("click", captureFrame);

  priceInput.addEventListener("input", calcAndRender);
}

/*******************************
 * تحميل صورة ومعاينة
 *******************************/
function onFilePicked(e){
  const file = e.target.files?.[0];
  if(file) readImageFile(file);
}
function readImageFile(file){
  const reader = new FileReader();
  reader.onload = () => setPreview(reader.result);
  reader.readAsDataURL(file);
}
function setPreview(src){
  videoEl.classList.add("hidden");
  captureBtn.disabled = true;
  stopCamBtn.disabled = true;
  previewImg.src = src;
  previewImg.onload = () => classifyViaAPI();
}

/*******************************
 * كاميرا
 *******************************/
async function startCamera(){
  if(!isSecureContext()){
    alert("لتشغيل الكاميرا، شغّل الصفحة عبر HTTPS أو localhost.");
    return;
  }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    videoEl.srcObject = stream;
    videoEl.classList.remove("hidden");
    captureBtn.disabled = false;
    stopCamBtn.disabled = false;
  }catch(e){
    console.error(e);
    alert("تعذّر الوصول للكاميرا.");
  }
}
function stopCamera(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  videoEl.srcObject = null;
  videoEl.classList.add("hidden");
  captureBtn.disabled = true;
  stopCamBtn.disabled = true;
}
function captureFrame(){
  if(!stream) return;
  const v = videoEl, c = canvasEl;
  const w = v.videoWidth || 640, h = v.videoHeight || 480;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(v, 0, 0, w, h);
  const dataURL = c.toDataURL("image/jpeg", 0.9);
  setPreview(dataURL);
}

/*******************************
 * API: تصنيف عام + قيم غذائية لكل 100غ
 *******************************/
function imageToDataURL(imgEl){
  return new Promise((resolve)=>{
    const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(imgEl, 0, 0, W, H);
    resolve(c.toDataURL("image/jpeg", 0.9));
  });
}

async function classifyViaAPI(){
  try{
    statusEl.textContent = "جاري تحليل الصورة…";
    const dataURL = await imageToDataURL(previewImg);

    const resp = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: dataURL })
    });

    const out = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("API error:", out);
      predictedEl.textContent = "خطأ في التصنيف";
      confEl.textContent = out?.details?.error?.message || out?.message || "server error";
      statusEl.textContent = "جاهز ❗️";
      return;
    }

    lastAI = {
      labelEn: (out.label || "unknown").toLowerCase(),
      labelAr: out.label_ar || "غير معروف",
      score: typeof out.score === "number" ? out.score : 0,
      calories100g: toNumOrNull(out.calories_100g),
      protein100g:  toNumOrNull(out.protein_100g),
      fiber100g:    toNumOrNull(out.fiber_100g),
      fat100g:      toNumOrNull(out.fat_100g),
      carbs100g:    toNumOrNull(out.carbs_100g),
    };

    predictedEl.textContent = lastAI.labelAr;
    confEl.textContent = `الثقة: ${(lastAI.score*100).toFixed(1)}% (${lastAI.labelEn})`;

    statusEl.textContent = "جاهز ✅";
    calcAndRender();
  }catch(e){
    console.error(e);
    predictedEl.textContent = "خطأ في التصنيف";
    confEl.textContent = "—";
    statusEl.textContent = "جاهز ❗️";
  }
}

/*******************************
 * الحسابات والعرض (لكل 100غ)
 *******************************/
function calcAndRender(){
  // السعرات
  setOrDash(caloriesOut, intOrDash(lastAI.calories100g));

  // الماكروز
  setOrDash(proteinOut,  fix1OrDash(lastAI.protein100g));
  setOrDash(fiberOut,    fix1OrDash(lastAI.fiber100g));
  setOrDash(fatOut,      fix1OrDash(lastAI.fat100g));
  setOrDash(carbsOut,    fix1OrDash(lastAI.carbs100g));

  // التكلفة لكل 100غ = 0.1 × سعر الكيلو
  const priceKg = parseFloat(priceInput.value || "0");
  if(!isNaN(priceKg) && priceKg > 0){
    const cost100g = priceKg * 0.1;
    costOut.textContent = cost100g.toFixed(2);
  }else{
    costOut.textContent = "—";
  }
}

/*******************************
 * مساعدات عرض
 *******************************/
function toNumOrNull(v){ return (typeof v === "number" && isFinite(v)) ? v : null; }
function intOrDash(v){ return (typeof v === "number" && isFinite(v)) ? Math.round(v) : "—"; }
function fix1OrDash(v){ return (typeof v === "number" && isFinite(v)) ? v.toFixed(1) : "—"; }
function setOrDash(el, val){ el.textContent = (val === null || val === undefined || val === "") ? "—" : val; }

/*******************************
 * أمان الكاميرا محليًا
 *******************************/
function isSecureContext(){
  try{
    if (window.isSecureContext) return true;
    const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    return isLocalhost;
  }catch{ return false; }
}
