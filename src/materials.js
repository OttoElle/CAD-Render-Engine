import * as THREE from 'three';

/**
 * Material library. `color: null` means "keep the colour from the CAD file".
 * All entries are MeshPhysicalMaterial parameters, which the real-time view
 * and the path tracer both understand.
 */
export const MATERIALS = [
  { id: 'cad', label: 'Original (CAD-Farbe)', color: null, params: { metalness: 0, roughness: 0.5 } },
  { id: 'alu-matt', label: 'Aluminium matt', color: '#d5d7da', params: { metalness: 1, roughness: 0.42 } },
  { id: 'alu-poliert', label: 'Aluminium poliert', color: '#e6e7e9', params: { metalness: 1, roughness: 0.08 } },
  { id: 'alu-schwarz', label: 'Aluminium schwarz eloxiert', color: '#1b1c1f', params: { metalness: 1, roughness: 0.38 } },
  { id: 'stahl', label: 'Stahl', color: '#8f9296', params: { metalness: 1, roughness: 0.3 } },
  { id: 'edelstahl', label: 'Edelstahl poliert', color: '#c9cbcd', params: { metalness: 1, roughness: 0.12 } },
  { id: 'verzinkt', label: 'Stahl verzinkt', color: '#b9bec4', params: { metalness: 1, roughness: 0.5 } },
  { id: 'messing', label: 'Messing', color: '#d8b56a', params: { metalness: 1, roughness: 0.22 } },
  { id: 'kupfer', label: 'Kupfer', color: '#d98c68', params: { metalness: 1, roughness: 0.2 } },
  { id: 'kunststoff-matt', label: 'Kunststoff matt', color: '#2b2d31', params: { metalness: 0, roughness: 0.7 } },
  {
    id: 'kunststoff-glanz',
    label: 'Kunststoff glänzend',
    color: '#d9342b',
    params: { metalness: 0, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  },
  {
    id: 'lack',
    label: 'Lack glänzend',
    color: '#1f5fbf',
    params: { metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 },
  },
  { id: 'gummi', label: 'Gummi', color: '#141414', params: { metalness: 0, roughness: 0.95 } },
  {
    id: 'glas',
    label: 'Glas',
    color: '#ffffff',
    params: { metalness: 0, roughness: 0.02, transmission: 1, ior: 1.5, thickness: 2 },
  },
];

const BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

export function getMaterialDef(id) {
  return BY_ID.get(id) || MATERIALS[0];
}

/** Colour a part gets when a library material is chosen without an override. */
export function defaultColor(part, materialId) {
  const def = getMaterialDef(materialId);
  return def.color ?? `#${part.cadColor.getHexString()}`;
}

/** Builds the three.js material for a part from its materialId and colour. */
export function createMaterial(part) {
  const def = getMaterialDef(part.materialId);
  return new THREE.MeshPhysicalMaterial({
    ...def.params,
    color: new THREE.Color(part.colorHex),
    side: THREE.DoubleSide,
  });
}
