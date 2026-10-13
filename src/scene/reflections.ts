import {
  Color,
  HalfFloatType,
  UnsignedIntType,
  MeshStandardMaterial,
  WebGLRenderTarget,
} from 'three';
import type {
  PerspectiveCamera,
  WebGLRenderer,
  Scene,
  Mesh,
  Object3D,
  Material,
  ColorRepresentation,
} from 'three';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

type SurfacePass = (
  renderer: WebGLRenderer,
  material: Material,
  target: WebGLRenderTarget,
  color?: ColorRepresentation,
  alpha?: number,
) => void;
type SurfaceInternals = {
  scene: Scene;
  _renderOverride: SurfacePass;
  _renderMetalness?: SurfacePass;
};
// The world body stays present in the beauty pass to cast the player's shadow.
// Override materials must not turn those shadow-only meshes into visible surfaces.
function filterSurfacePasses(pass: SSRPass | GTAOPass) {
  const internals = pass as unknown as SurfaceInternals;
  for (const key of ['_renderOverride', '_renderMetalness'] as const) {
    const original = internals[key];
    if (!original) continue;
    internals[key] = function (renderer, ...args) {
      const hidden: Object3D[] = [];
      internals.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.visible) return;
        const materials = Array.isArray(m.material) ? m.material : [m.material];
        if (materials.every((material) => !material.colorWrite)) {
          hidden.push(m);
          m.visible = false;
        }
      });
      const autoUpdate = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      try {
        original.call(pass, renderer, ...args);
      } finally {
        renderer.shadowMap.autoUpdate = autoUpdate;
        for (const object of hidden) object.visible = true;
      }
    };
  }
}

