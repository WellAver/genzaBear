// src/app.js
import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.165.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.165.0/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'https://unpkg.com/three@0.165.0/examples/jsm/loaders/RGBELoader.js';

const canvas = document.getElementById('app');

// --- renderer / scene / camera ---
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

// --- HDR background/environment (как у Marco) ---
const pmrem = new THREE.PMREMGenerator(renderer);
const HDR_URL = 'https://marcofugaro.github.io/threejs-modern-app/assets/venice_sunset_1k.hdr';

new RGBELoader().load(HDR_URL, (hdr) => {
  const env = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  scene.background = env;     // фон = HDR
  scene.environment = env;    // отражения = HDR
});

// --- optional: мягкий «пол» (почти не виден, но даёт опору) ---
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4, 64),
  new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.9, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// --- loaders ---
const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/');
gltfLoader.setDRACOLoader(draco);

// --- state ---
let mixer = null;
let modelRoot = null;
let actions = [];
let currentAction = null;

// --- utils ---
function getModelUrl() {
  const q = new URLSearchParams(location.search);
  return q.get('model') || './avatar.glb';
}

async function loadModel(url) {
  // cache-bust для мгновенного обновления
  url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now();

  // cleanup
  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(modelRoot); mixer = null; }
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        // материал может быть массивом
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m?.dispose?.());
      }
    });
    modelRoot = null;
  }
  actions = [];
  currentAction = null;

  // load
  const gltf = await gltfLoader.loadAsync(url);
  modelRoot = gltf.scene;
  scene.add(modelRoot);

  // normalize & frame
  modelRoot.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  modelRoot.position.sub(center); // в (0,0,0)

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1.6 / maxDim; // комфортный размер в кадре
  modelRoot.scale.setScalar(scale);

  // camera frame
  const dist = 2.2;
  camera.position.set(dist, dist * 0.8, dist);
  controls.target.set(0, size.y * 0.3 * scale, 0);
  controls.update();

  // animations: автозапуск первого клипа
  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(modelRoot);
    actions = gltf.animations.map(clip => mixer.clipAction(clip));
    currentAction = actions[0];
    currentAction.reset().play();
  }
}

// --- resize & loop ---
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
})();

// --- start ---
loadModel(getModelUrl());
