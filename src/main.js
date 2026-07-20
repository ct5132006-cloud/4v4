import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const canvas = document.querySelector('#game-canvas');
const startScreen = document.querySelector('#start-screen');
const playButton = document.querySelector('#play-button');
const resumeButton = document.querySelector('#resume-button');
const pausePanel = document.querySelector('#pause-panel');
const hud = document.querySelector('#hud');
const radar = document.querySelector('#radar');
const radarContext = radar.getContext('2d');
const locationName = document.querySelector('#location-name');
const roundLabel = document.querySelector('#round-label');
const roundTimer = document.querySelector('#round-timer');
const ammoElement = document.querySelector('.ammo strong');
const menuStatus = document.querySelector('#menu-status');
const modeButtons = [...document.querySelectorAll('.mode-button')];
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const WORLD_WIDTH = 44;
const WORLD_DEPTH = 30;
const PLAYER_RADIUS = 0.38;
const STANDING_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.15;
const UP = new THREE.Vector3(0, 1, 0);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x929894);
scene.fog = new THREE.Fog(0x777e7a, 24, 76);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 140);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0.75;
scene.add(camera);

const clock = new THREE.Clock();
const solidBounds = [];
const solidMeshes = [];
const radarBlocks = [];
const spawnPads = [];
const impactMarks = [];
const keys = new Set();

let selectedTeamSize = 4;
let matchStarted = false;
let pendingMatchStart = false;
let pointerLockTimer = 0;
let lastRoundUpdate = performance.now();
let roundSeconds = 105;
let playerVerticalPosition = 0;
let verticalVelocity = 0;
let eyeHeight = STANDING_HEIGHT;
let bobTime = 0;
let ammo = 30;
let recoil = 0;
let muzzleTimer = 0;

const materials = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x6e7470, roughness: 0.92, metalness: 0.03 }),
  darkConcrete: new THREE.MeshStandardMaterial({ color: 0x3d4442, roughness: 0.95 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x343b3b, roughness: 0.58, metalness: 0.68 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x81563c, roughness: 0.82, metalness: 0.22 }),
  alpha: new THREE.MeshStandardMaterial({ color: 0x4d9bb7, roughness: 0.62, metalness: 0.18 }),
  bravo: new THREE.MeshStandardMaterial({ color: 0xc87c3f, roughness: 0.62, metalness: 0.18 }),
  signal: new THREE.MeshStandardMaterial({ color: 0xdce867, emissive: 0x37400d, emissiveIntensity: 0.35 }),
};

function createGroundTexture() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureCanvas.height = 512;
  const context = textureCanvas.getContext('2d');
  context.fillStyle = '#555b57';
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 4500; index += 1) {
    const shade = 70 + Math.floor(Math.random() * 35);
    context.fillStyle = `rgba(${shade}, ${shade + 4}, ${shade + 1}, ${Math.random() * 0.2})`;
    const size = Math.random() * 3;
    context.fillRect(Math.random() * 512, Math.random() * 512, size, size);
  }

  context.strokeStyle = 'rgba(18, 22, 21, .28)';
  context.lineWidth = 3;
  for (let position = 0; position <= 512; position += 64) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addBox({
  x,
  y,
  z,
  width,
  height,
  depth,
  material = materials.concrete,
  collidable = true,
  radarVisible = collidable,
  castShadow = true,
}) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  scene.add(mesh);

  if (collidable) {
    const bounds = new THREE.Box3().setFromObject(mesh);
    solidBounds.push(bounds);
    solidMeshes.push(mesh);
  }

  if (radarVisible) radarBlocks.push({ x, z, width, depth });
  return mesh;
}

function addStripe(x, z, width, depth, rotation = 0) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color: 0xd7c84c, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
  );
  stripe.position.set(x, 0.017, z);
  stripe.rotation.set(-Math.PI / 2, 0, rotation);
  scene.add(stripe);
}

function addSpawnPad(team, index, x, z) {
  const color = team === 'alpha' ? 0x63b8d5 : 0xe5964e;
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.69, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const center = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.004;
  group.add(center);
  group.position.set(x, 0.025, z);
  scene.add(group);
  spawnPads.push({ team, index, x, z, group });
}

