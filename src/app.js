// Надёжный BASE для GitHub Pages
const BASE =
  (import.meta?.env?.BASE_URL) ??
  (location.pathname.split('/').slice(0, 2).join('/') + '/');

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// ---------- DOM ----------
const canvas = document.getElementById('app');
if (!canvas) throw new Error('Canvas #app not found. Добавь <canvas id="app"></canvas> перед скриптом.');
canvas.style.touchAction = 'none'; // все жесты в канвас

// ---------- Renderer / Scene / Camera ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 2.2);
camera.lookAt(0, 1.0, 0);

// ---------- Свет (резерв) ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(3, 5, 2);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.radius = 4;
dir.shadow.camera.near = 0.1;
dir.shadow.camera.far  = 20;
dir.shadow.camera.left = -3;
dir.shadow.camera.right = 3;
dir.shadow.camera.top = 3;
dir.shadow.camera.bottom = -3;
scene.add(dir);

// ---------- HDRI для освещения (PMREM), фон визуально — отдельный скайдом ----------
const pmrem = new THREE.PMREMGenerator(renderer);

// HDRI свет
new RGBELoader().load(
  BASE + 'bg.hdr',
  (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.colorSpace = THREE.SRGBColorSpace;
    scene.environment = pmrem.fromEquirectangular(hdr).texture; // IBL/отражения
  },
  undefined,
  () => { /* если нет hdr — останутся лампы */ }
);

// Скайдом для фона (крутим как объект)
let skydome = null;
new THREE.TextureLoader().load(
  BASE + 'bg_sky.jpg',
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const geo = new THREE.SphereGeometry(50, 64, 64);
    skydome = new THREE.Mesh(geo, mat);
    skydome.rotation.y = 0;
    scene.add(skydome);
  },
  undefined,
  (err) => console.warn('bg_sky.jpg load failed:', err)
);

// ---------- Контактная тень ----------
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 });
const shadowCircle = new THREE.Mesh(new THREE.CircleGeometry(1, 64), shadowMat);
shadowCircle.rotation.x = -Math.PI / 2;
shadowCircle.position.y = 0;
shadowCircle.receiveShadow = true;
scene.add(shadowCircle);

// ---------- Loaders ----------
const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/');
gltfLoader.setDRACOLoader(draco);

// ---------- State ----------
let mixer = null;
let modelRoot = null;

// ---------- Utils ----------
function getModelUrl() {
  const q = new URLSearchParams(location.search);
  return q.get('model') || (BASE + 'avatar.glb'); // /public/avatar.glb по умолчанию
}

// ---------- Load model ----------
async function loadModel(url) {
  try {
    url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now();

    if (mixer) { mixer.stopAllAction(); mixer = null; }
    if (modelRoot) {
      scene.remove(modelRoot);
      modelRoot.traverse(o => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.());
        }
      });
      modelRoot = null;
    }

    const gltf = await gltfLoader.loadAsync(url);
    modelRoot = gltf.scene;
    scene.add(modelRoot);

    // нормализация/масштаб
    modelRoot.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });

    // центр к (0,0,0)
    const box0 = new THREE.Box3().setFromObject(modelRoot);
    const size0 = new THREE.Vector3(); box0.getSize(size0);
    const center0 = new THREE.Vector3(); box0.getCenter(center0);
    modelRoot.position.sub(center0);

    // масштаб под кадр
    const maxDim = Math.max(size0.x, size0.y, size0.z) || 1;
    const scale = 1.6 / maxDim;
    modelRoot.scale.setScalar(scale);

    // поднять так, чтобы низ модели был на y = 0
    const box1 = new THREE.Box3().setFromObject(modelRoot);
    const size1 = box1.getSize(new THREE.Vector3());
    const minY = box1.min.y;
    modelRoot.position.y -= minY;

    // радиус контактной тени под габарит XZ
    const radius = Math.max(size1.x, size1.z) * 0.55;
    shadowCircle.scale.setScalar(radius);

    // анимация
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      mixer.clipAction(gltf.animations[0]).reset().play();
    }
  } catch (e) {
    console.error('Model load failed:', e);
  }
}

// ---------- Character-only Rotate Controller ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragging = false;
let lastX = 0;
let lastY = 0;

const ROTATE_X_SENS = 0.005; // наклон
const ROTATE_Y_SENS = 0.01;  // поворот вокруг Y
const MAX_TILT = Math.PI / 6; // ±30°

function pointerToNDC(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = (('touches' in ev ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width;
  const y = (('touches' in ev ? ev.touches[0].clientY : ev.clientY) - rect.top) / rect.height;
  ndc.set(x * 2 - 1, -(y * 2 - 1));
}

function onPointerDown(ev) {
  pointerToNDC(ev);
  if (!modelRoot) return;

  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(modelRoot, true);
  if (hits.length > 0) {
    dragging = true;
    lastX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
    lastY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
    ev.preventDefault();
  }
}
function onPointerMove(ev) {
  if (!dragging || !modelRoot) return;
  const x = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
  const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
  const dx = x - lastX;
  const dy = y - lastY;
  lastX = x; lastY = y;

  modelRoot.rotation.y += dx * ROTATE_Y_SENS;
  modelRoot.rotation.x = THREE.MathUtils.clamp(
    modelRoot.rotation.x + dy * ROTATE_X_SENS,
    -MAX_TILT, MAX_TILT
  );
  ev.preventDefault();
}
function onPointerUp() { dragging = false; }

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);

canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
window.addEventListener('touchend', onPointerUp);

// Запрещаем колесом скроллить страницу
canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// ---------- Resize & loop ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// скорость вращения купола (рад/сек) — подбери по вкусу
const SKY_ROT_SPEED = 0.05;

const clock = new THREE.Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();

  // плавное вращение купола
  if (skydome) skydome.rotation.y += SKY_ROT_SPEED * dt;

  // фиксируем root-motion: модель остаётся на месте
  if (modelRoot) {
    modelRoot.position.x = 0;
    modelRoot.position.z = 0;
  }

  mixer?.update(dt);
  renderer.render(scene, camera);
})();

// ---------- Start ----------
console.log('BASE =', BASE, 'modelURL =', getModelUrl());
loadModel(getModelUrl());
