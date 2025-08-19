const BASE = (import.meta?.env?.BASE_URL) ?? '/';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const canvas = document.getElementById('app');

// Renderer / Scene / Camera
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014); // до HDR

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;

// HDR background/environment (локально из /public)
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader()
  .setPath('/') // public/
  .load('venice_sunset_1k.hdr', (hdr) => {
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    scene.background = env;
    scene.environment = env;
  }, undefined, () => {
    // fallback без HDR — просто цвет
    scene.background = new THREE.Color(0x101014);
  });

// Мягкий «пол»
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4, 64),
  new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.9, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// Loaders
const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
// Используем CDN-декодер, чтобы не таскать бинарники в репо
draco.setDecoderPath('https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/');
gltfLoader.setDRACOLoader(draco);

// State
let mixer = null;
let modelRoot = null;

// Utils
function getModelUrl() {
  const q = new URLSearchParams(location.search);
  return q.get('model') || '/avatar.glb'; // public/avatar.glb по умолчанию
}

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

    // Центр/масштаб
    modelRoot.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.6 / maxDim;
    modelRoot.scale.setScalar(scale);

    // Камера
    const dist = 2.2;
    camera.position.set(dist, dist * 0.8, dist);
    controls.target.set(0, size.y * 0.3 * scale, 0);
    controls.update();

    // Анимация — автозапуск первой
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(modelRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.reset().play();
    }
  } catch (e) {
    console.error('Model load failed:', e);
  }
}

// Resize & loop
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

// Start
loadModel(getModelUrl());