function addContainer(x, z, material, rotation = 0) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.8, 2.55), material);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const ribMaterial = materials.metal;
  for (let offset = -2.55; offset <= 2.55; offset += 0.85) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.66, 2.59), ribMaterial);
    rib.position.x = offset;
    group.add(rib);
  }

  group.position.set(x, 1.4, z);
  group.rotation.y = rotation;
  scene.add(group);

  const horizontal = Math.abs(Math.sin(rotation)) < 0.5;
  const width = horizontal ? 5.6 : 2.55;
  const depth = horizontal ? 2.55 : 5.6;
  const proxy = new THREE.Box3(
    new THREE.Vector3(x - width / 2, 0, z - depth / 2),
    new THREE.Vector3(x + width / 2, 2.8, z + depth / 2),
  );
  solidBounds.push(proxy);
  solidMeshes.push(body);
  radarBlocks.push({ x, z, width, depth });
}

function buildArena() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshStandardMaterial({ map: createGroundTexture(), color: 0xa5aaa4, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Perímetro da arena.
  addBox({ x: 0, y: 2.5, z: -15.5, width: 45, height: 5, depth: 1, material: materials.darkConcrete });
  addBox({ x: 0, y: 2.5, z: 15.5, width: 45, height: 5, depth: 1, material: materials.darkConcrete });
  addBox({ x: -22.5, y: 2.5, z: 0, width: 1, height: 5, depth: 30, material: materials.darkConcrete });
  addBox({ x: 22.5, y: 2.5, z: 0, width: 1, height: 5, depth: 30, material: materials.darkConcrete });

  // Núcleo central: divide linhas de visão sem bloquear as três rotas.
  addBox({ x: 0, y: 1.8, z: 0, width: 3.8, height: 3.6, depth: 6.2, material: materials.metal });
  addBox({ x: 0, y: 0.75, z: -9.7, width: 5.5, height: 1.5, depth: 1.25, material: materials.concrete });
  addBox({ x: 0, y: 0.75, z: 9.7, width: 5.5, height: 1.5, depth: 1.25, material: materials.concrete });

  // Coberturas espelhadas para confrontos equilibrados.
  addContainer(-10.2, -8.2, materials.alpha);
  addContainer(10.2, 8.2, materials.bravo);
  addContainer(-5.9, 7.9, materials.rust, Math.PI / 2);
  addContainer(5.9, -7.9, materials.rust, Math.PI / 2);

  addBox({ x: -10.8, y: 1.35, z: 5.7, width: 4.8, height: 2.7, depth: 1.15, material: materials.concrete });
  addBox({ x: 10.8, y: 1.35, z: -5.7, width: 4.8, height: 2.7, depth: 1.15, material: materials.concrete });
  addBox({ x: -8.2, y: 0.65, z: 0, width: 2.2, height: 1.3, depth: 2.2, material: materials.darkConcrete });
  addBox({ x: 8.2, y: 0.65, z: 0, width: 2.2, height: 1.3, depth: 2.2, material: materials.darkConcrete });

  // Paredes de transição nas bases, com passagem pelo centro e pelas laterais.
  addBox({ x: -15.4, y: 1.2, z: -7.8, width: 1, height: 2.4, depth: 6.2, material: materials.concrete });
  addBox({ x: -15.4, y: 1.2, z: 7.8, width: 1, height: 2.4, depth: 6.2, material: materials.concrete });
  addBox({ x: 15.4, y: 1.2, z: -7.8, width: 1, height: 2.4, depth: 6.2, material: materials.concrete });
  addBox({ x: 15.4, y: 1.2, z: 7.8, width: 1, height: 2.4, depth: 6.2, material: materials.concrete });

  // Pequenas caixas ampliam as opções de cobertura nas rotas externas.
  for (const [x, z] of [[-17.8, -11.4], [-11.7, 11.6], [17.8, 11.4], [11.7, -11.6]]) {
    addBox({ x, y: 0.62, z, width: 1.5, height: 1.24, depth: 1.5, material: materials.rust });
  }

  // Estrutura industrial acima da arena — visual, sem colisão.
  for (const x of [-18, -9, 0, 9, 18]) {
    addBox({ x, y: 5.2, z: 0, width: 0.18, height: 0.18, depth: 31, material: materials.metal, collidable: false, radarVisible: false });
  }
  for (const z of [-14.5, 14.5]) {
    addBox({ x: 0, y: 4.7, z, width: 44, height: 0.22, depth: 0.22, material: materials.metal, collidable: false, radarVisible: false });
  }

  // Marcação de rotas e zonas de surgimento.
  for (const z of [-11.8, 0, 11.8]) addStripe(0, z, 8, 0.08);
  addStripe(-18.7, 0, 0.08, 22);
  addStripe(18.7, 0, 0.08, 22);

  [-6, -2, 2, 6].forEach((z, index) => {
    addSpawnPad('alpha', index, -19.2, z);
    addSpawnPad('bravo', index, 19.2, -z);
  });
}

function addLighting() {
  const hemisphere = new THREE.HemisphereLight(0xcbd5d2, 0x383832, 2.2);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff4d8, 4.2);
  sun.position.set(-16, 28, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0002;
  scene.add(sun);

  for (const [x, color] of [[-18, 0x62b9d6], [18, 0xe5964e]]) {
    const light = new THREE.PointLight(color, 6, 12, 2);
    light.position.set(x, 3.4, 0);
    scene.add(light);
  }
}

function addAtmosphere() {
  const positions = new Float32Array(420 * 3);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = (Math.random() - 0.5) * 54;
    positions[index + 1] = Math.random() * 10;
    positions[index + 2] = (Math.random() - 0.5) * 38;
  }
  const particles = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.PointsMaterial({ color: 0xe5d7b8, size: 0.035, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  particles.name = 'dust';
  scene.add(particles);
}

function createWeapon() {
  const weapon = new THREE.Group();
  weapon.name = 'weapon';

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.72), materials.metal);
  body.position.z = -0.18;
  weapon.add(body);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.34), materials.darkConcrete);
  receiver.position.set(0, 0.015, 0.14);
  weapon.add(receiver);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.035, 0.66, 12), materials.metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.73);
  weapon.add(barrel);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.38), materials.darkConcrete);
  stock.position.set(0, -0.015, 0.46);
  stock.rotation.x = -0.13;
  weapon.add(stock);

  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.16), materials.metal);
  magazine.position.set(0, -0.22, 0.06);
  magazine.rotation.x = 0.16;
  weapon.add(magazine);

  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.035, 0.17), materials.signal);
  accent.position.set(0, 0.135, 0.11);
  weapon.add(accent);

  const muzzleFlash = new THREE.PointLight(0xffb44d, 0, 4);
  muzzleFlash.name = 'muzzle-flash';
  muzzleFlash.position.set(0, 0.02, -1.08);
  weapon.add(muzzleFlash);

  weapon.position.set(0.46, -0.39, -0.72);
  weapon.rotation.set(-0.06, -0.06, 0);
  camera.add(weapon);
  return weapon;
}

