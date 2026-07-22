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

  // Materiais premium para a arma
  const gunmetalDark = new THREE.MeshStandardMaterial({ 
    color: 0x1a1d21, 
    roughness: 0.35, 
    metalness: 0.85,
    envMapIntensity: 1.2
  });
  const gunmetalMedium = new THREE.MeshStandardMaterial({ 
    color: 0x2d3238, 
    roughness: 0.4, 
    metalness: 0.75 
  });
  const gunmetalLight = new THREE.MeshStandardMaterial({ 
    color: 0x4a5259, 
    roughness: 0.3, 
    metalness: 0.9 
  });
  const carbonFiber = new THREE.MeshStandardMaterial({ 
    color: 0x151515, 
    roughness: 0.5, 
    metalness: 0.3,
    bumpScale: 0.002
  });
  const orangeGlow = new THREE.MeshStandardMaterial({ 
    color: 0xff6b35, 
    roughness: 0.25, 
    metalness: 0.8, 
    emissive: 0xff4500, 
    emissiveIntensity: 0.25 
  });
  const tacticalBlack = new THREE.MeshStandardMaterial({ 
    color: 0x0f0f0f, 
    roughness: 0.6, 
    metalness: 0.4 
  });
  const brushedMetal = new THREE.MeshStandardMaterial({ 
    color: 0x6b7280, 
    roughness: 0.2, 
    metalness: 0.95 
  });

  // Upper receiver com design angular moderno
  const upperReceiverShape = new THREE.Shape();
  upperReceiverShape.moveTo(-0.11, 0);
  upperReceiverShape.lineTo(0.11, 0);
  upperReceiverShape.lineTo(0.11, 0.19);
  upperReceiverShape.lineTo(0.08, 0.22);
  upperReceiverShape.lineTo(-0.08, 0.22);
  upperReceiverShape.lineTo(-0.11, 0.19);
  upperReceiverShape.closePath();
  
  const upperReceiverGeo = new THREE.ExtrudeGeometry(upperReceiverShape, { depth: 0.52, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
  const upperReceiver = new THREE.Mesh(upperReceiverGeo, gunmetalDark);
  upperReceiver.position.set(0, 0.025, -0.03);
  upperReceiver.castShadow = true;
  weapon.add(upperReceiver);

  // Rail superior (Picatinny)
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.48), tacticalBlack);
  topRail.position.set(0, 0.23, -0.02);
  weapon.add(topRail);
  
  // Detalhes do rail superior
  for (let i = 0; i < 12; i++) {
    const railSegment = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.008, 0.025), gunmetalLight);
    railSegment.position.set(0, 0.245, -0.22 + i * 0.04);
    weapon.add(railSegment);
  }

  // Lower receiver ergonômico
  const lowerReceiverShape = new THREE.Shape();
  lowerReceiverShape.moveTo(-0.1, 0);
  lowerReceiverShape.lineTo(0.1, 0);
  lowerReceiverShape.lineTo(0.1, 0.16);
  lowerReceiverShape.lineTo(0.06, 0.16);
  lowerReceiverShape.lineTo(0.04, 0.14);
  lowerReceiverShape.lineTo(-0.04, 0.14);
  lowerReceiverShape.lineTo(-0.06, 0.16);
  lowerReceiverShape.lineTo(-0.1, 0.16);
  lowerReceiverShape.closePath();
  
  const lowerReceiverGeo = new THREE.ExtrudeGeometry(lowerReceiverShape, { depth: 0.38, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  const lowerReceiver = new THREE.Mesh(lowerReceiverGeo, gunmetalMedium);
  lowerReceiver.position.set(0, -0.175, 0.06);
  lowerReceiver.castShadow = true;
  weapon.add(lowerReceiver);

  // Cano fluted (ranhurado) premium
  const barrelGroup = new THREE.Group();
  const barrelCore = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.68, 8), gunmetalLight);
  barrelCore.rotation.x = Math.PI / 2;
  barrelCore.position.set(0, 0, 0);
  barrelGroup.add(barrelCore);
  
  // Flutes (ranhuras) no cano
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const flute = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.62, 1),
      gunmetalDark
    );
    flute.scale.set(1, 0.3, 0.6);
    flute.rotation.x = Math.PI / 2;
    flute.rotation.z = angle;
    flute.position.set(Math.cos(angle) * 0.032, Math.sin(angle) * 0.032, 0);
    barrelGroup.add(flute);
  }
  
  barrelGroup.position.set(0, 0.025, -0.66);
  weapon.add(barrelGroup);

  // Muzzle brake tático avançado
  const muzzleBrake = new THREE.Group();
  const brakeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.035, 0.14, 12), gunmetalDark);
  brakeCore.rotation.x = Math.PI / 2;
  muzzleBrake.add(brakeCore);
  
  // Ports laterais do freio de boca
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i++) {
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8),
        tacticalBlack
      );
      port.rotation.z = Math.PI / 2;
      port.position.set(side * 0.025, 0, -0.05 + i * 0.035);
      muzzleBrake.add(port);
    }
  }
  
  muzzleBrake.position.set(0, 0.025, -1.04);
  weapon.add(muzzleBrake);

  // Handguard modular com M-LOK
  const handguard = new THREE.Group();
  
  // Corpo principal do handguard
  const handguardCore = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.46, 8), gunmetalMedium);
  handguardCore.rotation.x = Math.PI / 2;
  handguard.add(handguardCore);
  
  // Slots M-LOK
  for (let side = -1; side <= 1; side += 2) {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4; i++) {
        const slot = new THREE.Mesh(
          new THREE.BoxGeometry(0.005, 0.045, 0.06),
          tacticalBlack
        );
        const angle = (row / 3) * Math.PI - Math.PI / 2;
        slot.position.set(
          Math.cos(angle) * 0.095 * side,
          Math.sin(angle) * 0.095,
          -0.2 + i * 0.11
        );
        slot.rotation.x = Math.PI / 2;
        slot.rotation.z = angle;
        handguard.add(slot);
      }
    }
  }
  
  handguard.position.set(0, 0.02, -0.42);
  weapon.add(handguard);

  // Coronha telescópica ajustável
  const stockGroup = new THREE.Group();
  
  // Tubo da coronha
  const bufferTube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.18, 12), gunmetalDark);
  bufferTube.rotation.x = Math.PI / 2;
  bufferTube.position.set(0, 0, 0.12);
  stockGroup.add(bufferTube);
  
  // Corpo da coronha
  const stockBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.32), carbonFiber);
  stockBody.position.set(0, -0.02, 0.38);
  stockBody.rotation.x = -0.1;
  stockGroup.add(stockBody);
  
  // Almofada de borracha (butt pad)
  const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.06), tacticalBlack);
  buttPad.position.set(0, -0.02, 0.55);
  buttPad.rotation.x = -0.1;
  stockGroup.add(buttPad);
  
  // Ajuste de altura da coronha
  const adjustmentLever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.04, 8), orangeGlow);
  adjustmentLever.rotation.z = Math.PI / 2;
  adjustmentLever.position.set(0, -0.08, 0.28);
  stockGroup.add(adjustmentLever);
  
  stockGroup.position.set(0, 0, 0.48);
  weapon.add(stockGroup);

  // Carregador STANAG estilizado
  const magazineGroup = new THREE.Group();
  
  const magazineCurve = new THREE.Shape();
  magazineCurve.moveTo(-0.055, 0);
  magazineCurve.lineTo(0.055, 0);
  magazineCurve.lineTo(0.05, -0.26);
  magazineCurve.quadraticCurveTo(0, -0.3, -0.05, -0.26);
  magazineCurve.lineTo(-0.055, 0);
  
  const magazineGeo = new THREE.ExtrudeGeometry(magazineCurve, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  const magazine = new THREE.Mesh(magazineGeo, gunmetalDark);
  magazine.position.set(0, -0.22, 0);
  magazine.rotation.x = 0.1;
  magazineGroup.add(magazine);
  
  // Ribbing do carregador
  for (let i = 0; i < 8; i++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.008, 0.125),
      gunmetalMedium
    );
    rib.position.set(0, -0.03 - i * 0.032, 0.005);
    rib.rotation.x = 0.1;
    magazineGroup.add(rib);
  }
  
  // Base plate iluminada
  const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 0.14), orangeGlow);
  magBase.position.set(0, -0.32, 0.02);
  magBase.rotation.x = 0.1;
  magazineGroup.add(magBase);
  
  magazineGroup.position.set(0, -0.24, 0.02);
  weapon.add(magazineGroup);

  // Mira traseira flip-up ajustável
  const rearSightGroup = new THREE.Group();
  
  const rearSightBase = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.1), tacticalBlack);
  rearSightBase.position.set(0, 0, 0);
  rearSightGroup.add(rearSightBase);
  
  const rearSightFlip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.03), gunmetalLight);
  rearSightFlip.position.set(0, 0.055, 0);
  rearSightGroup.add(rearSightFlip);
  
  // Aperture da mira traseira
  const aperturePlate = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.015), gunmetalDark);
  aperturePlate.position.set(0, 0.075, 0);
  rearSightGroup.add(aperturePlate);
  
  rearSightGroup.position.set(0, 0.235, 0.16);
  weapon.add(rearSightGroup);

  // Mira dianteira flip-up
  const frontSightGroup = new THREE.Group();
  
  const frontSightBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.07), gunmetalMedium);
  frontSightBase.position.set(0, 0, 0);
  frontSightGroup.add(frontSightBase);
  
  const frontSightPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.055, 8), gunmetalDark);
  frontSightPost.position.set(0, 0.045, 0);
  frontSightGroup.add(frontSightPost);
  
  // Fiber optic front sight
  const fiberOptic = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff0000, emissiveIntensity: 0.8 })
  );
  fiberOptic.position.set(0, 0.072, 0);
  frontSightGroup.add(fiberOptic);
  
  frontSightGroup.position.set(0, 0.105, -0.62);
  weapon.add(frontSightGroup);

  // Gatilho match-grade
  const trigger = new THREE.Mesh(
    new THREE.TorusGeometry(0.028, 0.01, 12, 20, Math.PI * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.8 })
  );
  trigger.position.set(0, -0.195, 0.16);
  trigger.rotation.x = Math.PI / 2;
  weapon.add(trigger);

  // Guarda-gatilho integrado
  const triggerGuardShape = new THREE.Shape();
  triggerGuardShape.moveTo(-0.05, 0);
  triggerGuardShape.lineTo(0.05, 0);
  triggerGuardShape.lineTo(0.05, -0.05);
  triggerGuardShape.quadraticCurveTo(0, -0.08, -0.05, -0.05);
  triggerGuardShape.closePath();
  
  const triggerGuardGeo = new THREE.ExtrudeGeometry(triggerGuardShape, { depth: 0.02, bevelEnabled: false });
  const triggerGuard = new THREE.Mesh(triggerGuardGeo, gunmetalMedium);
  triggerGuard.position.set(0, -0.215, 0.2);
  triggerGuard.rotation.x = -Math.PI / 2;
  weapon.add(triggerGuard);

  // Seletor de fogo ambidestro
  const selectorLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 12), orangeGlow);
  selectorLeft.rotation.z = Math.PI / 2;
  selectorLeft.position.set(-0.115, -0.08, 0.14);
  weapon.add(selectorLeft);
  
  const selectorRight = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 12), orangeGlow);
  selectorRight.rotation.z = Math.PI / 2;
  selectorRight.position.set(0.115, -0.08, 0.14);
  weapon.add(selectorRight);

  // Charging handle estendido
  const chargingHandle = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.07, 12), gunmetalLight);
  handle.rotation.z = Math.PI / 2;
  chargingHandle.add(handle);
  
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.025), carbonFiber);
  grip.position.set(0, 0.025, 0);
  chargingHandle.add(grip);
  
  chargingHandle.position.set(0, 0.095, 0.26);
  weapon.add(chargingHandle);

  // Forward assist
  const forwardAssist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.02, 0.025, 16),
    gunmetalLight
  );
  forwardAssist.rotation.z = Math.PI / 2;
  forwardAssist.position.set(0.115, 0.025, 0.18);
  weapon.add(forwardAssist);

  // Ejection port
  const ejectionPort = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.06, 0.12),
    tacticalBlack
  );
  ejectionPort.position.set(0.11, 0.08, 0.08);
  weapon.add(ejectionPort);

  // Accents decorativos premium
  const accentStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.15), orangeGlow);
  accentStripe.position.set(0, 0.115, 0.06);
  weapon.add(accentStripe);
  
  // Logo/marca gravada
  const logoPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.015, 0.04),
    brushedMetal
  );
  logoPlate.position.set(0, -0.175, 0.22);
  weapon.add(logoPlate);

  // Parafusos de titânio
  const screwGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.018, 8);
  const screwMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.95 });
  
  const screwPositions = [
    [-0.09, 0.025, -0.18], [0.09, 0.025, -0.18],
    [-0.09, 0.025, 0.12], [0.09, 0.025, 0.12],
    [-0.08, -0.175, 0.12], [0.08, -0.175, 0.12],
    [-0.07, 0.025, -0.05], [0.07, 0.025, -0.05],
    [0, 0.23, -0.2], [0, 0.23, 0.15]
  ];

  for (const [x, y, z] of screwPositions) {
    const screw = new THREE.Mesh(screwGeo, screwMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, y, z);
    weapon.add(screw);
  }

  // Flash do disparo melhorado
  const muzzleFlash = new THREE.PointLight(0xffaa00, 0, 6);
  muzzleFlash.name = 'muzzle-flash';
  muzzleFlash.position.set(0, 0.025, -1.18);
  weapon.add(muzzleFlash);
  
  // Glow effect no muzzle
  const muzzleGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0 })
  );
  muzzleGlow.name = 'muzzle-glow';
  muzzleGlow.position.set(0, 0.025, -1.18);
  weapon.add(muzzleGlow);

  // Posicionamento final da arma
  weapon.position.set(0.42, -0.36, -0.68);
  weapon.rotation.set(-0.05, -0.04, 0.02);
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
  const muzzleGlow = weapon?.getObjectByName('muzzle-glow');
  if (muzzleFlash) muzzleFlash.intensity = muzzleTimer > 0 ? 28 : 0;
  if (muzzleGlow) {
    const glowMaterial = muzzleGlow.material;
    glowMaterial.opacity = muzzleTimer > 0 ? 0.85 : 0;
    glowMaterial.needsUpdate = true;
  }

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
