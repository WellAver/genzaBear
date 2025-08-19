// Надёжный BASE для GitHub Pages:
// 1) сначала пробуем vite: import.meta.env.BASE_URL
// 2) если нет — берём из URL вида /<repo>/...
const BASE =
  (import.meta?.env?.BASE_URL) ??
  (location.pathname.split('/').slice(0, 2).join('/') + '/');

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// --- DOM ---
const canvas = document.getElementById('app');
if (!canvas) {
  throw new Error('Canvas #app not found. Убедись, что в index.html есть <canvas id="app"></canvas> перед скриптом.');
}

// --- Renderer / Scene / Camera ---
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

// --- HDR background/environment из /public ---
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader()
  .setPath(BASE) // критично для Pages
  .load(
    'venice_sunset_1k.hdr',
    (hdr) => {
      const env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      scene.background = env;
      scene.environment = env;
    },
    undefined,
    (err) => {
      console.warn('HDR load failed, fallback to solid color:', err);
      scene.background = new THREE.Color(0x101014);
    }
  );

// --- Ground (опционально) ---
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4, 64),
  new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.9, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// --- Loaders ---
const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/');
gltfLoader.setDRACOLoader(draco);

// --- State ---
let mixer = null;
let modelRoot = null;

// --- Utils ---
function getModelUrl() {
  const q = new URLSearchParams(location.search);
  // по умолчанию берём модель из /public/avatar.glb
  return q.get('model') || (BASE + 'avatar.glb');
}

// --- Load model ---
async function loadModel(url) {
  try {
    // cache-bust
    url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now();

    // cleanup
    if (mixer) { mixer.stopAllAction(); mixer = null; }
    if (modelRoot) {
      scene.remove(modelRoot);
      modelRoot.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.());
        }
      });
      modelRoot = null;
    }

    // load
    const gltf = await gltfLoader.loadAsync(url);
    modelRoot = gltf.scene;
    scene.add(modelRoot);

    // normalize & frame
    modelRoot.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.6 / maxDim;
    modelRoot.scale.setScalar(scale);

    // camera
    const dist = 2.2;
    camera.position.set(dist, dist * 0.8, dist);
    controls.target.set(0, size.y * 0.3 * scale, 0);
    controls.update();

    // animations (autoplay first)
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.reset().play();
    }
  } catch (e) {
    console.error('Model load failed:', e);
  }
}

// --- Resize & loop ---
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

// --- Start ---
console.log('BASE =', BASE, 'modelURL =', getModelUrl());
loadModel(getModelUrl());