function updateSpawnPads() {
  for (const pad of spawnPads) {
    pad.group.visible = pad.index < selectedTeamSize;
  }
  roundLabel.textContent = `${selectedTeamSize} VS ${selectedTeamSize} · AQUECIMENTO`;
}

function resetPlayer() {
  const localSpawn = spawnPads.find((pad) => pad.team === 'alpha' && pad.index === 0);
  camera.position.set(localSpawn?.x ?? -19.2, STANDING_HEIGHT, localSpawn?.z ?? -6);
  camera.rotation.set(0, -Math.PI / 2, 0);
  playerVerticalPosition = 0;
  verticalVelocity = 0;
  eyeHeight = STANDING_HEIGHT;
}

function collidesAt(x, z) {
  return solidBounds.some((bounds) => (
    x + PLAYER_RADIUS > bounds.min.x
    && x - PLAYER_RADIUS < bounds.max.x
    && z + PLAYER_RADIUS > bounds.min.z
    && z - PLAYER_RADIUS < bounds.max.z
  ));
}

function movePlayer(displacement) {
  const nextX = camera.position.x + displacement.x;
  if (!collidesAt(nextX, camera.position.z)) camera.position.x = nextX;

  const nextZ = camera.position.z + displacement.z;
  if (!collidesAt(camera.position.x, nextZ)) camera.position.z = nextZ;
}

