// Надёжный BASE для GitHub Pages
const BASE =
  (import.meta?.env?.BASE_URL) ??
  (location.pathname.split('/').slice(0, 2).join('/') + '/');

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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

// Статичный красивый фон (градиент), не вращается при орбите
function makeGradientTexture(top = '#14151a', bottom = '#23252c') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeGradientTexture('#14151a', '#23252c');

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI / 2.05;

// страховка от системного скролла на мобильных
window.addEventListener('touchmove', (e) => {
  if (e.target === canvas) e.preventDefault();
}, { passive: false });

// ---------- Свет ----------
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

// ---------- HDR (только для освещения, фон остаётся градиентом) ----------
const pmrem = new THREE.PMREMGenerator(renderer);
const HDR_PRIMARY  = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr';
const HDR_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr';

function applyHDR(url) {
  return new Promise((resolve, reject) => {
    new RGBELoader().load(
      url,
      (hdr) => {
        const env = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        scene.environment = env; // отражения/IBL
        resolve();
      },
      undefined,
      reject
    );
  });
}
applyHDR(HDR_PRIMARY).catch(() => applyHDR(HDR_FALLBACK)).catch(() => {/* останется фон-градиент + лампы */});

// ---------- Контактная тень (аккуратная «пятнышко») ----------
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 }); // прозрачность тени
const shadowCircle = new THREE.Mesh(new THREE.CircleGeometry(1, 64), shadowMat);
shadowCircle.rotation.x = -Math.PI / 2;
shadowCircle.position.y = 0; // при мерцании можно -0.001
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
    url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now(); // cache-bust

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
    const radius = Math.max(size1.x, size1.z) * 0.55; // 0.45..0.65 по вкусу
    shadowCircle.scale.setScalar(radius);

    // камера/контролы
    const fov = camera.fov * (Math.PI / 180);
    const halfMax = Math.max(size1.x, size1.y) * 0.5;
    const dist = (halfMax / Math.tan(fov / 2)) * 1.2;
    camera.position.set(dist, dist * 0.6, dist);
    const targetY = Math.min(size1.y * 0.5, 1.2);
    controls.target.set(0, targetY, 0);
    controls.minDistance = dist * 0.4;
    controls.maxDistance = dist * 3;
    controls.update();

    // анимация (первая клипа)
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      mixer.clipAction(gltf.animations[0]).reset().play();
    }
  } catch (e) {
    console.error('Model load failed:', e);
  }
}

// ---------- Resize & loop ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();

  // фиксируем root-motion: модель остаётся на месте (без «уезда» по X/Z)
  if (modelRoot) {
    modelRoot.position.x = 0;
    modelRoot.position.z = 0;
    // Если клип крутит корень и это мешает демо:
    // modelRoot.rotation.y = 0;
  }

  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
})();

// ---------- Start ----------
console.log('BASE =', BASE, 'modelURL =', getModelUrl());
loadModel(getModelUrl());
