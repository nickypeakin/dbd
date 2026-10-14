// Merges the static meshes of a model so it draws in a few calls instead of
// dozens. Meshes that sit directly under the same parent and share a
// "material class" (same texture, roughly the same roughness and metalness,
// same glow and transparency) become one mesh, with each part's colour
// stored per vertex. Parts that animate on their own (doors, levers, lights
// whose glow changes) live in their own groups or are flagged with
// `userData.keep`, and are left alone.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const classMats = new Map();

// Roughness and metalness are rounded to halves: the difference is hard to
// see on small parts and it lets far more of them share a draw call.
const half = (v) => Math.round(v * 2) / 2;

function classKey(m) {
  return [
    m.map ? m.map.uuid : '', half(m.roughness), half(m.metalness),
    m.emissive.getHexString(), m.emissiveIntensity, m.transparent ? m.opacity : 1, m.side, m.alphaTest,
  ].join('|');
}

// One shared vertex-coloured material per class.
function classMaterial(m, key) {
  let out = classMats.get(key);
  if (!out) {
    out = new THREE.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, map: m.map,
      roughness: half(m.roughness), metalness: half(m.metalness),
      emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
      transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest,
    });
    classMats.set(key, out);
  }
  return out;
}

// A copy of a mesh's geometry with its colour per vertex, moved by `matrix`.
function prepare(mesh, matrix) {
  const geo = mesh.geometry.clone();
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.index) {
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  // material colours are already linear, as vertex colours must be
  const c = mesh.material.color;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.applyMatrix4(matrix);
  return geo;
}

function bakeLevel(parent) {
  const byClass = new Map();
  for (const c of parent.children) {
    if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || c.children.length || c.userData.keep) continue;
    if (!c.material || !c.material.isMeshStandardMaterial || c.material.vertexColors || c.material.normalMap) continue;
    const key = classKey(c.material);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(c);
  }
  for (const [key, list] of byClass) {
    if (list.length < 2) continue;
    const geos = list.map((c) => { c.updateMatrix(); return prepare(c, c.matrix); });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.userData.owned = true;
    const mesh = new THREE.Mesh(merged, classMaterial(list[0].material, key));
    mesh.castShadow = list.some((c) => c.castShadow);
    mesh.receiveShadow = list.some((c) => c.receiveShadow);
    for (const c of list) parent.remove(c);
    parent.add(mesh);
  }
}

// Bake every level of a model in place.
export function bake(root) {
  const groups = [];
  root.traverse((o) => { if (o.children.length && !o.isMesh) groups.push(o); });
  for (const g of groups) bakeLevel(g);
  return root;
}

// Turns a model whose joints are THREE.Bones into a few skinned meshes, one
// per material class: every vertex follows the nearest bone above it, so the
// joints still animate the same way but the whole body draws in a handful of
// calls. Must run while the bones are in their rest pose. Subtrees flagged
// `userData.keep` (parts that move or hide on their own) stay as they are.
// `bounds` is a sphere, in the root's space, that holds every pose.
export function skin(root, bounds) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const byClass = new Map();
  const done = [];
  const visit = (o, bone) => {
    if (o.userData.keep) return;
    if (o.isBone) bone = o;
    for (const c of [...o.children]) visit(c, bone);
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    const geo = prepare(o, new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
    const n = geo.attributes.position.count;
    const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    const b = boneIndex.get(bone) ?? 0;
    for (let i = 0; i < n; i++) { idx[i * 4] = b; w[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    const key = classKey(o.material);
    if (!byClass.has(key)) byClass.set(key, { mat: o.material, geos: [], cast: false });
    const e = byClass.get(key);
    e.geos.push(geo);
    e.cast = e.cast || o.castShadow;
    done.push(o);
  };
  visit(root, null);
  const skeleton = new THREE.Skeleton(bones);
  for (const o of done) o.parent.remove(o);
  for (const [key, e] of byClass) {
    const merged = mergeGeometries(e.geos, false);
    for (const g of e.geos) g.dispose();
    if (!merged) continue;
    merged.userData.owned = true;
    merged.boundingSphere = bounds.clone();
    const mesh = new THREE.SkinnedMesh(merged, classMaterial(e.mat, key));
    mesh.castShadow = e.cast;
    mesh.boundingSphere = bounds.clone();
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  return skeleton;
}