function updateMovement(delta, elapsedTime) {
  if (!controls.isLocked) return;

  const forwardInput = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const strafeInput = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const isMoving = forwardInput !== 0 || strafeInput !== 0;
  const isCrouching = keys.has('ControlLeft') || keys.has('KeyC');
  const isSprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && forwardInput > 0 && !isCrouching;
  const speed = isCrouching ? 2.25 : isSprinting ? 6.7 : 4.4;

  if (isMoving) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    const direction = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(strafeInput)).normalize();
    movePlayer(direction.multiplyScalar(speed * delta));
    if (!prefersReducedMotion) bobTime += delta * (isSprinting ? 13 : 9);
  }

  const grounded = playerVerticalPosition <= 0.001;
  if (keys.has('Space') && grounded && !isCrouching) {
    verticalVelocity = 5.2;
    playerVerticalPosition = 0.01;
  }

  verticalVelocity -= 14.5 * delta;
  playerVerticalPosition += verticalVelocity * delta;
  if (playerVerticalPosition <= 0) {
    playerVerticalPosition = 0;
    verticalVelocity = 0;
  }

  const targetEyeHeight = isCrouching ? CROUCH_HEIGHT : STANDING_HEIGHT;
  eyeHeight = THREE.MathUtils.lerp(eyeHeight, targetEyeHeight, 1 - Math.exp(-12 * delta));
  const shouldBob = isMoving && playerVerticalPosition === 0 && !prefersReducedMotion;
  const bobAmount = shouldBob ? Math.sin(bobTime) * (isSprinting ? 0.045 : 0.025) : 0;
  camera.position.y = playerVerticalPosition + eyeHeight + bobAmount;

  const weapon = camera.getObjectByName('weapon');
  if (weapon) {
    weapon.position.x = 0.46 + (shouldBob ? Math.cos(bobTime * 0.5) * 0.012 : 0);
    weapon.position.y = -0.39 + (shouldBob ? Math.abs(Math.sin(bobTime)) * 0.014 : 0) + recoil * 0.08;
    weapon.rotation.x = -0.06 + recoil * 0.12;
  }

  recoil = Math.max(0, recoil - delta * 7);
  muzzleTimer = Math.max(0, muzzleTimer - delta);
  const muzzleFlash = weapon?.getObjectByName('muzzle-flash');
  if (muzzleFlash) muzzleFlash.intensity = muzzleTimer > 0 ? 22 : 0;

  const dust = scene.getObjectByName('dust');
  if (dust && !prefersReducedMotion) dust.rotation.y = elapsedTime * 0.008;
}

function shoot() {
  if (!controls.isLocked || ammo <= 0) return;
  ammo -= 1;
  ammoElement.textContent = String(ammo).padStart(2, '0');
  recoil = Math.min(1, recoil + 0.72);
  muzzleTimer = 0.045;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const [hit] = raycaster.intersectObjects(solidMeshes, false);
  if (!hit || hit.distance > 70) return;

  const impact = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x171918 }),
  );
  impact.position.copy(hit.point).addScaledVector(hit.face?.normal ?? UP, 0.012);
  scene.add(impact);
  impactMarks.push({ mesh: impact, createdAt: performance.now() });

  if (impactMarks.length > 24) {
    const oldest = impactMarks.shift();
    scene.remove(oldest.mesh);
    oldest.mesh.geometry.dispose();
    oldest.mesh.material.dispose();
  }
}

