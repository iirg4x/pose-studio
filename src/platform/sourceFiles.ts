/** File types the app reads by itself on every platform. Kept apart from the readers so pickers stay light. */
export const ANIMATION_EXTENSIONS = ['fbx', 'glb', 'gltf', 'bvh'];
export const CHARACTER_EXTENSIONS = ['fbx', 'glb', 'gltf'];
export const PROP_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj'];
/** Source files are converted before the 32 MB asset limit applies, so they may be larger. */
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
