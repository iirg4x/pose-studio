import * as T from 'three';

// One physical floor: the grid changes its albedo, never its depth or normals.
export function createStudioFloor(backdrop: T.Texture) {
  const material = new T.MeshStandardMaterial({
    color: 0x454d58,
    roughness: 0.72,
    metalness: 0.08,
    fog: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.studioBackdrop = { value: backdrop };
    shader.vertexShader =
      'varying vec2 vFloorPosition; varying vec3 vFloorWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFloorPosition=position.xy; vFloorWorld=(modelMatrix*vec4(position,1.0)).xyz;',
    );
    shader.fragmentShader =
      'varying vec2 vFloorPosition; varying vec3 vFloorWorld; uniform sampler2D studioBackdrop;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <shadowmap_pars_fragment>',
      '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
   vec2 uv=vFloorPosition;
   float gridDistance=length(vFloorWorld-cameraPosition);
   float gridFade=1.0-smoothstep(4.0,14.0,gridDistance);
   vec2 pixel=max(fwidth(uv),vec2(0.00001));
   vec2 minorDistance=abs(fract(uv*10.0+0.5)-0.5)/10.0;
   vec2 majorDistance=abs(fract(uv+0.5)-0.5);
   vec2 minor=1.0-smoothstep(vec2(0.0),pixel*1.15,minorDistance);
   vec2 major=1.0-smoothstep(vec2(0.001),vec2(0.003)+pixel,majorDistance);
   float minorFade=1.0-smoothstep(0.018,0.055,max(pixel.x,pixel.y));
   vec2 crossLong=1.0-smoothstep(vec2(0.045),vec2(0.05)+pixel,majorDistance);
   vec2 crossThin=1.0-smoothstep(vec2(0.003),vec2(0.006)+pixel,majorDistance);
   float crosses=max(crossLong.x*crossThin.y,crossThin.x*crossLong.y);
   float crossFade=1.0-smoothstep(0.03,0.10,max(pixel.x,pixel.y));
   float grid=max(minor.x,minor.y)*0.08*minorFade+max(major.x,major.y)*0.13+crosses*0.28*crossFade;
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.24,0.28,0.32),clamp(grid,0.0,0.55)*gridFade);
   vec2 axes=1.0-smoothstep(vec2(0.001),vec2(0.003)+pixel,abs(uv));
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.16,0.09,0.085),axes.x*0.5*gridFade);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.15,0.10),axes.y*0.5*gridFade);
  `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      `
   vec3 outgoingLight=diffuseColor.rgb*mix(0.55,1.0,getShadowMask());
   vec3 viewRay=normalize(vFloorWorld-cameraPosition);
   vec3 distantBackdrop=texture2D(studioBackdrop,vec2(0.5,asin(clamp(viewRay.y,-1.0,1.0))/3.14159265359+0.5)).rgb;
   float horizonFade=smoothstep(18.0,65.0,length(vFloorWorld-cameraPosition));
   outgoingLight=mix(outgoingLight,distantBackdrop,horizonFade);
  `,
    );
  };
  material.customProgramCacheKey = () => 'studio-floor-grid-v2';
  const floor = new T.Mesh(new T.PlaneGeometry(200, 200), material);
  floor.name = 'Studio floor · 10 cm grid · 1 m crosses';
  floor.userData.studioReflective = true;
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  floor.layers.enable(1);
  return floor;
}