function reload() {
  if (ammo === 30) return;
  ammo = 30;
  ammoElement.textContent = '30';
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateLocation() {
  const { x, z } = camera.position;
  let label = 'CORREDOR CENTRAL';
  if (x < -15) label = 'BASE ALPHA';
  else if (x > 15) label = 'BASE BRAVO';
  else if (z < -6) label = 'ROTA NORTE';
  else if (z > 6) label = 'ROTA SUL';
  else if (Math.abs(x) < 3.5) label = 'NÚCLEO';
  locationName.textContent = label;
}

function worldToRadar(x, z) {
  const padding = 12;
  return {
    x: padding + ((x + WORLD_WIDTH / 2) / WORLD_WIDTH) * (radar.width - padding * 2),
    y: padding + ((z + WORLD_DEPTH / 2) / WORLD_DEPTH) * (radar.height - padding * 2),
  };
}

function drawRadar() {
  const context = radarContext;
  context.clearRect(0, 0, radar.width, radar.height);
  context.fillStyle = 'rgba(13, 18, 18, .93)';
  context.fillRect(0, 0, radar.width, radar.height);

  context.strokeStyle = 'rgba(255,255,255,.045)';
  context.lineWidth = 1;
  for (let x = 0; x <= radar.width; x += 22) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, radar.height); context.stroke();
  }
  for (let y = 0; y <= radar.height; y += 22) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(radar.width, y); context.stroke();
  }

  context.strokeStyle = 'rgba(219,226,219,.28)';
  context.strokeRect(10, 8, radar.width - 20, radar.height - 16);
  context.fillStyle = 'rgba(170,179,174,.22)';
  for (const block of radarBlocks) {
    const topLeft = worldToRadar(block.x - block.width / 2, block.z - block.depth / 2);
    const bottomRight = worldToRadar(block.x + block.width / 2, block.z + block.depth / 2);
    context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  for (const pad of spawnPads) {
    if (pad.index >= selectedTeamSize) continue;
    const point = worldToRadar(pad.x, pad.z);
    context.fillStyle = pad.team === 'alpha' ? '#63b8d5' : '#e5964e';
    context.globalAlpha = 0.7;
    context.beginPath(); context.arc(point.x, point.y, 2.2, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;

  const player = worldToRadar(camera.position.x, camera.position.z);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const angle = Math.atan2(direction.z, direction.x);
  context.save();
  context.translate(player.x, player.y);
  context.rotate(angle + Math.PI / 2);
  context.fillStyle = '#dce867';
  context.beginPath();
  context.moveTo(0, -7); context.lineTo(5, 5); context.lineTo(0, 3); context.lineTo(-5, 5); context.closePath();
  context.fill();
  context.restore();
}

function setMenuStatus(message, isError = false) {
  menuStatus.textContent = message;
  menuStatus.classList.toggle('is-error', isError);
}

function handlePointerLockFailure() {
  window.clearTimeout(pointerLockTimer);
  if (pendingMatchStart) {
    pendingMatchStart = false;
    startScreen.hidden = false;
    hud.hidden = true;
    pausePanel.hidden = true;
    setMenuStatus('O navegador bloqueou o controle do mouse. Clique em entrar e autorize o acesso.', true);
    playButton.focus();
  }
}

function requestGameLock(isStarting = false) {
  if (!('requestPointerLock' in document.body)) {
    setMenuStatus('Este navegador ou dispositivo não oferece controle de mouse para jogos 3D.', true);
    return;
  }

  if (isStarting) {
    if (pendingMatchStart) return;
    pendingMatchStart = true;
    setMenuStatus('Aguardando autorização para controlar o mouse…');
  }

  try {
    controls.lock();
    window.clearTimeout(pointerLockTimer);
    pointerLockTimer = window.setTimeout(handlePointerLockFailure, 1800);
  } catch {
    handlePointerLockFailure();
  }
}

function beginMatch() {
  requestGameLock(true);
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedTeamSize = Number(button.dataset.teamSize);
    modeButtons.forEach((candidate) => {
      const isSelected = candidate === button;
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });
    updateSpawnPads();
  });
});

playButton.addEventListener('click', beginMatch);
resumeButton.addEventListener('click', () => requestGameLock(false));
document.addEventListener('pointerlockerror', handlePointerLockFailure);

controls.addEventListener('lock', () => {
  window.clearTimeout(pointerLockTimer);
  keys.clear();

  if (pendingMatchStart) {
    pendingMatchStart = false;
    matchStarted = true;
    roundSeconds = 105;
    roundTimer.textContent = formatTime(roundSeconds);
    resetPlayer();
  }

  if (!matchStarted) return;
  lastRoundUpdate = performance.now();
  startScreen.hidden = true;
  pausePanel.hidden = true;
  hud.hidden = false;
});

controls.addEventListener('unlock', () => {
  keys.clear();
  window.clearTimeout(pointerLockTimer);
  if (!matchStarted) return;
  pausePanel.hidden = false;
  requestAnimationFrame(() => resumeButton.focus());
});

addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'Enter' && !startScreen.hidden) beginMatch();
  if (event.code === 'KeyR') reload();
});
addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('mousedown', (event) => {
  if (event.button === 0) shoot();
});
addEventListener('contextmenu', (event) => event.preventDefault());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
});

buildArena();
addLighting();
addAtmosphere();
createWeapon();
updateSpawnPads();
resetPlayer();
window.__K4_READY__ = true;

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsedTime = clock.elapsedTime;

  updateMovement(delta, elapsedTime);
  if (controls.isLocked) {
    const now = performance.now();
    const timerDelta = (now - lastRoundUpdate) / 1000;
    lastRoundUpdate = now;
    roundSeconds = Math.max(0, roundSeconds - timerDelta);
    roundTimer.textContent = formatTime(roundSeconds);
    updateLocation();
  }

  drawRadar();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