export class StudioReflections {
  private pass: SSRPass;
  private ao: GTAOPass;
  private aa = new SMAAPass();
  private output = new OutputPass();
  private masks = new Map<Material, MeshStandardMaterial>();
  private target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private shaded = this.target.clone();
  private antialiased = this.target.clone();
  private size = '';
  constructor(
    private renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ) {
    this.pass = new SSRPass({
      renderer,
      scene,
      camera,
      width: 1,
      height: 1,
      selects: [],
      groundReflector: null,
    });
    this.pass.opacity = 0.42;
    this.pass.maxDistance = 2.5;
    this.pass.thickness = 0.035;
    this.pass.blur = true;
    this.pass.distanceAttenuation = true;
    this.pass.fresnel = true;
    this.pass.resolutionScale = 0.75;
    this.pass.beautyRenderTarget.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.pass.beautyRenderTarget.depthTexture!.type = UnsignedIntType;
    this.pass.ssrMaterial.fragmentShader = this.pass.ssrMaterial.fragmentShader.replace(
      'gl_FragColor.a=op;',
      'gl_FragColor.a=op*texture2D(tMetalness,vUv).r*smoothstep(0.0,0.08,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));',
    );
    for (const blur of [this.pass.blurMaterial, this.pass.blurMaterial2]) {
      blur.uniforms.tSurface = { value: this.pass.metalnessRenderTarget.texture };
      blur.fragmentShader = 'uniform sampler2D tSurface;\n' + blur.fragmentShader;
      blur.fragmentShader = blur.fragmentShader
        .replace(
          '( 1.0 / resolution )',
          '( 1.0 / resolution )*mix(1.0,6.0,texture2D(tSurface,vUv).g)',
        )
        .replace('/a;', '/max(a,0.00001);');
    }
    (this.pass as unknown as SurfaceInternals)._renderMetalness = (r, _material, target) =>
      this.renderSurfaces(scene, camera, r, target);
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.blendIntensity = 0.65;
    this.ao.updateGtaoMaterial({
      radius: 0.12,
      thickness: 0.025,
      distanceExponent: 2,
      distanceFallOff: 1,
      scale: 1,
      samples: 8,
      screenSpaceRadius: false,
    });
    this.ao.updatePdMaterial({ radius: 4, samples: 8, depthPhi: 2, normalPhi: 3 });
    // Keep contact shading near the rig; distant, nearly coplanar floor samples
    // lose depth precision and otherwise darken the horizon into a visible band.
    const blend = this.ao.blendMaterial,
      depth = this.ao.gtaoMaterial.uniforms;
    blend.uniforms.studioDepth = depth.tDepth;
    blend.uniforms.studioNear = depth.cameraNear;
    blend.uniforms.studioFar = depth.cameraFar;
    blend.fragmentShader =
      '#include <packing>\nuniform sampler2D studioDepth;\nuniform float studioNear;\nuniform float studioFar;\n' +
      blend.fragmentShader;
    blend.fragmentShader = blend.fragmentShader
      .replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        `vec4 texel = texture2D( tDiffuse, vUv );
   float viewDistance=-perspectiveDepthToViewZ(texture2D(studioDepth,vUv).x,studioNear,studioFar);
   float contactFade=1.0-smoothstep(6.0,18.0,viewDistance);
  `,
      )
      .replace('texel.rgb, intensity)', 'texel.rgb, intensity*contactFade)');
    filterSurfacePasses(this.pass);
    filterSurfacePasses(this.ao);
    this.output.renderToScreen = true;
  }
  render(
    scene: Scene,
    camera: PerspectiveCamera,
    rect: { x: number; y: number; w: number; h: number },
  ) {
    const { w: width, h: height } = rect,
      scale = Math.min(this.renderer.getPixelRatio(), 2560 / width, 1440 / height),
      w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale)),
      size = w + 'x' + h;
    this.pass.scene = scene;
    this.pass.camera = camera;
    this.ao.scene = scene;
    this.ao.camera = camera;
    if (this.size !== size) {
      this.size = size;
      this.target.setSize(w, h);
      this.shaded.setSize(w, h);
      this.antialiased.setSize(w, h);
      this.aa.setSize(w, h);
      this.pass.setSize(w, h);
      this.pass.ssrMaterial.defines.MAX_STEP = 768;
      this.ao.setSize(w, h);
    }
    this.renderer.setScissorTest(false);
    {
      // FOV can change without resizing the player-camera frame.
      const u = this.pass.ssrMaterial.uniforms;
      u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      this.pass.render(this.renderer, this.target, this.target, 0, false);
    }
    this.ao.render(this.renderer, this.shaded, this.target, 0, false);
    this.aa.render(this.renderer, this.antialiased, this.shaded, 0, false);
    const result = this.antialiased;
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(rect.x, rect.y, width, height);
    this.renderer.setScissor(rect.x, rect.y, width, height);
    this.renderer.setScissorTest(true);
    this.output.render(this.renderer, result, result, 0, false);
  }
  private renderSurfaces(
    scene: Scene,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
    target: WebGLRenderTarget,
  ) {
    const originals = new Map<Mesh, Material | Material[]>(),
      background = scene.background,
      fog = scene.fog,
      autoClear = renderer.autoClear,
      clearColor = renderer.getClearColor(new Color()),
      clearAlpha = renderer.getClearAlpha();
    scene.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      originals.set(mesh, mesh.material);
      const convert = (source: Material) => {
        let mask = this.masks.get(source);
        if (mask) return mask;
        mask =
          source instanceof MeshStandardMaterial
            ? source.clone()
            : new MeshStandardMaterial({ roughness: 1, metalness: 0, side: source.side });
        mask.transparent = false;
        mask.depthWrite = true;
        mask.colorWrite = true;
        mask.toneMapped = false;
        mask.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer);
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_physical_fragment>',
            `#include <lights_physical_fragment>
    float reflectionWeight=mix(0.16,1.0,metalnessFactor)*pow(clamp(1.0-roughnessFactor,0.0,1.0),0.75);
    gl_FragColor=vec4(reflectionWeight,roughnessFactor,0.0,1.0);return;
   `,
          );
        };
        mask.customProgramCacheKey = () =>
          'studio-reflection-surface-v2:' + source.customProgramCacheKey();
        this.masks.set(source, mask);
        return mask;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convert)
        : convert(mesh.material);
    });
    try {
      scene.background = null;
      scene.fog = null;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      for (const [mesh, material] of originals) mesh.material = material;
      scene.background = background;
      scene.fog = fog;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColor, clearAlpha);
    }
  }
  dispose() {
    this.pass.dispose();
    this.ao.dispose();
    this.ao.gtaoMaterial.dispose();
    this.ao.blendMaterial.dispose();
    this.aa.dispose();
    this.output.dispose();
    this.target.dispose();
    this.shaded.dispose();
    this.antialiased.dispose();
    for (const material of this.masks.values()) material.dispose();
  }
}
