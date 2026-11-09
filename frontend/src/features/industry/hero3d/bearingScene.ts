// The 3D bearing for the home hero. Loaded with import() only when the hero is on screen, so three.js
// stays out of the first bundle. The GLB files and the Draco decoder are served from /3d/ on our own origin.
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface BearingSceneOptions {
  /** Lighter model for phones. */
  mobile: boolean;
  /** Called once, after the first frame with the model is drawn. */
  onReady: () => void;
  onError: (error: unknown) => void;
}

export interface BearingScene {
  /** Rendering runs only while the hero is visible and the tab is in front. */
  setActive: (active: boolean) => void;
  dispose: () => void;
}

const ASSEMBLE = 'Assemble';
const ROTATE = 'Rotate';
/** Seconds the endless rotation takes to fade in after assembling, so there is no jolt between the clips. */
const BLEND = 0.9;
/** Largest tilt toward the pointer, radians. Small on purpose: the model leans, it does not spin. */
const TILT = 0.14;
/** A 16-second turn looks the same at 30 frames a second, and the page next to it keeps half the GPU and CPU. */
const FRAME_MS = 1000 / 30;

export function createBearingScene(canvas: HTMLCanvasElement, { mobile, onReady, onError }: BearingSceneOptions): BearingScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 2 : 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  // Metal shows what it reflects: without an environment the races render black. RoomEnvironment is generated
  // on the GPU, so there is no HDR file to download.
  const pmrem = new PMREMGenerator(renderer);
  const envTexture: Texture = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.75;
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new DirectionalLight(0x8ad0bd, 0.6);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const camera = new PerspectiveCamera(28, 1, 0.01, 100);
  const tilt = new Group();
  scene.add(tilt);

  const draco = new DRACOLoader().setDecoderPath('/3d/draco/').setDecoderConfig({ type: 'wasm' });
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const clock = new Clock(false);
  let mixer: AnimationMixer | null = null;
  let active = false;
  let disposed = false;
  let readySent = false;
  let frames = 0;
  const pointer = { x: 0, y: 0 };

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const onPointer = (event: PointerEvent) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  };
  if (finePointer) window.addEventListener('pointermove', onPointer, { passive: true });

  let lastFrame = 0;
  const frame = (time: number) => {
    if (time - lastFrame < FRAME_MS - 2) return;
    lastFrame = time;
    const delta = Math.min(clock.getDelta(), 1 / 10);
    mixer?.update(delta);
    tilt.rotation.y = MathUtils.damp(tilt.rotation.y, pointer.x * TILT, 2.5, delta);
    tilt.rotation.x = MathUtils.damp(tilt.rotation.x, pointer.y * TILT * 0.6, 2.5, delta);
    renderer.render(scene, camera);
    frames += 1;
    // For tests and FPS checks; written every 15 frames to keep DOM work out of the loop.
    if (frames % 15 === 0 || frames < 3) canvas.dataset.frames = String(frames);
    if (!readySent && mixer) {
      readySent = true;
      onReady();
    }
  };

  const setActive = (next: boolean) => {
    if (disposed || next === active) return;
    active = next;
    canvas.dataset.running = String(next);
    if (next) {
      clock.start();
      renderer.setAnimationLoop(frame);
    } else {
      renderer.setAnimationLoop(null);
      clock.stop();
    }
  };

  loader.load(
    mobile ? '/3d/bearing-mobile.glb' : '/3d/bearing.glb',
    (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      tilt.add(model);
      mixer = new AnimationMixer(model);
      const assemble = gltf.animations.find((clip) => clip.name === ASSEMBLE);
      const rotate = gltf.animations.find((clip) => clip.name === ROTATE);

      // Frame the camera on the assembled bearing, with room for the parts that fly in.
      const box = new Box3();
      const sphere = new Sphere();
      let assembledRadius = 0;
      let flyRadius = 0;
      const center = new Vector3();
      if (assemble) {
        const probe = mixer.clipAction(assemble);
        probe.play();
        for (let step = 0; step <= 8; step += 1) {
          const time = (assemble.duration * step) / 8;
          mixer.setTime(time);
          model.updateMatrixWorld(true);
          box.setFromObject(model).getBoundingSphere(sphere);
          if (time === assemble.duration) {
            assembledRadius = sphere.radius;
            center.copy(sphere.center);
          }
          flyRadius = Math.max(flyRadius, sphere.radius);
        }
        probe.stop();
        mixer.setTime(0);
      } else {
        box.setFromObject(model).getBoundingSphere(sphere);
        assembledRadius = flyRadius = sphere.radius;
        center.copy(sphere.center);
      }
      model.position.sub(center);
      // A flat ring seen from above takes far less height than its bounding sphere, and the parts fly in mostly
      // upward, so this frames the assembled bearing large while the flight still fits.
      const radius = Math.max(assembledRadius * 0.8, flyRadius * 0.62);
      const distance = radius / Math.sin(MathUtils.degToRad(camera.fov / 2));
      camera.position.set(0, distance * 0.62, distance * 0.79);
      camera.lookAt(0, 0, 0);
      camera.near = distance / 50;
      camera.far = distance * 4;
      camera.updateProjectionMatrix();

      if (assemble) {
        const assembleAction = mixer.clipAction(assemble);
        assembleAction.setLoop(LoopOnce, 1);
        assembleAction.clampWhenFinished = true;
        assembleAction.play();
        canvas.dataset.clip = ASSEMBLE;
        mixer.addEventListener('finished', (event) => {
          if (event.action !== assembleAction || !rotate || !mixer) return;
          const rotateAction = mixer.clipAction(rotate);
          rotateAction.setLoop(LoopRepeat, Infinity);
          rotateAction.reset().play();
          rotateAction.crossFadeFrom(assembleAction, BLEND, false);
          canvas.dataset.clip = ROTATE;
        });
      } else if (rotate) {
        mixer.clipAction(rotate).setLoop(LoopRepeat, Infinity).play();
        canvas.dataset.clip = ROTATE;
      }
      resize();
      // A frame even if the hero starts out of view, so onReady can fire when it scrolls in.
      if (!active) renderer.render(scene, camera);
    },
    undefined,
    (error) => {
      if (!disposed) onError(error);
    },
  );

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    if (finePointer) window.removeEventListener('pointermove', onPointer);
    mixer?.stopAllAction();
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value && (value as Texture).isTexture) (value as Texture).dispose();
        material.dispose();
      }
    });
    envTexture.dispose();
    pmrem.dispose();
    draco.dispose();
    renderer.dispose();
    canvas.dataset.running = 'false';
    canvas.dataset.disposed = 'true';
  };

  return { setActive, dispose };
}
