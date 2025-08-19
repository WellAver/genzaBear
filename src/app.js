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
if (!canvas) {
  throw new Error('Canvas #app not found. Добавь <canvas id="app"></canvas> в index.html перед скриптом.');
}

// ---------- Renderer / Scene / Camera ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014); // пока HDR не загрузился

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;

// ---------- Освещение (резервное, чтобы не было "чёрного" даже без HDR) ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.55);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(3, 5, 2);
scene.add(dir);

// ---------- HDR background/environment ----------
const pmrem = new THREE.PMREMGenerator(renderer);
// рабочие HDR с PolyHaven (любой можно заменить на свой)
const HDR_PRIMARY  = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr';
const HDR_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr';

function applyHDR(url) {
  return new Promise((resolve, reject) => {
    new RGBELoader().load(
      url,
      (hdr) => {
        const env = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        scene.background = env;
        scene.environment = env;
        resolve();
      },
      undefined,
      reject
    );
  });
}

// пытаемся загрузить основной HDR, если не вышло — запасной
applyHDR(HDR_PRIMARY).catch(() => {
  console.warn('Primary HDR failed, trying fallback…');
  return applyHDR(HDR_FALLBACK);
}).catch(err => {
  console.warn('HDR load failed, keeping solid background:', err);
});



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
  // по умолчанию берём модель из /public/avatar.glb
  return q.get('model') || (BASE + 'avatar.glb');
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

    // нормализация и кадрирование
    modelRoot.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.6 / maxDim;
    modelRoot.scale.setScalar(scale);

    // камера
    const dist = 2.2;
    camera.position.set(dist, dist * 0.8, dist);
    controls.target.set(0, size.y * 0.3 * scale, 0);
    controls.update();

    // анимация — автозапуск первой
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.reset().play();
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
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
})();

// ---------- Start ----------
console.log('BASE =', BASE, 'modelURL =', getModelUrl());
loadModel(getModelUrl());
